'use strict';
// Script de copie de séance pour test
// Usage : node copy_session.js <source_session_id> [nom_nouvelle_seance]
// Copie : session, catégories, participants, proposals, rankings

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'gameday.db');
const SOURCE_ID = parseInt(process.argv[2] || '2');
const NEW_NAME = process.argv[3] || `Copie test — séance ${SOURCE_ID}`;

const db = new Database(DB_PATH);

db.transaction(() => {
  // 1. Copier la session
  const src = db.prepare('SELECT * FROM sessions WHERE id = ?').get(SOURCE_ID);
  if (!src) throw new Error(`Session ${SOURCE_ID} introuvable`);

  const newSession = db.prepare(`
    INSERT INTO sessions (name, date, created_by, is_open, is_archived, is_private, programme_validated, votes_locked, include_in_stats)
    VALUES (?, ?, ?, 1, 0, ?, 0, 0, 0)
  `).run(NEW_NAME, src.date, src.created_by, src.is_private);
  const newId = newSession.lastInsertRowid;
  console.log(`✅ Session créée : id=${newId} — "${NEW_NAME}"`);

  // 2. Copier les catégories (en gardant un mapping old_id → new_id)
  const cats = db.prepare('SELECT * FROM categories WHERE session_id = ? ORDER BY sort_order').all(SOURCE_ID);
  const catMap = {};
  for (const cat of cats) {
    const r = db.prepare(`
      INSERT INTO categories (session_id, name, icon, subtitle, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId, cat.name, cat.icon, cat.subtitle, cat.sort_order);
    catMap[cat.id] = r.lastInsertRowid;
  }
  console.log(`✅ ${cats.length} catégorie(s) copiée(s)`);

  // 3. Copier les participants
  const parts = db.prepare('SELECT * FROM session_participants WHERE session_id = ?').all(SOURCE_ID);
  for (const p of parts) {
    db.prepare('INSERT OR IGNORE INTO session_participants (session_id, user_id, joined_at) VALUES (?, ?, ?)').run(newId, p.user_id, p.joined_at);
  }
  console.log(`✅ ${parts.length} participant(s) copié(s)`);

  // 4. Copier les proposals (mapping old_id → new_id)
  const props = db.prepare('SELECT * FROM proposals WHERE session_id = ?').all(SOURCE_ID);
  const propMap = {};
  for (const p of props) {
    const r = db.prepare(`
      INSERT INTO proposals (session_id, category_id, proposed_by, bgg_id, name, year, thumbnail,
        min_players, max_players, min_time, max_time, created_at, myludo_url, teacher, teach_duration, bgg_rating, bgg_weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId, catMap[p.category_id] || p.category_id, p.proposed_by, p.bgg_id, p.name, p.year,
      p.thumbnail, p.min_players, p.max_players, p.min_time, p.max_time, p.created_at,
      p.myludo_url, p.teacher, p.teach_duration, p.bgg_rating, p.bgg_weight);
    propMap[p.id] = r.lastInsertRowid;
  }
  console.log(`✅ ${props.length} jeu(x) copié(s)`);

  // 5. Copier les rankings
  const ranks = db.prepare('SELECT * FROM rankings WHERE session_id = ?').all(SOURCE_ID);
  for (const r of ranks) {
    const newCatId = catMap[r.category_id] || r.category_id;
    const newPropId = propMap[r.proposal_id];
    if (!newPropId) continue;
    db.prepare(`
      INSERT INTO rankings (session_id, category_id, user_id, proposal_id, rank, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, newCatId, r.user_id, newPropId, r.rank, r.submitted_at);
  }
  console.log(`✅ ${ranks.length} vote(s) copié(s)`);

  console.log(`\n🎲 Séance de test prête ! ID = ${newId}`);
  console.log(`   → Ouvre GameDay et cherche "${NEW_NAME}"`);
})();

db.close();
