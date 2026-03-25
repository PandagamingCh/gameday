// ─────────────────────────────────────────────────────────────
// routes/bgg.js — Intégration BoardGameGeek
//
// Routes :
//   POST /api/bgg/sync                    Synchronise la collection BGG de l'utilisateur
//   GET  /api/bgg/search                  Recherche un jeu sur BGG par nom
//   GET  /api/bgg/description/:id         Récupère la description d'un jeu BGG
//   GET  /api/bgg/thing/:id               Récupère les détails d'un jeu BGG
//   GET  /api/bgg/collection/:userId      Retourne la collection BGG en cache
//   POST /api/sessions/:id/bgg/enrich     (admin) Enrichit les propositions avec les données BGG
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const fetch = require('node-fetch');
const { fetchBGGThing, fetchBGGDescription, searchBGG } = require('../bgg');
const { syncUserCollection, getUserCollection } = require('../bgg');

// ── BGG ROUTES ──────────────────────────────────────────────

// POST /api/bgg/sync — manual sync
router.post('/api/bgg/sync', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT bgg_username FROM users WHERE id = ?').get(req.session.userId);
  if (!user?.bgg_username) return res.status(400).json({ error: 'Aucun pseudo BGG configuré' });
  try {
    const result = await syncUserCollection(req.session.userId, user.bgg_username);
    res.json({ ok: true, count: result.count });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/sessions/:id/bgg/enrich — enrichit les proposals d'une séance (admin uniquement)
router.post('/api/sessions/:id/bgg/enrich', requireAdmin, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { fetchBGGThing } = require('./src/bgg');
  const props = db.prepare("SELECT DISTINCT bgg_id FROM proposals WHERE session_id=? AND bgg_id != '' AND bgg_id IS NOT NULL").all(sessionId);
  if (!props.length) return res.json({ ok: true, count: 0 });
  const updProp = db.prepare('UPDATE proposals SET bgg_rating=COALESCE(?,bgg_rating), bgg_weight=COALESCE(?,bgg_weight) WHERE session_id=? AND bgg_id=?');
  let updated = 0;
  for (const p of props) {
    try {
      const data = await fetchBGGThing(p.bgg_id);
      if (data.bgg_rating || data.bgg_weight) {
        updProp.run(data.bgg_rating || null, data.bgg_weight || null, sessionId, p.bgg_id);
        updated++;
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) { /* skip */ }
  }
  res.json({ ok: true, count: updated, total: props.length });
});

// POST /api/sessions/:id/enrich — enrichit les proposals d'une séance avec note + weight BGG
router.post('/api/sessions/:id/enrich', requireAdmin, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { fetchBGGThing } = require('./src/bgg');

  const proposals = db.prepare("SELECT DISTINCT bgg_id FROM proposals WHERE session_id = ? AND bgg_id != '' AND bgg_id IS NOT NULL").all(sessionId);
  if (!proposals.length) return res.json({ ok: true, count: 0 });

  const upd = db.prepare('UPDATE proposals SET bgg_rating=COALESCE(?,bgg_rating), bgg_weight=COALESCE(?,bgg_weight) WHERE session_id=? AND bgg_id=?');
  let updated = 0;

  for (const p of proposals) {
    try {
      const data = await fetchBGGThing(p.bgg_id);
      if (data.bgg_rating || data.bgg_weight) {
        upd.run(data.bgg_rating || null, data.bgg_weight || null, sessionId, p.bgg_id);
        updated++;
      }
      await new Promise(r => setTimeout(r, 500));
    } catch(e) { /* skip */ }
  }
  res.json({ ok: true, count: updated });
});

// GET /api/bgg/search?q= — search BGG database (server-side, uses bearer token)
router.get('/api/bgg/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: "Requete vide" });

  const { searchBGG } = require('./src/bgg');
  try {
    const games = await searchBGG(q);
    res.json({ games });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/bgg/description/:id — fetch + translate BGG description
router.get('/api/bgg/description/:id', requireAuth, async (req, res) => {
  const bggId = req.params.id;
  try {
    const { fetchBGGDescription } = require('./src/bgg');
    const desc = await fetchBGGDescription(bggId);
    if (!desc) return res.json({ description: '' });

    // Traduire avec Claude si ANTHROPIC_API_KEY disponible
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ description: desc });

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Traduis ce texte de description de jeu de société en français. Garde un style naturel et concis, maximum 3-4 phrases. Réponds uniquement avec la traduction, sans guillemets ni introduction :

${desc.substring(0, 1500)}`
      }]
    });
    const translated = msg.content[0]?.text || desc;
    res.json({ description: translated });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bgg/thing/:id — fetch details for a single BGG game by ID
router.get('/api/bgg/thing/:id', requireAuth, async (req, res) => {
  const bggId = req.params.id.replace(/[^0-9]/g, '');
  if (!bggId) return res.status(400).json({ error: "ID BGG invalide" });

  const { fetchBGGThing } = require('./src/bgg');
  try {
    const game = await fetchBGGThing(bggId);
    res.json({ game });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/bgg/collection/:userId — get cached collection for any user
router.get('/api/bgg/collection/:userId', requireAuth, (req, res) => {
  const games = getUserCollection(parseInt(req.params.userId));
  res.json({ games });
});


module.exports = router;
