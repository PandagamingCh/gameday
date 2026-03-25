let Database;
try {
  Database = require('better-sqlite3');
} catch(e) {
  console.error('❌ Impossible de charger better-sqlite3 :', e.message);
  console.error('   Essayez : npm install better-sqlite3 --build-from-source');
  console.error('   Ou vérifiez que python3, make et gcc sont disponibles sur le serveur.');
  process.exit(1);
}

const path = require('path');

// Chemin de la base : variable d'env DB_PATH, sinon ./data/gameday.db
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gameday.db');

// Créer le dossier data si nécessaire
const fs = require('fs');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    bgg_username TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    bgg_synced_at TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS bgg_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bgg_id TEXT NOT NULL,
    name TEXT NOT NULL,
    year TEXT DEFAULT '',
    thumbnail TEXT DEFAULT '',
    min_players TEXT DEFAULT '',
    max_players TEXT DEFAULT '',
    min_time TEXT DEFAULT '',
    max_time TEXT DEFAULT '',
    UNIQUE(user_id, bgg_id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    used_by INTEGER REFERENCES users(id) DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    used_at TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    is_open INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🎲',
    subtitle TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS session_participants (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    proposed_by INTEGER NOT NULL REFERENCES users(id),
    bgg_id TEXT DEFAULT '',
    name TEXT NOT NULL,
    year TEXT DEFAULT '',
    thumbnail TEXT DEFAULT '',
    min_players TEXT DEFAULT '',
    max_players TEXT DEFAULT '',
    min_time TEXT DEFAULT '',
    max_time TEXT DEFAULT '',
    myludo_url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, category_id, user_id, proposal_id)
  );
`);

// Migration : table programme_slots
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS programme_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      start_time TEXT DEFAULT '',
      game_name TEXT DEFAULT '',
      duration_min INTEGER DEFAULT 60,
      players TEXT DEFAULT '',
      note TEXT DEFAULT '',
      is_break INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();
} catch(e) { console.error('Migration programme_slots:', e.message); }

// Migration : colonnes Table B sur programme_slots
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN game_name_b TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN players_b TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN duration_min_b INTEGER DEFAULT 0").run(); } catch(e) {}

// Migration : colonne myludo_url sur proposals
try {
  db.prepare("ALTER TABLE proposals ADD COLUMN myludo_url TEXT DEFAULT ''").run();
  console.log('Migration: colonne myludo_url ajoutée');
} catch(e) {}

// Tables archives
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS session_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      compte_rendu TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS archive_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      game_name TEXT NOT NULL,
      bgg_id TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      vainqueur TEXT DEFAULT '',
      scores TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS archive_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      caption TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();
} catch(e) { console.error('Migration archives:', e.message); }


// Migration : colonnes CR et joueurs par jeu dans archive_games
try { db.prepare("ALTER TABLE archive_games ADD COLUMN joueurs TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE archive_games ADD COLUMN compte_rendu TEXT DEFAULT ''").run(); } catch(e) {}
// Migration : lier archive_photos à un jeu (game_id optionnel)
try { db.prepare("ALTER TABLE archive_photos ADD COLUMN game_id INTEGER DEFAULT NULL").run(); } catch(e) {}


// Migration : table archive_media (remplace archive_photos + supporte vidéos)
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS archive_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      game_id INTEGER DEFAULT NULL,
      type TEXT DEFAULT 'photo',
      url TEXT NOT NULL,
      caption TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();
} catch(e) { console.error('Migration archive_media:', e.message); }



try { db.prepare('ALTER TABLE programme_slots ADD COLUMN duration_max INTEGER DEFAULT 0').run(); } catch(e) {}
try { db.prepare('ALTER TABLE programme_slots ADD COLUMN duration_max_b INTEGER DEFAULT 0').run(); } catch(e) {}

// Migration : colonne is_private sur sessions + table session_private_members
try {
  db.prepare(`ALTER TABLE sessions ADD COLUMN is_private INTEGER DEFAULT 0`).run();
} catch(e) {}
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS session_private_members (
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
} catch(e) { console.error('Migration session_private_members:', e.message); }

// Migration : colonne is_archived sur sessions
try { db.prepare("ALTER TABLE sessions ADD COLUMN is_archived INTEGER DEFAULT 0").run(); } catch(e) {}

function ensureAdmin(username, passwordHash) {
  const existing = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  if (!existing) {
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)')
      .run(username, passwordHash);
    console.log(`✅ Compte admin créé : ${username}`);
  }
}

// Migration : colonnes nb_players + duration_est sur programme_slots
try { db.prepare('ALTER TABLE programme_slots ADD COLUMN nb_players INTEGER DEFAULT NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE programme_slots ADD COLUMN nb_players_b INTEGER DEFAULT NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE programme_slots ADD COLUMN duration_est INTEGER DEFAULT NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE programme_slots ADD COLUMN duration_est_b INTEGER DEFAULT NULL').run(); } catch(e) {}
// Migration : colonnes teacher
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN teacher TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN teacher_b TEXT DEFAULT ''").run(); } catch(e) {}
// Migration : table C
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN game_name_c TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN duration_min_c INTEGER DEFAULT 0").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN duration_max_c INTEGER DEFAULT 0").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN duration_est_c INTEGER DEFAULT NULL").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN nb_players_c INTEGER DEFAULT NULL").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN players_c TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN teacher_c TEXT DEFAULT ''").run(); } catch(e) {}
// Migration : thumbnails sur programme_slots
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN thumbnail TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN thumbnail_b TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE programme_slots ADD COLUMN thumbnail_c TEXT DEFAULT ''").run(); } catch(e) {}
try { db.prepare("ALTER TABLE archive_media ADD COLUMN thumbnail TEXT DEFAULT ''").run(); } catch(e) {}
// Migration : teacher sur proposals
try { db.prepare("ALTER TABLE proposals ADD COLUMN teacher TEXT DEFAULT ''").run(); } catch(e) {}
// Migration : durée teaching sur proposals
try { db.prepare('ALTER TABLE proposals ADD COLUMN teach_duration INTEGER DEFAULT NULL').run(); } catch(e) {}
// Migration : reset tokens
try { db.prepare(`CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  used INTEGER DEFAULT 0
)`).run(); } catch(e) {}
try { db.prepare('ALTER TABLE sessions ADD COLUMN programme_validated INTEGER DEFAULT 0').run(); } catch(e) {}
// Migration : votes_locked sur sessions
try { db.prepare('ALTER TABLE sessions ADD COLUMN votes_locked INTEGER DEFAULT 0').run(); } catch(e) {}
// Migration : submitted_at sur rankings
try { db.prepare("ALTER TABLE rankings ADD COLUMN submitted_at TEXT DEFAULT (datetime('now'))").run(); } catch(e) {}

// Tables doodle
try { db.prepare(`CREATE TABLE IF NOT EXISTS doodles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  closed INTEGER DEFAULT 0,
  session_id INTEGER DEFAULT NULL REFERENCES sessions(id)
)`).run(); } catch(e) {}

try { db.prepare(`CREATE TABLE IF NOT EXISTS doodle_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doodle_id INTEGER NOT NULL REFERENCES doodles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
)`).run(); } catch(e) {}

try { db.prepare(`CREATE TABLE IF NOT EXISTS doodle_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doodle_id INTEGER NOT NULL REFERENCES doodles(id) ON DELETE CASCADE,
  date_id INTEGER NOT NULL REFERENCES doodle_dates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer TEXT NOT NULL CHECK(answer IN ('yes','no','maybe')),
  UNIQUE(date_id, user_id)
)`).run(); } catch(e) {}

console.log(`🗄  Base de données : ${dbPath}`);

// Table permissions
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS permissions (
    action TEXT PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 0
  )`).run();

  // Niveaux : 0=tous, 1=créateur/proposant, 2=admin
  const defaults = [
    ['session_create',    2],
    ['session_edit',      1],
    ['session_delete',    2],
    ['proposal_add',      0],
    ['proposal_edit',     1],
    ['proposal_delete',   1],
    ['vote',              0],
    ['vote_lock',         1],
    ['programme_generate',1],
    ['programme_edit',    1],
    ['programme_publish', 1],
    ['report_media',      0],
    ['report_scores',     0],
    ['report_notes',      0],
    ['players_scope',     0], // 0=tous le site, 1=inscrits séance
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO permissions (action, level) VALUES (?, ?)');
  db.transaction(() => defaults.forEach(([a, l]) => ins.run(a, l)))();
} catch(e) {}

module.exports = { db, ensureAdmin };

// Migration : note BGG sur proposals et bgg_games
try { db.prepare('ALTER TABLE proposals ADD COLUMN bgg_rating TEXT DEFAULT NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE bgg_games ADD COLUMN bgg_rating TEXT DEFAULT NULL').run(); } catch(e) {}
// Migration : weight BGG
try { db.prepare('ALTER TABLE proposals ADD COLUMN bgg_weight TEXT DEFAULT NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE bgg_games ADD COLUMN bgg_weight TEXT DEFAULT NULL').run(); } catch(e) {}
// Table settings (clé-valeur globale)
db.prepare(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`).run();
// Migration : email utilisateur + reset par email
try { db.prepare('ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL').run(); } catch(e) {}
// Ajouter expires_at à reset_tokens si pas présent
try { db.prepare('ALTER TABLE reset_tokens ADD COLUMN expires_at TEXT DEFAULT NULL').run(); } catch(e) {}
