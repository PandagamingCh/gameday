// ─────────────────────────────────────────────────────────────
// email.js — Utilitaires pour l'envoi d'emails
//
// Exports :
//   createTransporter()   Crée un transporteur nodemailer depuis les variables SMTP
//   getEmailSetting(key)  Lit un paramètre email depuis la table settings
//
// Dépend des variables d'environnement :
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
// ─────────────────────────────────────────────────────────────

'use strict';
const { db } = require('./database');

function getEmailSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function createTransporter() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

module.exports = { getEmailSetting, createTransporter };
