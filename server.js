'use strict';
require('dotenv').config();
const path    = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');

const { db, pool, ensureAdmin }    = require('./src/database');
const { syncUserCollection }       = require('./src/bgg');
const { startAutoBackup }          = require('./src/backup');

// ── App ──────────────────────────────────────────────────────
const app = express();
const PORT           = process.env.PORT           || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'gameday-secret-change-me-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Sessions ─────────────────────────────────────────────────
const PgStore = require('connect-pg-simple')(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'auth_sessions', createTableIfMissing: true }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// ── Bootstrap admin ──────────────────────────────────────────
bcrypt.hash(ADMIN_PASSWORD, 10).then(hash => ensureAdmin('admin', hash));

// ── SSE ──────────────────────────────────────────────────────
const { sseRouter, broadcast, broadcastAll } = require('./src/sse');
app.use('/', sseRouter);
app.locals.broadcast    = broadcast;
app.locals.broadcastAll = broadcastAll;

// ── Routes ───────────────────────────────────────────────────
app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/settings'));
app.use('/', require('./src/routes/invites'));
app.use('/', require('./src/routes/bgg'));
app.use('/', require('./src/routes/sessions'));
app.use('/', require('./src/routes/categories'));
app.use('/', require('./src/routes/proposals'));
app.use('/', require('./src/routes/rankings'));
app.use('/', require('./src/routes/admin'));
app.use('/', require('./src/routes/doodle'));
app.use('/', require('./src/routes/programme'));
app.use('/', require('./src/routes/archives'));

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎲 GameDay server running on http://localhost:${PORT}`);
  startAutoBackup(db);
});
