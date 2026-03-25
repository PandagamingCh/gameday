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
router.post('/api/doodles', requireAuth, (req, res) => {
  const { title, dates } = req.body;
  if (!title || !Array.isArray(dates) || !dates.length)
    return res.status(400).json({ error: 'Titre et dates requis' });
  const token = uuidv4();
  const r = db.prepare('INSERT INTO doodles (token, title, created_by) VALUES (?,?,?)').run(token, title.trim(), req.session.userId);
  const insertDate = db.prepare('INSERT INTO doodle_dates (doodle_id, date, sort_order) VALUES (?,?,?)');
  db.transaction(() => {
    dates.sort().forEach((d, i) => insertDate.run(r.lastInsertRowid, d, i));
  })();
  res.json({ ok: true, token, id: r.lastInsertRowid });
});

// GET /api/doodles — liste mes sondages
router.get('/api/doodles', requireAuth, (req, res) => {
  const doodles = db.prepare(`SELECT d.*, u.username as creator FROM doodles d JOIN users u ON u.id=d.created_by ORDER BY d.created_at DESC`).all();
  res.json({ doodles });
});

// GET /api/doodles/:token — détail d'un sondage
router.get('/api/doodles/:token', requireAuth, (req, res) => {
  const doodle = db.prepare('SELECT d.*, u.username as creator FROM doodles d JOIN users u ON u.id=d.created_by WHERE d.token=?').get(req.params.token);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const dates = db.prepare('SELECT * FROM doodle_dates WHERE doodle_id=? ORDER BY sort_order').all(doodle.id);
  const votes = db.prepare(`SELECT dv.*, u.username FROM doodle_votes dv JOIN users u ON u.id=dv.user_id WHERE dv.doodle_id=?`).all(doodle.id);
  const voters = [...new Set(votes.map(v => v.username))];
  res.json({ doodle, dates, votes, voters });
});

// POST /api/doodles/:token/vote — voter
router.post('/api/doodles/:token/vote', requireAuth, (req, res) => {
  const doodle = db.prepare('SELECT * FROM doodles WHERE token=?').get(req.params.token);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const { answers } = req.body; // { dateId: 'yes'|'no'|'maybe' }
  if (!answers) return res.status(400).json({ error: 'Réponses manquantes' });
  const upsert = db.prepare(`INSERT INTO doodle_votes (doodle_id, date_id, user_id, answer)
    VALUES (?,?,?,?) ON CONFLICT(date_id, user_id) DO UPDATE SET answer=excluded.answer`);
  db.transaction(() => {
    for (const [dateId, answer] of Object.entries(answers)) {
      if (!['yes','no','maybe'].includes(answer)) continue;
      upsert.run(doodle.id, parseInt(dateId), req.session.userId, answer);
    }
  })();
  res.json({ ok: true });
});

// POST /api/doodles/:token/validate — valider une date et créer la séance
router.post('/api/doodles/:token/validate', requireAuth, (req, res) => {
  const doodle = db.prepare('SELECT * FROM doodles WHERE token=?').get(req.params.token);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  const { dateId, sessionName } = req.body;
  if (!dateId) return res.status(400).json({ error: 'Date requise' });
  const dateRow = db.prepare('SELECT * FROM doodle_dates WHERE id=? AND doodle_id=?').get(parseInt(dateId), doodle.id);
  if (!dateRow) return res.status(400).json({ error: 'Date invalide' });
  // Récupérer les ✅ pour cette date
  const yesVotes = db.prepare(`SELECT dv.user_id FROM doodle_votes dv WHERE dv.date_id=? AND dv.answer='yes'`).all(parseInt(dateId));
  // Créer la séance
  const name = (sessionName || doodle.title).trim();
  const r = db.prepare('INSERT INTO sessions (name, date, created_by, is_open) VALUES (?,?,?,1)').run(name, dateRow.date, req.session.userId);
  const sessionId = r.lastInsertRowid;
  // Inscrire le créateur + tous les ✅
  const insertP = db.prepare('INSERT OR IGNORE INTO session_participants (session_id, user_id) VALUES (?,?)');
  db.transaction(() => {
    insertP.run(sessionId, req.session.userId);
    yesVotes.forEach(v => insertP.run(sessionId, v.user_id));
  })();
  // Clôturer le doodle
  db.prepare('UPDATE doodles SET closed=1, session_id=? WHERE id=?').run(sessionId, doodle.id);
  res.json({ ok: true, sessionId });
});

// PATCH /api/doodles/:token/toggle — ouvrir/clôturer
router.patch('/api/doodles/:token/toggle', requireAuth, (req, res) => {
  const doodle = db.prepare('SELECT * FROM doodles WHERE token=?').get(req.params.token);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  const { closed } = req.body;
  db.prepare('UPDATE doodles SET closed=? WHERE id=?').run(closed ? 1 : 0, doodle.id);
  res.json({ ok: true });
});

// DELETE /api/doodles/:token — supprimer un sondage
router.delete('/api/doodles/:token', requireAuth, (req, res) => {
  const doodle = db.prepare('SELECT * FROM doodles WHERE token=?').get(req.params.token);
  if (!doodle) return res.status(404).json({ error: 'Sondage introuvable' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  if (doodle.created_by !== req.session.userId && !user?.is_admin)
    return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('DELETE FROM doodles WHERE id=?').run(doodle.id);
  res.json({ ok: true });
});

// GET /doodle/:token — page publique doodle (SPA)
router.get('/doodle/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /doodle — page liste doodles (SPA)
router.get('/doodle', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


module.exports = router;
