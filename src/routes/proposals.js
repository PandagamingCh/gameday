// ─────────────────────────────────────────────────────────────
// routes/proposals.js — Propositions de jeux
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');

router.post('/api/sessions/:id/proposals', requireAuth, requirePerm('proposal_add'), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { categoryId, bggId, name, year, thumbnail, minPlayers, maxPlayers, minTime, maxTime, myludoUrl, bggRating, bggWeight, tutoUrl } = req.body;
    if (!name || !categoryId) return res.status(400).json({ error: 'Champs manquants' });

    if (bggId) {
      const dup = await db.get('SELECT id FROM proposals WHERE session_id = $1 AND category_id = $2 AND bgg_id = $3', [sessionId, categoryId, bggId]);
      if (dup) return res.status(400).json({ error: 'Ce jeu est déjà proposé dans cette catégorie' });
    }

    const proposer = await db.get('SELECT username FROM users WHERE id = $1', [req.session.userId]);
    const defaultTeacher = proposer?.username || '';

    // Pré-remplir tuto_url depuis bgg_games si non fourni
    let finalTutoUrl = tutoUrl || '';
    if (!finalTutoUrl && bggId) {
      try {
        const bg = await db.get("SELECT tuto_url FROM bgg_games WHERE bgg_id=$1 AND tuto_url!='' LIMIT 1", [bggId]);
        if (bg?.tuto_url) finalTutoUrl = bg.tuto_url;
      } catch(e) {}
    }

    const p = await db.run(`
      INSERT INTO proposals (session_id, category_id, proposed_by, bgg_id, name, year, thumbnail, min_players, max_players, min_time, max_time, myludo_url, teacher, bgg_rating, bgg_weight, tuto_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
    `, [sessionId, categoryId, req.session.userId, bggId || '', name, year || '', thumbnail || '', minPlayers || '', maxPlayers || '', minTime || '', maxTime || '', myludoUrl || '', defaultTeacher, bggRating || null, bggWeight || null, finalTutoUrl]);

    res.json({ ok: true, proposalId: p.lastInsertRowid });
  } catch(e) {
    console.error('POST proposals error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/api/proposals/:id', requireAuth, requirePerm('proposal_edit', async req => {
  const p = await db.get('SELECT proposed_by FROM proposals WHERE id=$1', [parseInt(req.params.id)]);
  return p?.proposed_by;
}), async (req, res) => {
  try {
    const p = await db.get('SELECT * FROM proposals WHERE id = $1', [parseInt(req.params.id)]);
    if (!p) return res.status(404).json({ error: 'Proposition introuvable' });
    const { name, year, minPlayers, maxPlayers, minTime, maxTime, bggId, myludoUrl, teacher, teachDuration, bggRating, bggWeight, thumbnail, tutoUrl } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom obligatoire' });

    await db.run(`
      UPDATE proposals SET name=$1, year=$2, min_players=$3, max_players=$4, min_time=$5, max_time=$6,
      bgg_id=COALESCE(NULLIF($7,''), bgg_id),
      thumbnail=COALESCE(NULLIF($8,''), thumbnail),
      myludo_url=$9, teacher=$10, teach_duration=$11,
      bgg_rating=COALESCE($12, bgg_rating),
      bgg_weight=COALESCE($13, bgg_weight),
      tuto_url=$14
      WHERE id=$15
    `, [name, year||'', minPlayers||'', maxPlayers||'', minTime||'', maxTime||'', bggId||'', thumbnail||'', myludoUrl||'', teacher||'', teachDuration??null, bggRating||null, bggWeight||null, tutoUrl||'', p.id]);

    // Mémoriser le tuto_url dans bgg_games pour pré-remplissage futur
    const bggIdFinal = bggId || p.bgg_id;
    if (tutoUrl && bggIdFinal) {
      try {
        await db.run("UPDATE bgg_games SET tuto_url=$1 WHERE bgg_id=$2", [tutoUrl, bggIdFinal]);
      } catch(e) {}
    }

    res.json({ ok: true });
  } catch(e) {
    console.error('PATCH proposals error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/api/proposals/:id', requireAuth, requirePerm('proposal_delete', async req => {
  const p = await db.get('SELECT proposed_by FROM proposals WHERE id=$1', [parseInt(req.params.id)]);
  return p?.proposed_by;
}), async (req, res) => {
  try {
    const p = await db.get('SELECT * FROM proposals WHERE id = $1', [parseInt(req.params.id)]);
    if (!p) return res.status(404).json({ error: 'Proposition introuvable' });
    await db.run('DELETE FROM proposals WHERE id = $1', [p.id]);
    res.json({ ok: true });
  } catch(e) {
    console.error('DELETE proposals error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;