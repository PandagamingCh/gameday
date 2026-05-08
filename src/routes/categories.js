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
router.post('/api/sessions/:id/categories', requireAuth, async (req, res) => {
  const { name, icon, subtitle } = req.body;
  const countRow = await db.get(`SELECT COUNT(*) as c FROM categories WHERE session_id = $1`, [parseInt(req.params.id)]);
  const count = countRow.c;
  const cat = await db.run(`INSERT INTO categories (session_id, name, icon, subtitle, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [parseInt(req.params.id), name, icon || '🎲', subtitle || '', count]);
  res.json({ ok: true, categoryId: cat.lastInsertRowid });
});

// PATCH /api/categories/:id
router.patch('/api/categories/:id', requireAuth, async (req, res) => {
  const { name, icon, subtitle } = req.body;
  await db.run('UPDATE categories SET name = COALESCE($1, name), icon = COALESCE($2, icon), subtitle = COALESCE($3, subtitle) WHERE id = $4', [name || null, icon || null, subtitle || null, parseInt(req.params.id)]);
  res.json({ ok: true });
});

// DELETE /api/categories/:id
router.delete('/api/categories/:id', requireAuth, async (req, res) => {
  const catId = parseInt(req.params.id);
  // Supprimer les propositions et votes liés
  await db.run('DELETE FROM rankings WHERE category_id = ?', [catId]);
  await db.run('DELETE FROM proposals WHERE category_id = ?', [catId]);
  await db.run('DELETE FROM categories WHERE id = ?', [catId]);
  res.json({ ok: true });
});


module.exports = router;
