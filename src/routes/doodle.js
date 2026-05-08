// ─────────────────────────────────────────────────────────────
// routes/doodle.js — Sondages de disponibilité
//
// Routes :
//   POST   /api/doodles               Crée un sondage
//   GET    /api/doodles               Liste les sondages ouverts
//   GET    /api/doodles/:token        Détail d'un sondage
//   POST   /api/doodles/:token/vote   Soumet son vote
//   POST   /api/doodles/:token/validate  Valide une date et crée une séance
//   PATCH  /api/doodles/:token/toggle Ouvre/ferme un sondage
//   DELETE /api/doodles/:token        Supprime un sondage
//   GET    /doodle/:token             Page publique d'un sondage (HTML)
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── DOODLE ROUTES ────────────────────────────────────────────

// POST /api/doodles — créer un sondage
router.post('/api/doodles', requireAuth, async (req, res) => {
  const { title, dates } = req.body;
  if (!title || !Array.isArray(dates) || !dates.length)
    return res.status(400).json({ error: 'Titre et dates requis' });
  const token = uuidv4();
  const r = await db.run(`INSERT INTO doodles (token, title, created_by) VALUES ($1,$2,$3) RETURNING id`, [token, title.trim(), req.session.userId]);
  await db.transaction(async (client) => {
    const sortedDates = [...dates].sort();
    for (let i = 0; i < sortedDates.length; i++) {
      await client.query('INSERT INTO doodle_dates (doodle_id, date, sort_order) VALUES ($1,$2,$3)', [r.lastInsertRowid, sortedDates[i], i]);
    }
  });
  req.app.locals.broadcastAll?.('doodle.created', { doodleId: r.lastInsertRowid, token });
  res.json({ ok: true, token, id: r.lastInsertRowid });
});

// GET /api/doodles — liste mes sondages avec statut de vote de l'utilisateur
router.get('/api/doodles', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const doodles = await db.all(`SELECT d.*, u.username as creator FROM doodles d JOIN users u ON u.id=d.created_by ORDER BY d.created_at DESC`);
  const doodlesWithVote = await Promise.all(doodles.map(async d => {
    const voted = await db.get(`SELECT 1 FROM doodle_votes dv JOIN doodle_dates dd ON dd.id=dv.date_id WHERE dd.doodle_id=$1 AND dv.user_id=$2 LIMIT 1`, [d.id, userId]);
    return { ...d, has_voted: !!voted };
  }));
  res.json({ doodles: doodlesWithVote });
});

// GET /api/doodles/:token — détail d'un sondage
router.get('/api/doodles/:token', requireAuth, async (req, res) => {
  const doodle = await db.get('SELECT d.*, u.username as creator FROM doodles d JOIN users u ON u.id=d.created_by WHERE d.token=?', [req.params.token]);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const dates = await db.all('SELECT * FROM doodle_dates WHERE doodle_id=? ORDER BY sort_order', [doodle.id]);
  const votes = await db.all(`SELECT dv.*, u.username FROM doodle_votes dv JOIN users u ON u.id=dv.user_id WHERE dv.doodle_id=?`, [doodle.id]);
  const voters = [...new Set(votes.map(v => v.username))];
  res.json({ doodle, dates, votes, voters });
});

// POST /api/doodles/:token/vote — voter
router.post('/api/doodles/:token/vote', requireAuth, async (req, res) => {
  const doodle = await db.get('SELECT * FROM doodles WHERE token=?', [req.params.token]);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const { answers } = req.body; // { dateId: 'yes'|'no'|'maybe' }
  if (!answers) return res.status(400).json({ error: 'Réponses manquantes' });
  await db.transaction(async (client) => {
    for (const [dateId, answer] of Object.entries(answers)) {
      if (!['yes','no','maybe'].includes(answer)) continue;
      await client.query(`INSERT INTO doodle_votes (doodle_id, date_id, user_id, answer) VALUES ($1,$2,$3,$4) ON CONFLICT(date_id, user_id) DO UPDATE SET answer=EXCLUDED.answer`, [doodle.id, parseInt(dateId), req.session.userId, answer]);
    }
  });
  req.app.locals.broadcastAll?.('doodle.voted', { doodleId: doodle.id, userId: req.session.userId });
  res.json({ ok: true });
});

// POST /api/doodles/:token/validate — valider une date et créer la séance
router.post('/api/doodles/:token/validate', requireAuth, async (req, res) => {
  const doodle = await db.get('SELECT * FROM doodles WHERE token=?', [req.params.token]);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = await db.get('SELECT is_admin FROM users WHERE id=?', [req.session.userId]);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  const { dateId, sessionName } = req.body;
  if (!dateId) return res.status(400).json({ error: 'Date requise' });
  const dateRow = await db.get(`SELECT * FROM doodle_dates WHERE id=$1 AND doodle_id=$2`, [parseInt(dateId), doodle.id]);
  if (!dateRow) return res.status(400).json({ error: 'Date invalide' });
  // Récupérer les ✅ pour cette date
  const yesVotes = await db.all(`SELECT dv.user_id FROM doodle_votes dv WHERE dv.date_id=$1 AND dv.answer='yes'`, [parseInt(dateId)]);
  // Créer la séance
  const name = (sessionName || doodle.title).trim();
  const r = await db.run('INSERT INTO sessions (name, date, created_by, is_open) VALUES (?,?,?,1)', [name, dateRow.date, req.session.userId]);
  const sessionId = r.lastInsertRowid;
  // Inscrire le créateur + tous les ✅
  await db.transaction(async (client) => {
    await client.query('INSERT INTO session_participants (session_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sessionId, req.session.userId]);
    for (const v of yesVotes) {
      await client.query('INSERT INTO session_participants (session_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sessionId, v.user_id]);
    }
  });
  // Clôturer le doodle
  await db.run('UPDATE doodles SET closed=1, session_id=? WHERE id=?', [sessionId, doodle.id]);
  res.json({ ok: true, sessionId });
});

// PATCH /api/doodles/:token/toggle — ouvrir/clôturer
router.patch('/api/doodles/:token/toggle', requireAuth, async (req, res) => {
  const doodle = await db.get('SELECT * FROM doodles WHERE token=?', [req.params.token]);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = await db.get('SELECT is_admin FROM users WHERE id=?', [req.session.userId]);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  const { closed } = req.body;
  await db.run('UPDATE doodles SET closed=? WHERE id=?', [closed ? 1 : 0, doodle.id]);
  res.json({ ok: true });
});

// DELETE /api/doodles/:token — supprimer un sondage
router.delete('/api/doodles/:token', requireAuth, async (req, res) => {
  const doodle = await db.get('SELECT * FROM doodles WHERE token=?', [req.params.token]);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = await db.get('SELECT is_admin FROM users WHERE id=?', [req.session.userId]);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  await db.run('DELETE FROM doodles WHERE id=?', [doodle.id]);
  res.json({ ok: true });
});

// GET /doodle/:token — page publique doodle (SPA)
router.get('/doodle/:token', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /doodle — page liste doodles (SPA)
router.get('/doodle', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


module.exports = router;
