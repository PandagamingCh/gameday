// ─────────────────────────────────────────────────────────────
// middleware/auth.js — Middlewares d'authentification et permissions (PostgreSQL)
// ─────────────────────────────────────────────────────────────

const { db } = require('../database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  const user = await db.get('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  req.session.isAdmin = true;
  next();
}

function requirePerm(action, getOwnerId = null) {
  return async (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
    const user = await db.get('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (user?.is_admin) return next();
    const perm = await db.get('SELECT level FROM permissions WHERE action = $1', [action]);
    const level = perm?.level ?? 0;
    if (level === 0) return next();
    if (level === 1 && getOwnerId) {
      const ownerId = await Promise.resolve(getOwnerId(req));
      if (ownerId != null && req.session.userId === ownerId) return next();
    }
    return res.status(403).json({ error: 'Permission insuffisante' });
  };
}

async function canDo(userId, action, ownerId = null) {
  const user = await db.get('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (user?.is_admin) return true;
  const perm = await db.get('SELECT level FROM permissions WHERE action = $1', [action]);
  const level = perm?.level ?? 0;
  if (level === 0) return true;
  if (level === 1) return ownerId != null && userId === ownerId;
  return false;
}

module.exports = { requireAuth, requireAdmin, requirePerm, canDo };
