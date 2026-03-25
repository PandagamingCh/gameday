'use strict';
require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');

const { db, ensureAdmin }          = require('./src/database');
const { syncUserCollection }       = require('./src/bgg');
const { startAutoBackup }          = require('./src/backup');


// ── App ──────────────────────────────────────────────────────
const app = express();
const PORT           = process.env.PORT           || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'gameday-secret-change-me-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Store de sessions SQLite ─────────────────────────────────
const session_store = require('express-session').Store;
class SQLiteStore extends session_store {
  constructor(db) {
    super();
    this.db = db;
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    )`).run();
    setInterval(() => {
      try { db.prepare('DELETE FROM auth_sessions WHERE expired < ?').run(Date.now()); } catch(e) {}
    }, 3600000);
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expired FROM auth_sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expired < Date.now()) { this.destroy(sid, () => {}); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch(e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expired = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.db.prepare('INSERT OR REPLACE INTO auth_sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
      cb && cb(null);
    } catch(e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this.db.prepare('DELETE FROM auth_sessions WHERE sid = ?').run(sid); cb && cb(null); } catch(e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

app.use(session({
  store: new SQLiteStore(db),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// ── Bootstrap admin ──────────────────────────────────────────
bcrypt.hash(ADMIN_PASSWORD, 10).then(hash => ensureAdmin('admin', hash));

// ── Routes ───────────────────────────────────────────────────

app.use('/',             require('./src/routes/auth'));
app.use('/',             require('./src/routes/settings'));
app.use('/',             require('./src/routes/invites'));
app.use('/',             require('./src/routes/bgg'));
app.use('/',             require('./src/routes/sessions'));
app.use('/',             require('./src/routes/categories'));
app.use('/',             require('./src/routes/proposals'));
app.use('/',             require('./src/routes/rankings'));
app.use('/',             require('./src/routes/admin'));
app.use('/',             require('./src/routes/doodle'));
app.use('/',             require('./src/routes/programme'));
app.use('/',             require('./src/routes/archives'));

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎲 GameDay server running on http://localhost:${PORT}`);
  startAutoBackup(db);
});
