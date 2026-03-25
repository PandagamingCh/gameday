// ─────────────────────────────────────────────────────────────
// routes/proposals.js — Propositions de jeux
//
// Routes :
//   POST   /api/sessions/:id/proposals  Proposer un jeu
//   PATCH  /api/proposals/:id           Modifier une proposition
//   DELETE /api/proposals/:id           Supprimer une proposition
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

// ── PROPOSAL ROUTES ─────────────────────────────────────────

// POST /api/sessions/:id/proposals
router.post('/api/sessions/:id/proposals', requireAuth, requirePerm('proposal_add'), (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { categoryId, bggId, name, year, thumbnail, minPlayers, maxPlayers, minTime, maxTime, myludoUrl, bggRating, bggWeight } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: 'Champs manquants' });

  // Check not already proposed in this category
  const dup = bggId
    ? db.prepare('SELECT id FROM proposals WHERE session_id = ? AND category_id = ? AND bgg_id = ?').get(sessionId, categoryId, bggId)
    : null;
  if (dup) return res.status(400).json({ error: 'Ce jeu est déjà proposé dans cette catégorie' });

  // Le proposant est le teacher par défaut
  const proposer = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  const defaultTeacher = proposer?.username || '';

  const p = db.prepare(`
    INSERT INTO proposals (session_id, category_id, proposed_by, bgg_id, name, year, thumbnail, min_players, max_players, min_time, max_time, myludo_url, teacher, bgg_rating, bgg_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, categoryId, req.session.userId, bggId || '', name, year || '', thumbnail || '', minPlayers || '', maxPlayers || '', minTime || '', maxTime || '', myludoUrl || '', defaultTeacher, bggRating || null, bggWeight || null);

  res.json({ ok: true, proposalId: p.lastInsertRowid });
});

// PATCH /api/proposals/:id
router.patch('/api/proposals/:id', requireAuth, requirePerm('proposal_edit', req => { const p = db.prepare('SELECT proposed_by FROM proposals WHERE id=?').get(parseInt(req.params.id)); return p?.proposed_by; }), (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Proposition introuvable' });
  const { name, year, minPlayers, maxPlayers, minTime, maxTime, bggId, myludoUrl, teacher, teachDuration, bggRating, bggWeight } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom obligatoire' });
  db.prepare(`
    UPDATE proposals SET name=?, year=?, min_players=?, max_players=?, min_time=?, max_time=?,
    bgg_id=COALESCE(NULLIF(?,''), bgg_id),
    myludo_url=?, teacher=?, teach_duration=?, bgg_rating=COALESCE(?,bgg_rating), bgg_weight=COALESCE(?,bgg_weight)
    WHERE id=?
  `).run(name, year||'', minPlayers||'', maxPlayers||'', minTime||'', maxTime||'', bggId||'', myludoUrl||'', teacher||'', teachDuration??null, bggRating||null, bggWeight||null, p.id);
  res.json({ ok: true });
});

// DELETE /api/proposals/:id
router.delete('/api/proposals/:id', requireAuth, requirePerm('proposal_delete', req => { const p = db.prepare('SELECT proposed_by FROM proposals WHERE id=?').get(parseInt(req.params.id)); return p?.proposed_by; }), (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Proposition introuvable' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (p.proposed_by !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: "Non autorise" });
  db.prepare('DELETE FROM proposals WHERE id = ?').run(p.id);
  res.json({ ok: true });
});


module.exports = router;
