'use strict';

// ─────────────────────────────────────────────────────────────
// src/database.js — Connexion PostgreSQL et initialisation du schéma
//
// Structure :
//   1. Connexion via pool pg
//   2. Helpers query/get/all/run
//   3. Schéma initial (CREATE TABLE IF NOT EXISTS)
//   4. Migrations (ALTER TABLE idempotentes)
//   5. Migration données slot_tables
//   6. Données par défaut (permissions)
//   7. Export
// ─────────────────────────────────────────────────────────────

const { Pool } = require('pg');

// ── 1. CONNEXION ─────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

console.log(`🗄  Base de données : PostgreSQL`);

// ── 2. HELPERS ───────────────────────────────────────────────
// Ces helpers imitent l'API synchrone de better-sqlite3
// pour faciliter la migration progressive des routes.

const db = {
  // Exécuter une requête (INSERT/UPDATE/DELETE)
  async run(sql, params = []) {
    const pgSql = toPostgres(sql);
    const result = await pool.query(pgSql, params);
    return {
      lastInsertRowid: result.rows[0]?.id || null,
      changes: result.rowCount
    };
  },

  // Récupérer une seule ligne
  async get(sql, params = []) {
    const pgSql = toPostgres(sql);
    const result = await pool.query(pgSql, params);
    return result.rows[0] || null;
  },

  // Récupérer plusieurs lignes
  async all(sql, params = []) {
    const pgSql = toPostgres(sql);
    const result = await pool.query(pgSql, params);
    return result.rows;
  },

  // Exécuter du SQL brut (schéma, migrations)
  async exec(sql) {
    await pool.query(sql);
  },

  // Transaction
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // Accès direct au pool pour les cas complexes
  pool
};

// Convertit les ? en $1, $2, $3... pour PostgreSQL
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── 3. SCHÉMA INITIAL ────────────────────────────────────────

async function initSchema() {
  await pool.query(`

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT    UNIQUE NOT NULL,
      password_hash TEXT    NOT NULL,
      bgg_username  TEXT    DEFAULT '',
      is_admin      INTEGER DEFAULT 0,
      email         TEXT    DEFAULT NULL,
      created_at    TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      bgg_synced_at TEXT    DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id         SERIAL PRIMARY KEY,
      token      TEXT    UNIQUE NOT NULL,
      created_by INTEGER REFERENCES users(id),
      used_by    INTEGER REFERENCES users(id) DEFAULT NULL,
      created_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      used_at    TEXT    DEFAULT NULL,
      is_active  INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT    NOT NULL,
      date                 TEXT    NOT NULL,
      created_by           INTEGER NOT NULL REFERENCES users(id),
      is_open              INTEGER DEFAULT 1,
      is_private           INTEGER DEFAULT 0,
      is_archived          INTEGER DEFAULT 0,
      is_convention        INTEGER DEFAULT 0,
      votes_locked         INTEGER DEFAULT 0,
      programme_validated  INTEGER DEFAULT 0,
      location             TEXT    DEFAULT '',
      show_location_public INTEGER DEFAULT 1,
      created_at           TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS session_private_members (
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      PRIMARY KEY (session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      joined_at  TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      PRIMARY KEY (session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS session_notes (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      icon       TEXT    DEFAULT '🎲',
      subtitle   TEXT    DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id             SERIAL PRIMARY KEY,
      session_id     INTEGER NOT NULL REFERENCES sessions(id)   ON DELETE CASCADE,
      category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      proposed_by    INTEGER NOT NULL REFERENCES users(id),
      bgg_id         TEXT    DEFAULT '',
      name           TEXT    NOT NULL,
      year           TEXT    DEFAULT '',
      thumbnail      TEXT    DEFAULT '',
      min_players    TEXT    DEFAULT '',
      max_players    TEXT    DEFAULT '',
      min_time       TEXT    DEFAULT '',
      max_time       TEXT    DEFAULT '',
      myludo_url     TEXT    DEFAULT '',
      teacher        TEXT    DEFAULT '',
      teach_duration INTEGER DEFAULT NULL,
      bgg_rating     TEXT    DEFAULT NULL,
      bgg_weight     TEXT    DEFAULT NULL,
      tuto_url       TEXT    DEFAULT '',
      nb_copies      INTEGER DEFAULT 1,
      multi_slot     INTEGER DEFAULT 0,
      created_at     TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS rankings (
      id           SERIAL PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES sessions(id)   ON DELETE CASCADE,
      category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
      proposal_id  INTEGER NOT NULL REFERENCES proposals(id)  ON DELETE CASCADE,
      rank         INTEGER NOT NULL,
      submitted_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(session_id, category_id, user_id, proposal_id)
    );

    CREATE TABLE IF NOT EXISTS bgg_games (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bgg_id      TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      year        TEXT    DEFAULT '',
      thumbnail   TEXT    DEFAULT '',
      min_players TEXT    DEFAULT '',
      max_players TEXT    DEFAULT '',
      min_time    TEXT    DEFAULT '',
      max_time    TEXT    DEFAULT '',
      bgg_rating  TEXT    DEFAULT NULL,
      bgg_weight  TEXT    DEFAULT NULL,
      tuto_url    TEXT    DEFAULT '',
      UNIQUE(user_id, bgg_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      action TEXT    PRIMARY KEY,
      level  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reset_tokens (
      id         SERIAL PRIMARY KEY,
      token      TEXT    UNIQUE NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      expires_at TEXT    DEFAULT NULL,
      used       INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS doodles (
      id         SERIAL PRIMARY KEY,
      token      TEXT    UNIQUE NOT NULL,
      title      TEXT    NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      closed     INTEGER DEFAULT 0,
      session_id INTEGER DEFAULT NULL REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS doodle_dates (
      id         SERIAL PRIMARY KEY,
      doodle_id  INTEGER NOT NULL REFERENCES doodles(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS doodle_votes (
      id        SERIAL PRIMARY KEY,
      doodle_id INTEGER NOT NULL REFERENCES doodles(id)      ON DELETE CASCADE,
      date_id   INTEGER NOT NULL REFERENCES doodle_dates(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
      answer    TEXT    NOT NULL CHECK(answer IN ('yes','no','maybe')),
      UNIQUE(date_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS programme_slots (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      start_time TEXT    DEFAULT '',
      note       TEXT    DEFAULT '',
      is_break   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS slot_tables (
      id           SERIAL PRIMARY KEY,
      slot_id      INTEGER NOT NULL REFERENCES programme_slots(id) ON DELETE CASCADE,
      table_number INTEGER NOT NULL,
      game_name    TEXT    DEFAULT '',
      players      TEXT    DEFAULT '',
      teacher      TEXT    DEFAULT '',
      duration_est INTEGER DEFAULT NULL,
      thumbnail    TEXT    DEFAULT '',
      min_players  INTEGER DEFAULT NULL,
      max_players  INTEGER DEFAULT NULL,
      UNIQUE(slot_id, table_number)
    );

    CREATE TABLE IF NOT EXISTS convention_bookings (
      id         SERIAL PRIMARY KEY,
      slot_id    INTEGER NOT NULL REFERENCES programme_slots(id) ON DELETE CASCADE,
      table_id   INTEGER NOT NULL REFERENCES slot_tables(id)     ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
      created_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(slot_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS archive_games (
      id           SERIAL PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      game_name    TEXT    NOT NULL,
      bgg_id       TEXT    DEFAULT '',
      thumbnail    TEXT    DEFAULT '',
      vainqueur    TEXT    DEFAULT '',
      scores       TEXT    DEFAULT '',
      joueurs      TEXT    DEFAULT '',
      compte_rendu TEXT    DEFAULT '',
      sort_order   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS archive_media (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      game_id    INTEGER DEFAULT NULL,
      type       TEXT    DEFAULT 'photo',
      url        TEXT    NOT NULL,
      caption    TEXT    DEFAULT '',
      thumbnail  TEXT    DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_public  INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS archive_user_cr (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      content    TEXT    DEFAULT '',
      updated_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS archive_game_cr (
      id         SERIAL PRIMARY KEY,
      game_id    INTEGER NOT NULL REFERENCES archive_games(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
      content    TEXT    DEFAULT '',
      updated_at TEXT    DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(game_id, user_id)
    );

  `);
}

// ── 4. DONNÉES PAR DÉFAUT ────────────────────────────────────

async function initDefaults() {
  const defaults = [
    ['session_create',     2],
    ['session_edit',       1],
    ['session_delete',     2],
    ['proposal_add',       0],
    ['proposal_edit',      1],
    ['proposal_delete',    1],
    ['vote',               0],
    ['vote_lock',          1],
    ['programme_generate', 1],
    ['programme_edit',     1],
    ['programme_publish',  1],
    ['report_media',       0],
    ['report_scores',      0],
    ['report_notes',       0],
    ['players_scope',      0],
  ];
  for (const [action, level] of defaults) {
    await pool.query(
      'INSERT INTO permissions (action, level) VALUES ($1, $2) ON CONFLICT (action) DO NOTHING',
      [action, level]
    );
  }
}

// ── 5. BOOTSTRAP ADMIN ───────────────────────────────────────

async function ensureAdmin(username, passwordHash) {
  const existing = await pool.query('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
  if (!existing.rows.length) {
    await pool.query(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, 1) ON CONFLICT (username) DO NOTHING',
      [username, passwordHash]
    );
    console.log(`✅ Compte admin créé : ${username}`);
  }
}

// ── 6. INITIALISATION ────────────────────────────────────────

async function init() {
  await initSchema();
  await initDefaults();
  console.log('✅ Schéma PostgreSQL initialisé');
}

init().catch(e => {
  console.error('❌ Erreur initialisation DB:', e.message);
  process.exit(1);
});

// ── 7. EXPORT ────────────────────────────────────────────────

module.exports = { db, pool, ensureAdmin };
