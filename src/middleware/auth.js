// ─────────────────────────────────────────────────────────────
// middleware/auth.js — Middlewares d'authentification et permissions
//
// Exports :
//   requireAuth          Vérifie qu'un utilisateur est connecté (401 sinon)
//   requireAdmin         Vérifie que l'utilisateur est admin (403 sinon)
//   requirePerm(action, getOwnerId)
//                        Vérifie la permission selon le niveau configuré :
//                        0=tous, 1=créateur/proposant, 2=admin uniquement
//   canDo(userId, action, ownerId)
//                        Version booléenne de requirePerm (sans middleware)
// ─────────────────────────────────────────────────────────────

// ── Middleware d'authentification et permissions ─────────────

const { db } = require('../database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user?.is_admin) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  req.session.isAdmin = true;
  next();
}

function requirePerm(action, getOwnerId = null) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (user?.is_admin) return next();
    const perm = db.prepare('SELECT level FROM permissions WHERE action = ?').get(action);
    const level = perm?.level ?? 0;
    if (level === 0) return next();
    if (level === 1 && getOwnerId) {
      const ownerId = getOwnerId(req);
      if (ownerId != null && req.session.userId === ownerId) return next();
    }
    return res.status(403).json({ error: 'Permission insuffisante' });
  };
}

function canDo(userId, action, ownerId = null) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  if (user?.is_admin) return true;
  const perm = db.prepare('SELECT level FROM permissions WHERE action = ?').get(action);
  const level = perm?.level ?? 0;
  if (level === 0) return true;
  if (level === 1) return ownerId != null && userId === ownerId;
  return false;
}

module.exports = { requireAuth, requireAdmin, requirePerm, canDo };
