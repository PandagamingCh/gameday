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
const fs = require('fs');
const path = require('path');
const { runBackup } = require('../backup');
const { v4: uuidv4 } = require('uuid');

// ── ADMIN ROUTES ────────────────────────────────────────────

// GET /api/admin/backup/download/:filename — télécharger un backup
router.get('/api/admin/backup/download/:filename', requireAdmin, async (req, res) => {
  const fn = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, 'data/backups');
  const fp = path.join(backupDir, fn);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(fp);
});

// GET /api/admin/backup/list — lister les backups
router.get('/api/admin/backup/list', requireAdmin, async (req, res) => {
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, 'data/backups');
  try {
    const files = fs.readdirSync(backupDir).sort().reverse()
      .map(f => ({ name: f, size: fs.statSync(path.join(backupDir, f)).size }));
    res.json({ files });
  } catch(e) { res.json({ files: [] }); }
});

// POST /api/admin/backup/now — backup manuel
router.post('/api/admin/backup/now', requireAdmin, async (req, res) => {
  const { db } = require('./src/database');
  runBackup(db);
  res.json({ ok: true, message: 'Backup lancé' });
});

// GET /api/admin/users
router.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await db.all('SELECT id, username, bgg_username, is_admin, created_at, bgg_synced_at FROM users ORDER BY id');
  res.json({ users });
});

// DELETE /api/admin/users/:id
router.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  try {
    // Supprimer les données liées avant l'utilisateur
    await db.run('DELETE FROM rankings WHERE user_id = ?', [id]);
    await db.run('DELETE FROM session_participants WHERE user_id = ?', [id]);
    await db.run('DELETE FROM doodle_votes WHERE user_id = ?', [id]);
    await db.run('DELETE FROM session_private_members WHERE user_id = ?', [id]);
    await db.run('DELETE FROM reset_tokens WHERE user_id = ?', [id]);
    // Nullifier les références sans CASCADE
    await db.run('UPDATE proposals SET proposed_by = NULL WHERE proposed_by = ?', [id]);
    await db.run('UPDATE sessions SET created_by = NULL WHERE created_by = ?', [id]);
    await db.run('UPDATE invites SET created_by = NULL WHERE created_by = ?', [id]);
    await db.run('UPDATE invites SET used_by = NULL WHERE used_by = ?', [id]);
    try { await db.run('UPDATE doodles SET created_by = NULL WHERE created_by = ?', [id]); } catch(e) {}
    // Les proposals et sessions créées par cet user restent (on ne les supprime pas)
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch(e) {
    console.error('Delete user error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/reset-link/:userId — générer lien reset pour un user
router.post('/api/admin/reset-link/:userId', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  // Invalider les anciens tokens
  await db.run('UPDATE reset_tokens SET used=1 WHERE user_id=?', [userId]);
  const token = uuidv4();
  await db.run('INSERT INTO reset_tokens (token, user_id) VALUES (?, ?)', [token, userId]);
  const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
  res.json({ ok: true, link, username: user.username });
});

// GET /api/reset-password?token= — vérifier token
router.get('/api/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manquant' });
  const r = await db.get('SELECT rt.*, u.username FROM reset_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token=? AND rt.used=0', [token]);
  if (!r) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  // Expiration 24h
  const created = new Date(r.created_at);
  if (Date.now() - created.getTime() > 24 * 60 * 60 * 1000) {
    await db.run('UPDATE reset_tokens SET used=1 WHERE token=?', [token]);
    return res.status(400).json({ error: 'Lien expiré (24h)' });
  }
  res.json({ ok: true, username: r.username });
});

// POST /api/reset-password — changer le mot de passe avec token
router.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Données manquantes' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
  const r = await db.get('SELECT * FROM reset_tokens WHERE token=? AND used=0', [token]);
  if (!r) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  const created = new Date(r.created_at);
  if (Date.now() - created.getTime() > 24 * 60 * 60 * 1000) {
    await db.run('UPDATE reset_tokens SET used=1 WHERE token=?', [token]);
    return res.status(400).json({ error: 'Lien expiré (24h)' });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, r.user_id]);
  await db.run('UPDATE reset_tokens SET used=1 WHERE token=?', [token]);
  res.json({ ok: true });
});

// GET /reset-password — page de reset par email
router.get('/reset-password', async (req, res) => {
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
router.get('/admin-reset', async (req, res) => {
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
  const user = await db.get('SELECT id FROM users WHERE username=?', [username]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const hash = await bcrypt.hash(password, 10);
  await db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, user.id]);
  res.json({ ok: true });
});



// ── GESTION DES MÉDIAS ──────────────────────────────────────


// GET /api/admin/media/db-orphans — entrées en base sans fichier sur disque
router.get('/api/admin/media/db-orphans', requireAdmin, async (req, res) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  let dbRows = [];
  try {
    dbRows = await db.all("SELECT id, url, session_id, game_id, caption FROM archive_media WHERE url LIKE '/uploads/%'");
  } catch(e) { return res.status(500).json({ error: e.message }); }

  const dbOrphans = [];
  for (const row of dbRows) {
    const fullPath = path.join(uploadsDir, row.url.replace('/uploads/', ''));
    if (!fs.existsSync(fullPath)) {
      // Récupérer info séance/jeu
      const sess = await db.get('SELECT name FROM sessions WHERE id=?', [row.session_id]);
      const game = row.game_id ? await db.get('SELECT game_name FROM archive_games WHERE id=?', [row.game_id]) : null;
      dbOrphans.push({
        id: row.id,
        url: row.url,
        caption: row.caption,
        session_id: row.session_id,
        session_name: sess?.name || '?',
        game_id: row.game_id,
        game_name: game?.game_name || null
      });
    }
  }

  res.json({ dbOrphans, total: dbRows.length });
});

// DELETE /api/admin/media/db-orphans — supprime les entrées de base orphelines
router.delete('/api/admin/media/db-orphans', requireAdmin, async (req, res) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  let dbRows = [];
  try {
    dbRows = await db.all("SELECT id, url FROM archive_media WHERE url LIKE '/uploads/%'");
  } catch(e) { return res.status(500).json({ error: e.message }); }

  const toDelete = [];
  for (const row of dbRows) {
    const fullPath = path.join(uploadsDir, row.url.replace('/uploads/', ''));
    if (!fs.existsSync(fullPath)) toDelete.push(row.id);
  }

  if (toDelete.length === 0) return res.json({ ok: true, deleted: 0 });

  try {
    await db.transaction(async (client) => {
      for (const id of toDelete) {
        await client.query('DELETE FROM archive_media WHERE id = $1', [id]);
      }
    });
  } catch(e) { return res.status(500).json({ error: e.message }); }

  res.json({ ok: true, deleted: toDelete.length });
});

// GET /api/admin/media/scan — scanner les fichiers uploads vs base
router.get('/api/admin/media/scan', requireAdmin, async (req, res) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');

  // Récupérer toutes les URLs en base
  let dbRows = [];
  try {
    dbRows = await db.all("SELECT url, session_id, game_id, caption FROM archive_media WHERE url LIKE '/uploads/%'");
  } catch(e) {
    return res.status(500).json({ error: 'Erreur DB: ' + e.message });
  }

  const dbUrls = new Set(dbRows.map(r => r.url));

  // Scanner les fichiers sur disque
  const orphans = [];
  const used = [];

  function scanDir(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch(e) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relBase + entry.name + '/');
      } else {
        const relUrl = '/uploads/' + relBase + entry.name;
        const fullPath = path.join(dir, entry.name);
        let stat;
        try { stat = fs.statSync(fullPath); } catch(e) { continue; }
        const info = { url: relUrl, size: stat.size, mtime: stat.mtime };
        if (dbUrls.has(relUrl)) {
          // Trouver les détails (session, game, caption)
          const dbRow = dbRows.find(r => r.url === relUrl);
          if (dbRow) {
            info.session_id = dbRow.session_id;
            info.game_id = dbRow.game_id;
            info.caption = dbRow.caption;
          }
          used.push(info);
        } else {
          orphans.push(info);
        }
      }
    }
  }

  try {
    scanDir(uploadsDir, '');
  } catch(e) {
    return res.status(500).json({ error: 'Erreur scan: ' + e.message });
  }

  // Détecter les doublons en base
  const dupeRows = await db.all("SELECT url, COUNT(*) as cnt FROM archive_media GROUP BY url HAVING cnt > 1");
  const duplicates = {};
  dupeRows.forEach(r => duplicates[r.url] = r.cnt);

  const totalSize = [...orphans, ...used].reduce((s, f) => s + f.size, 0);
  const orphanSize = orphans.reduce((s, f) => s + f.size, 0);

  res.json({
    orphans: orphans.sort((a,b) => b.size - a.size),
    used: used.sort((a,b) => b.size - a.size),
    duplicates,
    totalSize,
    orphanSize,
    totalCount: orphans.length + used.length
  });
});



// DELETE /api/admin/media/orphans — supprime les fichiers orphelins du disque
router.delete('/api/admin/media/orphans', requireAdmin, async (req, res) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const { urls } = req.body;
  if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls requis (array)' });

  let deleted = 0;
  const errors = [];
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) continue; // sécurité
    const fullPath = path.join(uploadsDir, url.replace('/uploads/', ''));
    // Vérifier qu'on reste bien dans uploadsDir (pas de ../)
    if (!fullPath.startsWith(uploadsDir)) continue;
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    } catch(e) {
      errors.push({ url, error: e.message });
    }
  }
  res.json({ ok: true, deleted, errors });
});


// ── ARBORESCENCE MÉDIAS ─────────────────────────────────────

// GET /api/admin/media/tree — arborescence des dossiers et fichiers
router.get('/api/admin/media/tree', requireAdmin, async (req, res) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');

  // Charger toutes les références BDD une seule fois
  let dbRows = [];
  try {
    dbRows = await db.all(`
      SELECT m.url, m.thumbnail, m.session_id, m.game_id, m.caption,
             s.name as session_name, g.game_name
      FROM archive_media m
      LEFT JOIN sessions s ON s.id = m.session_id
      LEFT JOIN archive_games g ON g.id = m.game_id
      WHERE m.url LIKE '/uploads/%'
    `);
  } catch(e) { return res.status(500).json({ error: e.message }); }

  // Indexer par URL
  const refsByUrl = {};
  for (const row of dbRows) {
    refsByUrl[row.url] = row;
    if (row.thumbnail && row.thumbnail.startsWith('/uploads/')) {
      // Marquer aussi le thumbnail comme utilisé
      if (!refsByUrl[row.thumbnail]) refsByUrl[row.thumbnail] = { ...row, _isThumbnail: true };
    }
  }

  // Construire l'arborescence
  const tree = { folders: [], files: [] };

  if (!fs.existsSync(uploadsDir)) return res.json(tree);

  const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const folderPath = path.join(uploadsDir, entry.name);
      const folderFiles = [];
      let totalSize = 0;
      try {
        const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isFile() || sub.name.startsWith('.')) continue;
          const fullPath = path.join(folderPath, sub.name);
          let stat;
          try { stat = fs.statSync(fullPath); } catch(e) { continue; }
          const url = '/uploads/' + entry.name + '/' + sub.name;
          const ref = refsByUrl[url];
          folderFiles.push({
            name: sub.name,
            url,
            size: stat.size,
            mtime: stat.mtime,
            inUse: !!ref,
            session_id: ref?.session_id || null,
            session_name: ref?.session_name || null,
            game_id: ref?.game_id || null,
            game_name: ref?.game_name || null,
            caption: ref?.caption || null,
            isThumbnail: ref?._isThumbnail || false
          });
          totalSize += stat.size;
        }
      } catch(e) {}
      tree.folders.push({
        name: entry.name,
        files: folderFiles,
        totalSize,
        fileCount: folderFiles.length,
        usedCount: folderFiles.filter(f => f.inUse).length
      });
    } else if (entry.isFile()) {
      const fullPath = path.join(uploadsDir, entry.name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch(e) { continue; }
      const url = '/uploads/' + entry.name;
      const ref = refsByUrl[url];
      tree.files.push({
        name: entry.name,
        url,
        size: stat.size,
        mtime: stat.mtime,
        inUse: !!ref,
        session_id: ref?.session_id || null,
        session_name: ref?.session_name || null,
        game_id: ref?.game_id || null,
        game_name: ref?.game_name || null,
        caption: ref?.caption || null
      });
    }
  }

  // Trier dossiers par nom
  tree.folders.sort((a, b) => a.name.localeCompare(b.name));
  tree.files.sort((a, b) => a.name.localeCompare(b.name));

  res.json(tree);
});

// Helper : valide qu'un nom de dossier/fichier est sûr (pas de ../ etc)
function isSafeName(name) {
  if (typeof name !== 'string' || !name.length) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  if (name.startsWith('.')) return false;
  return /^[a-zA-Z0-9._\- ]+$/.test(name);
}

// POST /api/admin/media/rename-folder — renomme un dossier
router.post('/api/admin/media/rename-folder', requireAdmin, async (req, res) => {
  const { oldName, newName } = req.body;
  if (!isSafeName(oldName) || !isSafeName(newName)) return res.status(400).json({ error: 'Nom invalide' });

  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const oldPath = path.join(uploadsDir, oldName);
  const newPath = path.join(uploadsDir, newName);

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Dossier introuvable' });
  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà' });

  try {
    fs.renameSync(oldPath, newPath);
  } catch(e) {
    return res.status(500).json({ error: 'Erreur renommage: ' + e.message });
  }

  // MAJ BDD : remplacer /uploads/oldName/ par /uploads/newName/ partout
  const oldPrefix = '/uploads/' + oldName + '/';
  const newPrefix = '/uploads/' + newName + '/';
  let updated = 0;
  try {
    const r = await db.run(`UPDATE archive_media SET url = $1 || SUBSTR(url, $2) WHERE url LIKE $3 || '%'`, [newPrefix, oldPrefix.length + 1, oldPrefix]);
    updated += r.changes;
    const rt = await db.run(`UPDATE archive_media SET thumbnail = $1 || SUBSTR(thumbnail, $2) WHERE thumbnail LIKE $3 || '%'`, [newPrefix, oldPrefix.length + 1, oldPrefix]);
    updated += rt.changes;
  } catch(e) { console.error('MAJ BDD rename folder:', e.message); }

  res.json({ ok: true, updated });
});

// POST /api/admin/media/rename-file — renomme un fichier
router.post('/api/admin/media/rename-file', requireAdmin, async (req, res) => {
  const { folder, oldName, newName } = req.body;
  if (folder !== '' && !isSafeName(folder)) return res.status(400).json({ error: 'Dossier invalide' });
  if (!isSafeName(oldName) || !isSafeName(newName)) return res.status(400).json({ error: 'Nom invalide' });

  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const baseDir = folder ? path.join(uploadsDir, folder) : uploadsDir;
  const oldPath = path.join(baseDir, oldName);
  const newPath = path.join(baseDir, newName);

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Fichier introuvable' });
  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Un fichier avec ce nom existe déjà' });

  try {
    fs.renameSync(oldPath, newPath);
  } catch(e) {
    return res.status(500).json({ error: 'Erreur renommage: ' + e.message });
  }

  const oldUrl = '/uploads/' + (folder ? folder + '/' : '') + oldName;
  const newUrl = '/uploads/' + (folder ? folder + '/' : '') + newName;
  let updated = 0;
  try {
    updated += await db.run('UPDATE archive_media SET url = ? WHERE url = ?', [newUrl, oldUrl]).changes;
    updated += await db.run('UPDATE archive_media SET thumbnail = ? WHERE thumbnail = ?', [newUrl, oldUrl]).changes;
  } catch(e) { console.error('MAJ BDD rename file:', e.message); }

  res.json({ ok: true, updated });
});

// POST /api/admin/media/move-file — déplace un fichier vers un autre dossier
router.post('/api/admin/media/move-file', requireAdmin, async (req, res) => {
  const { fromFolder, toFolder, fileName } = req.body;
  if (fromFolder !== '' && !isSafeName(fromFolder)) return res.status(400).json({ error: 'Dossier source invalide' });
  if (toFolder !== '' && !isSafeName(toFolder)) return res.status(400).json({ error: 'Dossier destination invalide' });
  if (!isSafeName(fileName)) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (fromFolder === toFolder) return res.status(400).json({ error: 'Source et destination identiques' });

  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const oldPath = fromFolder ? path.join(uploadsDir, fromFolder, fileName) : path.join(uploadsDir, fileName);
  const toDir = toFolder ? path.join(uploadsDir, toFolder) : uploadsDir;
  const newPath = path.join(toDir, fileName);

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Fichier introuvable' });
  if (!fs.existsSync(toDir)) return res.status(404).json({ error: 'Dossier destination introuvable' });
  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Un fichier avec ce nom existe déjà dans la destination' });

  try {
    fs.renameSync(oldPath, newPath);
  } catch(e) {
    try {
      fs.copyFileSync(oldPath, newPath);
      fs.unlinkSync(oldPath);
    } catch(e2) {
      return res.status(500).json({ error: 'Erreur déplacement: ' + e2.message });
    }
  }

  const oldUrl = '/uploads/' + (fromFolder ? fromFolder + '/' : '') + fileName;
  const newUrl = '/uploads/' + (toFolder ? toFolder + '/' : '') + fileName;
  let updated = 0;
  try {
    updated += await db.run('UPDATE archive_media SET url = ? WHERE url = ?', [newUrl, oldUrl]).changes;
    updated += await db.run('UPDATE archive_media SET thumbnail = ? WHERE thumbnail = ?', [newUrl, oldUrl]).changes;
  } catch(e) { console.error('MAJ BDD move file:', e.message); }

  res.json({ ok: true, updated });
});

// DELETE /api/admin/media/folder — supprime un dossier (et son contenu) + nettoie BDD
router.delete('/api/admin/media/folder', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Nom invalide' });

  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const dirPath = path.join(uploadsDir, name);

  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Dossier introuvable' });

  // Lister les fichiers pour compter
  let fileCount = 0;
  try {
    fs.readdirSync(dirPath).forEach(() => fileCount++);
  } catch(e) {}

  // Supprimer récursivement
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur suppression: ' + e.message });
  }

  // Nettoyer la BDD
  const prefix = '/uploads/' + name + '/';
  let deleted = 0;
  try {
    const delRes = await db.run('DELETE FROM archive_media WHERE url LIKE $1', [prefix + '%']); deleted = delRes.changes;
  } catch(e) {}

  res.json({ ok: true, fileCount, dbDeleted: deleted });
});

// DELETE /api/admin/media/file — supprime un fichier + nettoie BDD
router.delete('/api/admin/media/file', requireAdmin, async (req, res) => {
  const { folder, name } = req.body;
  if (folder !== '' && !isSafeName(folder)) return res.status(400).json({ error: 'Dossier invalide' });
  if (!isSafeName(name)) return res.status(400).json({ error: 'Nom invalide' });

  const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
  const filePath = folder ? path.join(uploadsDir, folder, name) : path.join(uploadsDir, name);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });

  try {
    fs.unlinkSync(filePath);
  } catch(e) {
    return res.status(500).json({ error: 'Erreur suppression: ' + e.message });
  }

  const url = '/uploads/' + (folder ? folder + '/' : '') + name;
  let deleted = 0;
  try {
    deleted += await db.run('DELETE FROM archive_media WHERE url = ? OR thumbnail = ?', [url, url]).changes;
  } catch(e) {}

  res.json({ ok: true, dbDeleted: deleted });
});



// POST /api/admin/users — créer un utilisateur (admin)
router.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, bggUsername } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

  // Vérifier que le pseudo n'existe pas
const exists = await db.get(`SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)`, [username.trim()]);
  if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await db.run('INSERT INTO users (username, password_hash, bgg_username) VALUES ($1, $2, $3) RETURNING id', [username.trim(), hash, (bggUsername || '').trim()]);
    res.json({ ok: true, id: r.lastInsertRowid, username: username.trim() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;

// DELETE /api/admin/test-cleanup — supprime les séances de test [TEST] (admin)
router.delete('/api/admin/test-cleanup', requireAdmin, async (req, res) => {
  const sessions = await db.all("SELECT id FROM sessions WHERE name LIKE '[TEST]%'");
  if (!sessions.length) return res.json({ ok: true, count: 0 });
  await db.transaction(async (client) => {
    for (const s of sessions) {
      await client.query('DELETE FROM sessions WHERE id = $1', [s.id]);
    }
  });
  res.json({ ok: true, count: sessions.length });
});
