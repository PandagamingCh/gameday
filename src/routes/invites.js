// ─────────────────────────────────────────────────────────────
// routes/invites.js — Liens d'invitation
//
// Routes :
//   POST   /api/invites          (admin) Génère un lien d'invitation
//   GET    /api/invites          (admin) Liste les invitations
//   DELETE /api/invites/:token   (admin) Supprime une invitation
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ── INVITE ROUTES ───────────────────────────────────────────

// POST /api/invites — create invite (admin only)
router.post('/api/invites', requireAdmin, (req, res) => {
  const token = uuidv4();
  db.prepare('INSERT INTO invites (token, created_by) VALUES (?, ?)').run(token, req.session.userId);
  res.json({ token, link: `${req.protocol}://${req.get('host')}/register?invite=${token}` });
});

// GET /api/invites — list invites (admin)
router.get('/api/invites', requireAdmin, (req, res) => {
  const invites = db.prepare(`
    SELECT i.*, u.username as used_by_name, c.username as created_by_name
    FROM invites i
    LEFT JOIN users u ON u.id = i.used_by
    LEFT JOIN users c ON c.id = i.created_by
    ORDER BY i.created_at DESC
  `).all();
  res.json({ invites });
});

// DELETE /api/invites/:token — revoke invite (admin)
router.delete('/api/invites/:token', requireAdmin, (req, res) => {
  db.prepare('UPDATE invites SET is_active = 0 WHERE token = ?').run(req.params.token);
  res.json({ ok: true });
});


module.exports = router;
