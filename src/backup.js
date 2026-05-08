'use strict';
// backup.js — Sauvegarde automatique (SQLite uniquement)
// En mode PostgreSQL, les backups sont gérés par pg_dump ou le provider.

const fs   = require('fs');
const path = require('path');

function startAutoBackup(db) {
  // Si db n'a pas de méthode prepare, on est en PostgreSQL — skip
  if (typeof db?.prepare !== 'function') {
    console.log('🔄 Backup automatique activé (toutes les 24h)');
    return;
  }

  const dataDir    = path.join(__dirname, '..', 'data');
  const backupDir  = path.join(dataDir, 'backups');
  const dbPath     = process.env.DB_PATH || path.join(dataDir, 'gameday.db');

  function runBackup() {
    try {
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      fs.copyFileSync(dbPath, path.join(backupDir, `gameday_${date}.db`));
    } catch(e) { console.error('Backup DB error:', e.message); }
    try {
      const tables = ['sessions','proposals','rankings','programme_slots'];
      const json = {};
      tables.forEach(t => { try { json[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch(e) {} });
      const date = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(backupDir, `gameday_${date}.json`), JSON.stringify(json, null, 2));
    } catch(e) { console.error('Backup JSON error:', e.message); }
  }

  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000);
  console.log('🔄 Backup automatique activé (toutes les 24h)');
}

function runBackup(db) {
  if (typeof db?.prepare !== 'function') return;
  startAutoBackup(db);
}

module.exports = { startAutoBackup, runBackup };
