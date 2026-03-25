// ─────────────────────────────────────────────────────────────
// routes/auth.js — Authentification et gestion du profil
//
// Routes :
//   GET  /api/me                  Retourne l'utilisateur connecté
//   POST /api/login               Connexion (username + password)
//   POST /api/logout              Déconnexion
//   POST /api/register            Inscription via lien d'invitation
//   PATCH /api/me                 Mise à jour profil (pseudo, BGG username)
//   PATCH /api/profile/email      Mise à jour email
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const { getEmailSetting, createTransporter } = require('../email');
const { syncUserCollection, getUserCollection } = require('../bgg');

// ── AUTH ROUTES ─────────────────────────────────────────────

// GET /api/me — current session info
router.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT id, username, bgg_username, is_admin, bgg_synced_at, email FROM users WHERE id = ?')
    .get(req.session.userId);
  res.json({ user });
});

// POST /api/settings/test-smtp — teste la config SMTP (admin)
router.post('/api/settings/test-smtp', requireAdmin, async (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  if (!user?.email) return res.status(400).json({ error: 'Ajoutez d\'abord votre email dans votre profil' });
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: 'GameDay — Test SMTP',
      text: 'La configuration SMTP fonctionne correctement !'
    });
    res.json({ ok: true });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/register — register with invite token
router.post('/api/register', async (req, res) => {
  const { username, password, bggUsername, inviteToken } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

  // Check invite token
  const invite = db.prepare('SELECT * FROM invites WHERE token = ? AND is_active = 1 AND used_by IS NULL')
    .get(inviteToken);
  if (!invite) return res.status(403).json({ error: 'Lien d\'invitation invalide ou déjà utilisé' });

  // Check username taken
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, bgg_username) VALUES (?, ?, ?)'
  ).run(username, passwordHash, bggUsername || '');

  // Mark invite as used
  db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now'), is_active = 0 WHERE token = ?")
    .run(result.lastInsertRowid, inviteToken);

  const userId = result.lastInsertRowid;
  req.session.userId = userId;
  req.session.isAdmin = false; // nouveaux inscrits jamais admin

  // Auto-sync BGG if provided
  if (bggUsername) {
    syncUserCollection(userId, bggUsername).catch(() => {});
  }

  res.json({ ok: true, user: { id: userId, username, bgg_username: bggUsername, is_admin: 0 } });
});

// POST /api/login
router.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects' });

  req.session.userId = user.id;
  req.session.isAdmin = !!user.is_admin;
  if (user.bgg_username) {
    syncUserCollection(user.id, user.bgg_username).catch(() => {});
  }

  res.json({ ok: true, user: { id: user.id, username: user.username, bgg_username: user.bgg_username, is_admin: user.is_admin } });
});

// POST /api/logout
router.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// PATCH /api/me — update profile (bgg username, pseudo)
router.patch('/api/me', requireAuth, async (req, res) => {
  const { bggUsername, username } = req.body;
  if (username) {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) return res.status(400).json({ error: 'Pseudo trop court (2 caractères min)' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(trimmed, req.session.userId);
    if (existing) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(trimmed, req.session.userId);
    req.session.username = trimmed;
  }
  db.prepare('UPDATE users SET bgg_username = ? WHERE id = ?').run(bggUsername || '', req.session.userId);
  if (bggUsername) {
    try {
      const result = await syncUserCollection(req.session.userId, bggUsername);
      return res.json({ ok: true, synced: result.count });
    } catch(e) {
      return res.json({ ok: true, syncError: e.message });
    }
  }
  res.json({ ok: true });
});


module.exports = router;
