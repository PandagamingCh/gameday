// ─────────────────────────────────────────────────────────────
// api.js — Fonction centrale api() et utilitaires partagés
//
// Contient :
//   - api(method, url, body)  Appel fetch vers le backend, gère les erreurs
//   - showToast(msg)          Notification temporaire en bas d'écran
//   - esc(str)                Échappe le HTML pour éviter les injections XSS
//   - formatDate(str)         Formate une date ISO en français
// ─────────────────────────────────────────────────────────────

// API HELPER
// ═══════════════════════════════════════════════════
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    console.warn(`API ${method} ${url} returned non-JSON (${r.status})`);
    return { error: `Erreur serveur (${r.status})` };
  }
  return r.json();
}

// ═══════════════════════════════════════════════════
