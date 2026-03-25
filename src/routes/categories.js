// ─────────────────────────────────────────────────────────────
// routes/categories.js — Catégories de jeux d'une séance
//
// Routes :
//   POST   /api/sessions/:id/categories  Créer une catégorie
//   PATCH  /api/categories/:id           Modifier une catégorie
//   DELETE /api/categories/:id           Supprimer une catégorie
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

// ── CATEGORY ROUTES ─────────────────────────────────────────

// POST /api/sessions/:id/categories
router.post('/api/sessions/:id/categories', requireAuth, (req, res) => {
  const { name, icon, subtitle } = req.body;
  const count = db.prepare('SELECT COUNT(*) as c FROM categories WHERE session_id = ?').get(parseInt(req.params.id)).c;
  const cat = db.prepare('INSERT INTO categories (session_id, name, icon, subtitle, sort_order) VALUES (?, ?, ?, ?, ?)').run(parseInt(req.params.id), name, icon || '🎲', subtitle || '', count);
  res.json({ ok: true, categoryId: cat.lastInsertRowid });
});

// PATCH /api/categories/:id
router.patch('/api/categories/:id', requireAuth, (req, res) => {
  const { name, icon, subtitle } = req.body;
  db.prepare('UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), subtitle = COALESCE(?, subtitle) WHERE id = ?')
    .run(name || null, icon || null, subtitle || null, parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/categories/:id
router.delete('/api/categories/:id', requireAuth, (req, res) => {
  const catId = parseInt(req.params.id);
  // Supprimer les propositions et votes liés
  db.prepare('DELETE FROM rankings WHERE category_id = ?').run(catId);
  db.prepare('DELETE FROM proposals WHERE category_id = ?').run(catId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
  res.json({ ok: true });
});


module.exports = router;
