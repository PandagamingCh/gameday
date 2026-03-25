// ─────────────────────────────────────────────────────────────
// routes/admin.js — Administration des utilisateurs
//
// Routes :
//   GET    /api/admin/users           Liste des utilisateurs
//   DELETE /api/admin/users/:id       Supprime un utilisateur
//   POST   /api/admin/reset-link/:id  Génère un lien de reset pour un user
//   GET    /api/admin/backup/list     Liste les sauvegardes disponibles
//   POST   /api/admin/backup/now      Lance une sauvegarde immédiate
//   GET    /api/admin/backup/download/:filename  Télécharge une sauvegarde
//   DELETE /api/admin/test-cleanup    Supprime les séances [TEST]
//   GET    /admin-reset               Page de reset admin (HTML)
//   POST   /api/admin-reset           Reset le mot de passe admin via token
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const { getEmailSetting, createTransporter } = require('../email');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { runBackup } = require('../backup');
const { v4: uuidv4 } = require('uuid');

// ── ADMIN ROUTES ────────────────────────────────────────────

// GET /api/admin/backup/download/:filename — télécharger un backup
router.get('/api/admin/backup/download/:filename', requireAdmin, (req, res) => {
  const fn = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, 'data/backups');
  const fp = path.join(backupDir, fn);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(fp);
});

// GET /api/admin/backup/list — lister les backups
router.get('/api/admin/backup/list', requireAdmin, (req, res) => {
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, 'data/backups');
  try {
    const files = fs.readdirSync(backupDir).sort().reverse()
      .map(f => ({ name: f, size: fs.statSync(path.join(backupDir, f)).size }));
    res.json({ files });
  } catch(e) { res.json({ files: [] }); }
});

// POST /api/admin/backup/now — backup manuel
router.post('/api/admin/backup/now', requireAdmin, (req, res) => {
  const { db } = require('./src/database');
  runBackup(db);
  res.json({ ok: true, message: 'Backup lancé' });
});

// GET /api/admin/users
router.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, bgg_username, is_admin, created_at, bgg_synced_at FROM users ORDER BY id').all();
  res.json({ users });
});

// DELETE /api/admin/users/:id
router.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  try {
    // Supprimer les données liées avant l'utilisateur
    db.prepare('DELETE FROM rankings WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM session_participants WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM doodle_votes WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM session_private_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(id);
    // Nullifier les références sans CASCADE
    db.prepare('UPDATE proposals SET proposed_by = NULL WHERE proposed_by = ?').run(id);
    db.prepare('UPDATE sessions SET created_by = NULL WHERE created_by = ?').run(id);
    db.prepare('UPDATE invites SET created_by = NULL WHERE created_by = ?').run(id);
    db.prepare('UPDATE invites SET used_by = NULL WHERE used_by = ?').run(id);
    try { db.prepare('UPDATE doodles SET created_by = NULL WHERE created_by = ?').run(id); } catch(e) {}
    // Les proposals et sessions créées par cet user restent (on ne les supprime pas)
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch(e) {
    console.error('Delete user error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/reset-link/:userId — générer lien reset pour un user
router.post('/api/admin/reset-link/:userId', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  // Invalider les anciens tokens
  db.prepare('UPDATE reset_tokens SET used=1 WHERE user_id=?').run(userId);
  const token = uuidv4();
  db.prepare('INSERT INTO reset_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
  const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
  res.json({ ok: true, link, username: user.username });
});

// GET /api/reset-password?token= — vérifier token
router.get('/api/reset-password', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manquant' });
  const r = db.prepare('SELECT rt.*, u.username FROM reset_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token=? AND rt.used=0').get(token);
  if (!r) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  // Expiration 24h
  const created = new Date(r.created_at);
  if (Date.now() - created.getTime() > 24 * 60 * 60 * 1000) {
    db.prepare('UPDATE reset_tokens SET used=1 WHERE token=?').run(token);
    return res.status(400).json({ error: 'Lien expiré (24h)' });
  }
  res.json({ ok: true, username: r.username });
});

// POST /api/reset-password — changer le mot de passe avec token
router.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Données manquantes' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
  const r = db.prepare('SELECT * FROM reset_tokens WHERE token=? AND used=0').get(token);
  if (!r) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  const created = new Date(r.created_at);
  if (Date.now() - created.getTime() > 24 * 60 * 60 * 1000) {
    db.prepare('UPDATE reset_tokens SET used=1 WHERE token=?').run(token);
    return res.status(400).json({ error: 'Lien expiré (24h)' });
  }
  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, r.user_id);
  db.prepare('UPDATE reset_tokens SET used=1 WHERE token=?').run(token);
  res.json({ ok: true });
});

// GET /reset-password — page HTML de reset
router.get('/reset-password', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Réinitialisation mot de passe — GameDay</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Mono',monospace,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{background:#16213e;border:1px solid #2a2a4a;border-radius:12px;padding:32px;max-width:400px;width:100%}
  h1{font-family:serif;font-size:1.4rem;margin-bottom:8px;color:#f0c040}
  .sub{font-size:.8rem;color:#888;margin-bottom:24px}
  label{display:block;font-size:.75rem;margin-bottom:6px;color:#aaa}
  input{width:100%;padding:10px 12px;background:#0f3460;border:1px solid #2a2a4a;border-radius:8px;color:#e0e0e0;font-family:inherit;font-size:.85rem;margin-bottom:16px}
  button{width:100%;padding:12px;background:#f0c040;color:#1a1a2e;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.9rem}
  button:hover{background:#d4a030}
  .msg{padding:10px 14px;border-radius:8px;font-size:.8rem;margin-bottom:16px}
  .msg.ok{background:#1a3a1a;color:#6fcf97;border:1px solid #6fcf97}
  .msg.err{background:#3a1a1a;color:#eb5757;border:1px solid #eb5757}
  a{color:#f0c040;font-size:.8rem;display:block;text-align:center;margin-top:16px}
</style>
</head>
<body>
<div class="card">
  <h1>GameDay</h1>
  <div class="sub" id="sub">Réinitialisation de mot de passe</div>
  <div id="msg"></div>
  <div id="form">
    <label>Nouveau mot de passe</label>
    <input type="password" id="pw" placeholder="6 caractères minimum" autocomplete="new-password">
    <label>Confirmer</label>
    <input type="password" id="pw2" placeholder="Répéter le mot de passe" autocomplete="new-password">
    <button onclick="doReset()">Changer le mot de passe</button>
  </div>
  <a href="/">← Retour à l'accueil</a>
</div>
<script>
  const token = new URLSearchParams(location.search).get('token');
  if (!token) { document.getElementById('msg').innerHTML = '<div class="msg err">Lien invalide.</div>'; document.getElementById('form').style.display='none'; }
  else {
    fetch('/api/reset-password?token=' + encodeURIComponent(token))
      .then(r => r.json()).then(data => {
        if (data.error) { document.getElementById('msg').innerHTML = '<div class="msg err">' + data.error + '</div>'; document.getElementById('form').style.display='none'; }
        else { document.getElementById('sub').textContent = 'Nouveau mot de passe pour ' + data.username; }
      });
  }
  async function doReset() {
    const pw = document.getElementById('pw').value;
    const pw2 = document.getElementById('pw2').value;
    const msg = document.getElementById('msg');
    if (pw !== pw2) { msg.innerHTML = '<div class="msg err">Les mots de passe ne correspondent pas.</div>'; return; }
    if (pw.length < 6) { msg.innerHTML = '<div class="msg err">6 caractères minimum.</div>'; return; }
    const r = await fetch('/api/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token, password: pw }) });
    const data = await r.json();
    if (data.error) { msg.innerHTML = '<div class="msg err">' + data.error + '</div>'; }
    else { msg.innerHTML = '<div class="msg ok">✅ Mot de passe changé ! Vous pouvez vous connecter.</div>'; document.getElementById('form').style.display='none'; }
  }
</script>
</body>
</html>`);
});

// GET /reset-password — page de reset par email
router.get('/reset-password', (req, res) => {
  const { token } = req.query;
  const siteName = getEmailSetting('site_name') || 'GameDay';
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${siteName} — Nouveau mot de passe</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@900&family=DM+Mono:wght@400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0e0b;color:#f0ead8;font-family:'DM Mono',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#1a1814;border:1px solid #2e2c24;border-radius:14px;padding:36px;width:100%;max-width:400px}
.logo{font-family:'Fraunces',serif;font-size:2rem;font-weight:900;color:#e8b84b;margin-bottom:24px;text-align:center}
.logo em{color:#6a6458;font-weight:300;font-style:italic}
h2{font-size:1rem;margin-bottom:20px;color:#a09880}
input{width:100%;background:#222019;border:1px solid #2e2c24;border-radius:8px;padding:10px 14px;color:#f0ead8;font-family:'DM Mono',monospace;font-size:.85rem;outline:none;margin-bottom:12px}
input:focus{border-color:#e8b84b}
button{width:100%;padding:12px;background:#e8b84b;color:#0f0e0b;border:none;border-radius:8px;font-family:'DM Mono',monospace;font-size:.8rem;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:1px}
.msg{padding:10px 14px;border-radius:8px;font-size:.8rem;margin-bottom:12px}
.ok{background:rgba(58,122,80,.2);border:1px solid rgba(58,122,80,.4);color:#70c090}
.err{background:rgba(122,58,58,.2);border:1px solid rgba(122,58,58,.4);color:#c07070}
</style></head><body>
<div class="card">
  <div class="logo">Game<em>Day</em></div>
  <h2>Nouveau mot de passe</h2>
  <div id="msg"></div>
  <input type="password" id="pw" placeholder="Nouveau mot de passe (6 car. min)" autocomplete="new-password">
  <input type="password" id="pw2" placeholder="Confirmer le mot de passe" autocomplete="new-password">
  <button onclick="doReset()">Enregistrer</button>
</div>
<script>
async function doReset() {
  const pw = document.getElementById('pw').value;
  const pw2 = document.getElementById('pw2').value;
  const msg = document.getElementById('msg');
  if (pw !== pw2) { msg.innerHTML = '<div class="msg err">Mots de passe différents.</div>'; return; }
  if (pw.length < 6) { msg.innerHTML = '<div class="msg err">6 caractères minimum.</div>'; return; }
  const r = await fetch('/api/auth/reset-password', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ token: '${token}', password: pw }) });
  const data = await r.json();
  if (data.error) { msg.innerHTML = '<div class="msg err">' + data.error + '</div>'; return; }
  msg.innerHTML = '<div class="msg ok">✅ Mot de passe changé ! <a href="/" style="color:#e8b84b">Se connecter</a></div>';
  document.querySelector('button').disabled = true;
}
</script></body></html>`);
});

// GET /admin-reset — récupération mot de passe admin via ADMIN_RESET_TOKEN dans .env
router.get('/admin-reset', (req, res) => {
  const envToken = process.env.ADMIN_RESET_TOKEN;
  const { token } = req.query;
  if (!envToken) return res.status(404).send('Non configuré.');
  if (token !== envToken) return res.status(403).send('Token invalide.');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset Admin — GameDay</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{background:#16213e;border:1px solid #f0c040;border-radius:12px;padding:32px;max-width:400px;width:100%}
  h1{font-size:1.2rem;margin-bottom:20px;color:#f0c040}
  label{display:block;font-size:.75rem;margin-bottom:6px;color:#aaa}
  input{width:100%;padding:10px;background:#0f3460;border:1px solid #2a2a4a;border-radius:8px;color:#e0e0e0;font-family:inherit;font-size:.85rem;margin-bottom:16px}
  button{width:100%;padding:12px;background:#f0c040;color:#1a1a2e;border:none;border-radius:8px;font-weight:700;cursor:pointer}
  .msg{padding:10px;border-radius:8px;font-size:.8rem;margin-bottom:16px}
  .ok{background:#1a3a1a;color:#6fcf97;border:1px solid #6fcf97}
  .err{background:#3a1a1a;color:#eb5757;border:1px solid #eb5757}
</style>
</head>
<body>
<div class="card">
  <h1>🔑 Reset mot de passe admin</h1>
  <div id="msg"></div>
  <label>Nom d'utilisateur admin</label>
  <input type="text" id="usr" value="Panda">
  <label>Nouveau mot de passe</label>
  <input type="password" id="pw" placeholder="6 caractères minimum" autocomplete="new-password">
  <label>Confirmer</label>
  <input type="password" id="pw2" placeholder="Répéter" autocomplete="new-password">
  <button onclick="doReset()">Changer le mot de passe</button>
</div>
<script>
  async function doReset() {
    const usr = document.getElementById('usr').value.trim();
    const pw = document.getElementById('pw').value;
    const pw2 = document.getElementById('pw2').value;
    const msg = document.getElementById('msg');
    if (pw !== pw2) { msg.innerHTML = '<div class="msg err">Mots de passe différents.</div>'; return; }
    if (pw.length < 6) { msg.innerHTML = '<div class="msg err">6 caractères minimum.</div>'; return; }
    const r = await fetch('/api/admin-reset', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: '${envToken}', username: usr, password: pw }) });
    const data = await r.json();
    if (data.error) msg.innerHTML = '<div class="msg err">' + data.error + '</div>';
    else msg.innerHTML = '<div class="msg ok">✅ Mot de passe changé !</div>';
  }
</script>
</body>
</html>`);
});

router.post('/api/admin-reset', async (req, res) => {
  const envToken = process.env.ADMIN_RESET_TOKEN;
  const { token, username, password } = req.body;
  if (!envToken || token !== envToken) return res.status(403).json({ error: 'Token invalide' });
  if (!password || password.length < 6) return res.status(400).json({ error: '6 caractères minimum' });
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
  res.json({ ok: true });
});


module.exports = router;

// DELETE /api/admin/test-cleanup — supprime les séances de test [TEST] (admin)
router.delete('/api/admin/test-cleanup', requireAdmin, (req, res) => {
  const sessions = db.prepare("SELECT id FROM sessions WHERE name LIKE '[TEST]%'").all();
  if (!sessions.length) return res.json({ ok: true, count: 0 });
  const del = db.prepare('DELETE FROM sessions WHERE id = ?');
  db.transaction(() => sessions.forEach(s => del.run(s.id)))();
  res.json({ ok: true, count: sessions.length });
});
