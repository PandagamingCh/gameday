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
router.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await db.get('SELECT id, username, bgg_username, is_admin, bgg_synced_at, email FROM users WHERE id = $1', [req.session.userId]);
  res.json({ user });
});

// POST /api/settings/test-smtp — teste la config SMTP (admin)
router.post('/api/settings/test-smtp', requireAdmin, async (req, res) => {
  const user = await db.get('SELECT email FROM users WHERE id = ?', [req.session.userId]);
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
  const invite = await db.get('SELECT * FROM invites WHERE token = $1 AND is_active = 1 AND used_by IS NULL', [inviteToken]);
  if (!invite) return res.status(403).json({ error: 'Lien d\'invitation invalide ou déjà utilisé' });

  // Check username taken
  const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.run('INSERT INTO users (username, password_hash, bgg_username) VALUES ($1, $2, $3) RETURNING id', [username, passwordHash, bggUsername || '']);

  // Mark invite as used
  await db.run("UPDATE invites SET used_by = $1, used_at = NOW(), is_active = 0 WHERE token = $2", [result.lastInsertRowid, inviteToken]);

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
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
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
router.post('/api/logout', async (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// PATCH /api/me — update profile (bgg username, pseudo)
router.patch('/api/me', requireAuth, async (req, res) => {
  const { bggUsername, username } = req.body;
  if (username) {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) return res.status(400).json({ error: 'Pseudo trop court (2 caractères min)' });
    const existing = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [trimmed, req.session.userId]);
    if (existing) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
    await db.run('UPDATE users SET username = ? WHERE id = ?', [trimmed, req.session.userId]);
    req.session.username = trimmed;
  }
  await db.run('UPDATE users SET bgg_username = ? WHERE id = ?', [bggUsername || '', req.session.userId]);
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
