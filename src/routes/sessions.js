// ─────────────────────────────────────────────────────────────
// routes/sessions.js — CRUD séances et participants
//
// Routes :
//   GET    /api/sessions           Liste des séances
//   POST   /api/sessions           Créer une séance
//   GET    /api/sessions/:id       Détail d'une séance
//   PATCH  /api/sessions/:id       Modifier une séance
//   DELETE /api/sessions/:id       Supprimer une séance
//   POST   /api/sessions/:id/join  Rejoindre une séance
//   DELETE /api/sessions/:id/leave Quitter une séance
//   PATCH  /api/sessions/:id/archive  Archiver/désarchiver
//   POST   /api/sessions/:id/simulate-votes  (admin) Votes de test
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

// ── SESSION ROUTES ──────────────────────────────────────────

// GET /api/sessions
router.get('/api/sessions', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;
  const query = `
    SELECT s.*, u.username as created_by_name,
           COUNT(DISTINCT sp.user_id) as participant_count
    FROM sessions s
    LEFT JOIN users u ON u.id = s.created_by
    LEFT JOIN session_participants sp ON sp.session_id = s.id
    GROUP BY s.id
    ORDER BY s.date ASC, s.created_at ASC
  `;
  const all = db.prepare(query).all().filter(s => {
    if (!s.is_private) return true;
    if (isAdmin) return true;
    const member = db.prepare('SELECT 1 FROM session_private_members WHERE session_id = ? AND user_id = ?').get(s.id, userId);
    return !!member;
  });

  // Pour chaque séance active, détecter les nouveaux jeux et le statut des votes
  const sessions = all.filter(s => !s.is_archived).map(s => {
    let newProposals = [];
    let voteStatus = null;
    try {
      const myLastVote = db.prepare(
        'SELECT MAX(submitted_at) as last_vote FROM rankings WHERE session_id = ? AND user_id = ?'
      ).get(s.id, userId);
      if (myLastVote?.last_vote) {
        newProposals = db.prepare(`
          SELECT p.name, u.username as added_by FROM proposals p
          JOIN users u ON u.id = p.proposed_by
          WHERE p.session_id = ? AND p.created_at > ? AND p.proposed_by != ?
        `).all(s.id, myLastVote.last_vote, userId);
      }
      const categories = db.prepare('SELECT id, name FROM categories WHERE session_id = ?').all(s.id);
      const isParticipant = db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND user_id = ?').get(s.id, userId);
      if (isParticipant && categories.length && s.is_open) {
        const myVotedCatIds = new Set(
          db.prepare('SELECT DISTINCT category_id FROM rankings WHERE session_id = ? AND user_id = ?')
            .all(s.id, userId).map(r => r.category_id)
        );
        if (myVotedCatIds.size === 0) {
          voteStatus = { type: 'none' };
        } else {
          const missing = categories.filter(c => !myVotedCatIds.has(c.id));
          if (missing.length) voteStatus = { type: 'incomplete', missing: missing.map(c => c.name) };
        }
      }
    } catch(e) { console.error('vote_status error for session', s.id, e.message); }
    return Object.assign({}, s, { new_proposals: newProposals, vote_status: voteStatus });
  });
  const archived = all.filter(s => s.is_archived);
  res.json({ sessions, archived });
});

// GET/PUT /api/sessions/:id/private-members
router.get('/api/sessions/:id/private-members', requireAuth, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.username FROM session_private_members spm
    JOIN users u ON u.id = spm.user_id
    WHERE spm.session_id = ?
  `).all(parseInt(req.params.id));
  res.json(members);
});

router.put('/api/sessions/:id/private-members', requireAuth, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  const sessionId = parseInt(req.params.id);
  const { user_ids } = req.body;
  db.prepare('DELETE FROM session_private_members WHERE session_id = ?').run(sessionId);
  for (const uid of (user_ids || [])) {
    db.prepare('INSERT OR IGNORE INTO session_private_members (session_id, user_id) VALUES (?,?)').run(sessionId, uid);
  }
  res.json({ ok: true });
});

// PATCH /api/sessions/:id/archive — archiver/désarchiver
router.patch('/api/sessions/:id/archive', requireAuth, (req, res) => {
  const { is_archived } = req.body;
  db.prepare('UPDATE sessions SET is_archived = ? WHERE id = ?').run(is_archived ? 1 : 0, parseInt(req.params.id));
  res.json({ ok: true });
});

// POST /api/sessions — create session
router.post('/api/sessions', requireAuth, requirePerm('session_create'), (req, res) => {
  const { name, date, categories, is_private, member_ids, no_join } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Nom et date requis' });
  if (is_private && !req.session.isAdmin) return res.status(403).json({ error: 'Réservé aux admins' });

  const sess = db.prepare('INSERT INTO sessions (name, date, created_by, is_private) VALUES (?, ?, ?, ?)').run(name, date, req.session.userId, is_private ? 1 : 0);
  const sessionId = sess.lastInsertRowid;

  // Auto-join creator sauf si no_join
  if (!no_join) {
    db.prepare('INSERT OR IGNORE INTO session_participants (session_id, user_id) VALUES (?, ?)').run(sessionId, req.session.userId);
  }

  // Membres de la séance privée (créateur toujours inclus)
  if (is_private) {
    const ids = new Set([req.session.userId, ...(Array.isArray(member_ids) ? member_ids.map(Number) : [])]);
    for (const uid of ids) {
      db.prepare('INSERT OR IGNORE INTO session_private_members (session_id, user_id) VALUES (?,?)').run(sessionId, uid);
    }
  }

  // Create default categories if provided
  const cats = categories || [
    { name: 'Jeu en groupes', icon: '👥', subtitle: '6+ joueurs' },
    { name: 'Jeu 3-4 joueurs', icon: '🃏', subtitle: '3-4 joueurs' }
  ];
  cats.forEach((cat, i) => {
    db.prepare('INSERT INTO categories (session_id, name, icon, subtitle, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, cat.name, cat.icon || '🎲', cat.subtitle || '', i);
  });

  res.json({ ok: true, sessionId });
});

// GET /api/sessions/:id — full session detail
router.get('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const sess = db.prepare('SELECT s.*, u.username as created_by_name FROM sessions s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?').get(sessionId);
  if (!sess) return res.status(404).json({ error: "Seance introuvable" });

  const categories = db.prepare('SELECT * FROM categories WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  const participants = db.prepare(`
    SELECT u.id, u.username, u.bgg_username
    FROM session_participants sp JOIN users u ON u.id = sp.user_id
    WHERE sp.session_id = ?
  `).all(sessionId);
  const proposals = db.prepare('SELECT p.*, u.username as proposed_by_name FROM proposals p JOIN users u ON u.id = p.proposed_by WHERE p.session_id = ? ORDER BY p.created_at').all(sessionId);
  const rankings = db.prepare('SELECT * FROM rankings WHERE session_id = ?').all(sessionId);

  res.json({ session: sess, categories, participants, proposals, rankings });
});

// PATCH /api/sessions/:id — update name/date/open/votes_locked (creator or admin)
router.patch('/api/sessions/:id', requireAuth, requirePerm('session_edit', req => { const s = db.prepare('SELECT created_by FROM sessions WHERE id=?').get(parseInt(req.params.id)); return s?.created_by; }), (req, res) => {
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!sess) return res.status(404).json({ error: "Seance introuvable" });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (sess.created_by !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: "Non autorise" });

  const { name, date, is_open, votes_locked } = req.body;
  db.prepare('UPDATE sessions SET name = COALESCE(?, name), date = COALESCE(?, date), is_open = COALESCE(?, is_open), votes_locked = COALESCE(?, votes_locked) WHERE id = ?')
    .run(name || null, date || null, is_open != null ? (is_open ? 1 : 0) : null, votes_locked != null ? (votes_locked ? 1 : 0) : null, sess.id);
  res.json({ ok: true });
});

// DELETE /api/sessions/:id — delete session and all related data (creator or admin)
router.delete('/api/sessions/:id', requireAuth, requirePerm('session_delete', req => { const s = db.prepare('SELECT created_by FROM sessions WHERE id=?').get(parseInt(req.params.id)); return s?.created_by; }), (req, res) => {
  const sessId = parseInt(req.params.id);
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessId);
  if (!sess) return res.status(404).json({ error: "Seance introuvable" });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (sess.created_by !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: "Non autorise" });

  // Cascade delete
  db.prepare('DELETE FROM rankings WHERE session_id = ?').run(sessId);
  db.prepare('DELETE FROM proposals WHERE session_id = ?').run(sessId);
  db.prepare('DELETE FROM categories WHERE session_id = ?').run(sessId);
  db.prepare('DELETE FROM session_participants WHERE session_id = ?').run(sessId);
  db.prepare('DELETE FROM programme_slots WHERE session_id = ?').run(sessId);
  db.prepare('DELETE FROM archive_media WHERE session_id = ?').run(sessId);
  // Détacher les doodles liés sans les supprimer
  db.prepare('UPDATE doodles SET session_id=NULL WHERE session_id=?').run(sessId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessId);

  res.json({ ok: true });
});

// POST /api/sessions/:id/join
router.post('/api/sessions/:id/join', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  db.prepare('INSERT OR IGNORE INTO session_participants (session_id, user_id) VALUES (?, ?)').run(sessionId, req.session.userId);
  res.json({ ok: true });
});

// DELETE /api/sessions/:id/leave
router.delete('/api/sessions/:id/leave', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const userId = req.session.userId;
  // Supprimer les propositions du joueur dans cette séance
  db.prepare('DELETE FROM proposals WHERE session_id = ? AND proposed_by = ?').run(sessionId, userId);
  // Supprimer ses votes
  db.prepare('DELETE FROM rankings WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  // Supprimer sa participation
  db.prepare('DELETE FROM session_participants WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  res.json({ ok: true });
});

// ── TEST ACCOUNTS ─────────────────────────────────────────

const TEST_USERS = ['Claudia', 'Claudine', 'Claudette', 'Claude François'];

// POST /api/sessions/:id/simulate-votes — créer comptes test et voter aléatoirement
router.post('/api/sessions/:id/simulate-votes', requireAdmin, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });

  const proposals = db.prepare('SELECT * FROM proposals WHERE session_id = ?').all(sessionId);
  const categories = db.prepare('SELECT * FROM categories WHERE session_id = ?').all(sessionId);
  if (!proposals.length) return res.status(400).json({ error: 'Aucun jeu proposé dans cette séance' });

  const passwordHash = bcrypt.hashSync('testpass123', 10);
  const insertUser = db.prepare("INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)");
  const insertParticipant = db.prepare("INSERT OR IGNORE INTO session_participants (session_id, user_id) VALUES (?, ?)");
  const deleteRankings = db.prepare("DELETE FROM rankings WHERE session_id = ? AND user_id = ?");
  const insertRanking = db.prepare("INSERT INTO rankings (session_id, category_id, user_id, proposal_id, rank) VALUES (?, ?, ?, ?, ?)");

  const results = [];

  db.transaction(() => {
    for (const name of TEST_USERS) {
      // Créer le compte s'il n'existe pas
      insertUser.run(name, passwordHash);
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
      // Inscrire à la séance
      insertParticipant.run(sessionId, user.id);
      // Voter aléatoirement dans chaque catégorie
      for (const cat of categories) {
        const catProposals = proposals.filter(p => p.category_id === cat.id);
        if (!catProposals.length) continue;
        // Mélanger aléatoirement
        const shuffled = [...catProposals].sort(() => Math.random() - 0.5);
        deleteRankings.run(sessionId, user.id);
        shuffled.forEach((p, i) => {
          insertRanking.run(sessionId, cat.id, user.id, p.id, i + 1);
        });
      }
      results.push(name);
    }
  })();

  res.json({ ok: true, created: results });
});

// DELETE /api/sessions/:id/simulate-votes — supprimer comptes test
router.delete('/api/sessions/:id/simulate-votes', requireAdmin, (req, res) => {
  const sessionId = parseInt(req.params.id);
  db.transaction(() => {
    for (const name of TEST_USERS) {
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
      if (!user) continue;
      db.prepare("DELETE FROM rankings WHERE session_id = ? AND user_id = ?").run(sessionId, user.id);
      db.prepare("DELETE FROM session_participants WHERE session_id = ? AND user_id = ?").run(sessionId, user.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    }
  })();
  res.json({ ok: true });
});


module.exports = router;
