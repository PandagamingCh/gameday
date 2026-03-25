// ─────────────────────────────────────────────────────────────
// routes/settings.js — Paramètres globaux du site
//
// Routes :
//   GET   /api/settings              Retourne les paramètres (thème, features)
//   PATCH /api/settings              (admin) Modifie les paramètres
//   GET   /api/permissions           Liste des niveaux de permission par action
//   PATCH /api/permissions           (admin) Modifie les permissions
//   GET   /api/users                 Liste des utilisateurs
//   POST  /api/settings/test-smtp    (admin) Teste la configuration SMTP
//   POST  /api/auth/forgot-password  Envoie un email de reset
//   POST  /api/auth/reset-password   Réinitialise le mot de passe via token
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const { getEmailSetting, createTransporter } = require('../email');
// nodemailer utilisé via createTransporter()
const crypto = require('crypto');

// ── SETTINGS (thème global) ──────────────────────────────────
// GET /api/settings — retourne tous les settings (public)
router.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; } });
  res.json({ settings });
});

// PATCH /api/settings — met à jour un setting (admin uniquement)
router.patch('/api/settings', requireAdmin, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key requis' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  res.json({ ok: true });
});

// ── EMAIL RESET ──────────────────────────────────────────────
// POST /api/auth/forgot-password
router.post('/api/auth/forgot-password', async (req, res) => {
  // Toujours répondre OK pour ne pas révéler si l'email existe
  const emailEnabled = getEmailSetting('email_reset_enabled');
  if (!emailEnabled) return res.status(400).json({ error: 'Reset par email non activé' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const user = db.prepare('SELECT id, username FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.json({ ok: true }); // silencieux

  // Générer token 24h
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);

  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const resetUrl = `${appUrl}/reset-password?token=${token}`;
  const siteName = getEmailSetting('site_name') || 'GameDay';
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${siteName}" <${fromEmail}>`,
      to: email,
      subject: `${siteName} — Réinitialisation de mot de passe`,
      html: `
        <div style="font-family:monospace;max-width:480px;margin:0 auto;padding:32px;background:#1a1814;color:#f0ead8;border-radius:12px">
          <h2 style="color:#e8b84b;margin-bottom:16px">Game<em>Day</em></h2>
          <p>Bonjour <strong>${user.username}</strong>,</p>
          <p style="margin-top:12px">Tu as demandé à réinitialiser ton mot de passe.</p>
          <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#e8b84b;color:#0f0e0b;border-radius:8px;text-decoration:none;font-weight:700">
            Réinitialiser mon mot de passe
          </a>
          <p style="font-size:.8rem;color:#6a6458">Ce lien expire dans 24h. Si tu n'as pas demandé cette réinitialisation, ignore cet email.</p>
        </div>
      `
    });
  } catch(e) {
    console.error('Email reset error:', e.message);
    return res.status(502).json({ error: 'Erreur envoi email. Vérifiez la configuration SMTP.' });
  }
  res.json({ ok: true });
});

// POST /api/auth/reset-password
router.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Token et mot de passe (6 car. min) requis' });

  const row = db.prepare('SELECT * FROM reset_tokens WHERE token = ? AND used = 0').get(token);
  if (!row) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });

  // Vérifier expiration
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Lien expiré — demandez un nouveau reset' });
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
  db.prepare('UPDATE reset_tokens SET used = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// PATCH /api/profile/email — mettre à jour son email
router.patch('/api/profile/email', requireAuth, (req, res) => {
  const { email } = req.body;
  const emailVal = email ? email.toLowerCase().trim() : null;
  if (emailVal) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(emailVal, req.session.userId);
    if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé' });
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(emailVal, req.session.userId);
  res.json({ ok: true });
});

// GET /api/permissions
router.get('/api/permissions', requireAuth, (req, res) => {
  const perms = db.prepare('SELECT action, level FROM permissions').all();
  res.json({ permissions: perms });
});

// PATCH /api/permissions — admin only
router.patch('/api/permissions', requireAdmin, (req, res) => {
  const { permissions } = req.body; // [{action, level}, ...]
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'Format invalide' });
  const upd = db.prepare('INSERT OR REPLACE INTO permissions (action, level) VALUES (?, ?)');
  db.transaction(() => permissions.forEach(({ action, level }) => upd.run(action, parseInt(level))))();
  res.json({ ok: true });
});

// GET /api/users — list all users (for browsing collections)
router.get('/api/users', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.bgg_username, u.bgg_synced_at,
           COUNT(bg.id) as game_count
    FROM users u
    LEFT JOIN bgg_games bg ON bg.user_id = u.id
    GROUP BY u.id
    ORDER BY u.username COLLATE NOCASE
  `).all();
  res.json({ users });
});


module.exports = router;
