// ─────────────────────────────────────────────────────────────
// routes/rankings.js — Votes et classements
//
// Routes :
//   POST   /api/sessions/:id/rankings             Soumettre son vote
//   DELETE /api/sessions/:id/rankings/:categoryId Retirer son vote
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

// ── RANKING ROUTES ──────────────────────────────────────────

// POST /api/sessions/:id/rankings — submit full ranking for a category
router.post('/api/sessions/:id/rankings', requireAuth, requirePerm('vote'), (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { categoryId, order } = req.body; // order = [proposalId, proposalId, ...]
  if (!categoryId || !Array.isArray(order)) return res.status(400).json({ error: 'Données invalides' });

  // Vérifier que l'utilisateur est inscrit à la séance
  const isParticipant = db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND user_id = ?').get(sessionId, req.session.userId);
  if (!isParticipant) return res.status(403).json({ error: 'Tu dois être inscrit à la séance pour voter.' });

  // Vérifier que les votes ne sont pas verrouillés (sauf admin)
  const session = db.prepare('SELECT votes_locked, created_by FROM sessions WHERE id = ?').get(sessionId);
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (session?.votes_locked && session.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Les votes sont verrouillés par l\'organisateur.' });

  // Vérifier que tous les proposal_id appartiennent bien à cette catégorie
  const validIds = new Set(
    db.prepare('SELECT id FROM proposals WHERE session_id = ? AND category_id = ?')
      .all(sessionId, categoryId).map(p => p.id)
  );
  const sanitizedOrder = order.map(id => parseInt(id)).filter(id => validIds.has(id));

  // Delete previous ranking for this user/category
  db.prepare('DELETE FROM rankings WHERE session_id = ? AND category_id = ? AND user_id = ?').run(sessionId, categoryId, req.session.userId);

  const insert = db.prepare('INSERT INTO rankings (session_id, category_id, user_id, proposal_id, rank) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    sanitizedOrder.forEach((proposalId, i) => {
      insert.run(sessionId, categoryId, req.session.userId, proposalId, i + 1);
    });
  })();

  res.json({ ok: true });
});

// DELETE /api/sessions/:id/rankings/:categoryId — retract ranking
router.delete('/api/sessions/:id/rankings/:categoryId', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const isParticipant = db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND user_id = ?').get(sessionId, req.session.userId);
  if (!isParticipant) return res.status(403).json({ error: 'Tu dois être inscrit à la séance pour modifier ton vote.' });
  db.prepare('DELETE FROM rankings WHERE session_id = ? AND category_id = ? AND user_id = ?')
    .run(sessionId, parseInt(req.params.categoryId), req.session.userId);
  res.json({ ok: true });
});


module.exports = router;
