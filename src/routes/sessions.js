// ─────────────────────────────────────────────────────────────
// routes/sessions.js — CRUD séances et participants (PostgreSQL)
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt  = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

// ── SESSION ROUTES ──────────────────────────────────────────

// GET /api/sessions
router.get('/api/sessions', requireAuth, async (req, res) => {
  const userId  = req.session.userId;
  const isAdmin = req.session.isAdmin;
  try {
    const all = await db.all(`
      SELECT s.*, u.username as created_by_name,
             COUNT(DISTINCT sp.user_id) as participant_count
      FROM sessions s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN session_participants sp ON sp.session_id = s.id
      GROUP BY s.id, u.username
      ORDER BY s.date ASC, s.created_at ASC
    `);

    // Filtrer les séances privées
    const visible = [];
    for (const s of all) {
      if (!s.is_private || isAdmin) { visible.push(s); continue; }
      const member = await db.get('SELECT 1 FROM session_private_members WHERE session_id = $1 AND user_id = $2', [s.id, userId]);
      if (member) visible.push(s);
    }

    // Enrichir chaque séance active avec vote_status et new_proposals
    const sessions = [];
    for (const s of visible.filter(s => !s.is_archived)) {
      let newProposals = [], voteStatus = null;
      try {
        const myLastVote = await db.get(
          'SELECT MAX(submitted_at) as last_vote FROM rankings WHERE session_id = $1 AND user_id = $2',
          [s.id, userId]
        );
        if (myLastVote?.last_vote) {
          newProposals = await db.all(`
            SELECT p.name, u.username as added_by FROM proposals p
            JOIN users u ON u.id = p.proposed_by
            WHERE p.session_id = $1 AND p.created_at > $2 AND p.proposed_by != $3
          `, [s.id, myLastVote.last_vote, userId]);
        }
        const categories = await db.all('SELECT id, name FROM categories WHERE session_id = $1', [s.id]);
        const isParticipant = await db.get('SELECT 1 FROM session_participants WHERE session_id = $1 AND user_id = $2', [s.id, userId]);
        if (isParticipant && categories.length && s.is_open) {
          const voted = await db.all('SELECT DISTINCT category_id FROM rankings WHERE session_id = $1 AND user_id = $2', [s.id, userId]);
          const votedIds = new Set(voted.map(r => r.category_id));
          if (votedIds.size === 0) {
            voteStatus = { type: 'none' };
          } else {
            const missing = categories.filter(c => !votedIds.has(c.id));
            if (missing.length) voteStatus = { type: 'incomplete', missing: missing.map(c => c.name) };
          }
        }
      } catch(e) { console.error('vote_status error for session', s.id, e.message); }
      sessions.push({ ...s, new_proposals: newProposals, vote_status: voteStatus });
    }

    const archived = visible.filter(s => s.is_archived);
    res.json({ sessions, archived });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/:id/private-members
router.get('/api/sessions/:id/private-members', requireAuth, async (req, res) => {
  const members = await db.all(`
    SELECT u.id, u.username FROM session_private_members spm
    JOIN users u ON u.id = spm.user_id
    WHERE spm.session_id = $1
  `, [parseInt(req.params.id)]);
  res.json(members);
});

// PUT /api/sessions/:id/private-members
router.put('/api/sessions/:id/private-members', requireAuth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  const sessionId = parseInt(req.params.id);
  const { user_ids } = req.body;
  await db.run('DELETE FROM session_private_members WHERE session_id = $1', [sessionId]);
  for (const uid of (user_ids || [])) {
    await db.run('INSERT INTO session_private_members (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sessionId, uid]);
  }
  res.json({ ok: true });
});

// PATCH /api/sessions/:id/archive
router.patch('/api/sessions/:id/archive', requireAuth, async (req, res) => {
  const { is_archived } = req.body;
  await db.run('UPDATE sessions SET is_archived = $1 WHERE id = $2', [is_archived ? 1 : 0, parseInt(req.params.id)]);
  res.json({ ok: true });
});

// POST /api/sessions
router.post('/api/sessions', requireAuth, requirePerm('session_create'), async (req, res) => {
  const { name, date, categories, is_private, member_ids, no_join, is_convention } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Nom et date requis' });
  if (is_private && !req.session.isAdmin) return res.status(403).json({ error: 'Réservé aux admins' });

  const sess = await db.run(
    'INSERT INTO sessions (name, date, created_by, is_private, is_convention) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, date, req.session.userId, is_private ? 1 : 0, is_convention ? 1 : 0]
  );
  const sessionId = sess.lastInsertRowid;

  if (!no_join) {
    await db.run('INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sessionId, req.session.userId]);
  }
  if (is_private) {
    const ids = new Set([req.session.userId, ...(Array.isArray(member_ids) ? member_ids.map(Number) : [])]);
    for (const uid of ids) {
      await db.run('INSERT INTO session_private_members (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sessionId, uid]);
    }
  }

  const cats = categories || [
    { name: 'Jeu en groupes', icon: '👥', subtitle: '6+ joueurs' },
    { name: 'Jeu 3-4 joueurs', icon: '🃏', subtitle: '3-4 joueurs' }
  ];
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i];
    await db.run('INSERT INTO categories (session_id, name, icon, subtitle, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, cat.name, cat.icon || '🎲', cat.subtitle || '', i]);
  }

  res.json({ ok: true, sessionId });
});

// GET /api/sessions/:id
router.get('/api/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const sess = await db.get('SELECT s.*, u.username as created_by_name FROM sessions s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1', [sessionId]);
  if (!sess) return res.status(404).json({ error: 'Seance introuvable' });

  const [categories, participants, proposals, rankings, notes] = await Promise.all([
    db.all('SELECT * FROM categories WHERE session_id = $1 ORDER BY sort_order', [sessionId]),
    db.all('SELECT u.id, u.username, u.bgg_username FROM session_participants sp JOIN users u ON u.id = sp.user_id WHERE sp.session_id = $1', [sessionId]),
    db.all('SELECT p.*, u.username as proposed_by_name FROM proposals p JOIN users u ON u.id = p.proposed_by WHERE p.session_id = $1 ORDER BY p.created_at', [sessionId]),
    db.all('SELECT * FROM rankings WHERE session_id = $1', [sessionId]),
    db.all('SELECT n.*, u.username FROM session_notes n JOIN users u ON u.id = n.user_id WHERE n.session_id = $1 ORDER BY n.created_at ASC', [sessionId])
  ]);

  res.json({ session: sess, categories, participants, proposals, rankings, notes });
});

// PATCH /api/sessions/:id
router.patch('/api/sessions/:id', requireAuth, requirePerm('session_edit', async req => {
  const s = await db.get('SELECT created_by FROM sessions WHERE id = $1', [parseInt(req.params.id)]);
  return s?.created_by;
}), async (req, res) => {
  const sess = await db.get('SELECT * FROM sessions WHERE id = $1', [parseInt(req.params.id)]);
  if (!sess) return res.status(404).json({ error: 'Seance introuvable' });
  const { name, date, is_open, votes_locked, location, show_location_public } = req.body;
  await db.run(`UPDATE sessions SET
    name = COALESCE($1, name), date = COALESCE($2, date),
    is_open = COALESCE($3, is_open), votes_locked = COALESCE($4, votes_locked),
    location = COALESCE($5, location), show_location_public = COALESCE($6, show_location_public)
    WHERE id = $7`,
    [name || null, date || null,
     is_open != null ? (is_open ? 1 : 0) : null,
     votes_locked != null ? (votes_locked ? 1 : 0) : null,
     location !== undefined ? location : null,
     show_location_public !== undefined ? (show_location_public ? 1 : 0) : null,
     sess.id]);
  req.app.locals.broadcast?.(sess.id, 'session.updated', { name, is_open, votes_locked });
  res.json({ ok: true });
});

// DELETE /api/sessions/:id
router.delete('/api/sessions/:id', requireAuth, requirePerm('session_delete', async req => {
  const s = await db.get('SELECT created_by FROM sessions WHERE id = $1', [parseInt(req.params.id)]);
  return s?.created_by;
}), async (req, res) => {
  const sessId = parseInt(req.params.id);
  const sess = await db.get('SELECT * FROM sessions WHERE id = $1', [sessId]);
  if (!sess) return res.status(404).json({ error: 'Seance introuvable' });
  const user = await db.get('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
  if (sess.created_by !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: 'Non autorise' });
  // ON DELETE CASCADE gère la plupart — on détache juste les doodles
  await db.run('UPDATE doodles SET session_id = NULL WHERE session_id = $1', [sessId]);
  await db.run('DELETE FROM sessions WHERE id = $1', [sessId]);
  res.json({ ok: true });
});

// POST /api/sessions/:id/join
router.post('/api/sessions/:id/join', requireAuth, async (req, res) => {
  await db.run('INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [parseInt(req.params.id), req.session.userId]);
  res.json({ ok: true });
});

// DELETE /api/sessions/:id/leave
router.delete('/api/sessions/:id/leave', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const userId = req.session.userId;
  await db.run('DELETE FROM proposals WHERE session_id = $1 AND proposed_by = $2', [sessionId, userId]);
  await db.run('DELETE FROM rankings WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  await db.run('DELETE FROM session_participants WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  req.app.locals.broadcast?.(sessionId, 'participant.left', { userId });
  res.json({ ok: true });
});

// ── TEST ACCOUNTS ─────────────────────────────────────────

const TEST_USERS = ['Claudia', 'Claudine', 'Claudette', 'Claude François'];

router.post('/api/sessions/:id/simulate-votes', requireAdmin, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const session = await db.get('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });

  const proposals  = await db.all('SELECT * FROM proposals WHERE session_id = $1', [sessionId]);
  const categories = await db.all('SELECT * FROM categories WHERE session_id = $1', [sessionId]);
  if (!proposals.length) return res.status(400).json({ error: 'Aucun jeu proposé' });

  const passwordHash = bcrypt.hashSync('testpass123', 10);
  const results = [];

  await db.transaction(async (client) => {
    for (const name of TEST_USERS) {
      await client.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING', [name, passwordHash]);
      const userRes = await client.query('SELECT id FROM users WHERE username = $1', [name]);
      const user = userRes.rows[0];
      await client.query('INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sessionId, user.id]);
      for (const cat of categories) {
        const catProposals = proposals.filter(p => p.category_id === cat.id);
        if (!catProposals.length) continue;
        const shuffled = [...catProposals].sort(() => Math.random() - 0.5);
        await client.query('DELETE FROM rankings WHERE session_id = $1 AND user_id = $2', [sessionId, user.id]);
        for (let i = 0; i < shuffled.length; i++) {
          await client.query('INSERT INTO rankings (session_id, category_id, user_id, proposal_id, rank) VALUES ($1,$2,$3,$4,$5)',
            [sessionId, cat.id, user.id, shuffled[i].id, i + 1]);
        }
      }
      results.push(name);
    }
  });
  res.json({ ok: true, created: results });
});

router.delete('/api/sessions/:id/simulate-votes', requireAdmin, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  await db.transaction(async (client) => {
    for (const name of TEST_USERS) {
      const userRes = await client.query('SELECT id FROM users WHERE username = $1', [name]);
      const user = userRes.rows[0];
      if (!user) continue;
      await client.query('DELETE FROM rankings WHERE session_id = $1 AND user_id = $2', [sessionId, user.id]);
      await client.query('DELETE FROM session_participants WHERE session_id = $1 AND user_id = $2', [sessionId, user.id]);
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    }
  });
  res.json({ ok: true });
});

// ── NOTES ─────────────────────────────────────────────────

router.get('/api/sessions/:id/notes', requireAuth, async (req, res) => {
  const notes = await db.all(`
    SELECT n.*, u.username FROM session_notes n
    JOIN users u ON u.id = n.user_id
    WHERE n.session_id = $1 ORDER BY n.created_at ASC
  `, [parseInt(req.params.id)]);
  res.json({ notes });
});

router.post('/api/sessions/:id/notes', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' });
  const r = await db.run('INSERT INTO session_notes (session_id, user_id, content) VALUES ($1, $2, $3) RETURNING id',
    [parseInt(req.params.id), req.session.userId, content.trim()]);
  req.app.locals.broadcast?.(parseInt(req.params.id), 'notes.updated', {});
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.delete('/api/sessions/:id/notes/:noteId', requireAuth, async (req, res) => {
  const note = await db.get('SELECT * FROM session_notes WHERE id = $1', [parseInt(req.params.noteId)]);
  if (!note) return res.status(404).json({ error: 'Note introuvable' });
  const user = await db.get('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
  if (note.user_id !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: 'Non autorisé' });
  await db.run('DELETE FROM session_notes WHERE id = $1', [note.id]);
  req.app.locals.broadcast?.(parseInt(req.params.id), 'notes.updated', {});
  res.json({ ok: true });
});

module.exports = router;
