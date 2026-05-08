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
// ─────────────────────────────────────────────────────────────
// auth.js — Authentification (login, register, logout)
//
// Contient :
//   - doLogin()      Lit le formulaire login, appelle POST /api/login
//   - doRegister()   Lit le formulaire register, appelle POST /api/register
//   - doLogout()     Appelle POST /api/logout et recharge la page
// ─────────────────────────────────────────────────────────────

// AUTH
// ═══════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  err.classList.remove('visible');
  const res = await api('POST', '/api/login', { username, password });
  if (res.error) { err.textContent = res.error; err.classList.add('visible'); return; }
  currentUser = res.user;
  if (res.features) siteFeatures = { ...siteFeatures, ...res.features };
  onLoggedIn();
}

async function doRegister() {
  const inviteRaw = document.getElementById('regInvite').value.trim();
  // Extract token from full URL if pasted
  const token = inviteRaw.includes('invite=') ? inviteRaw.split('invite=').pop() : inviteRaw;
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value;
  const bggUsername = document.getElementById('regBGG').value.trim();
  const err = document.getElementById('registerErr');
  err.classList.remove('visible');
  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'Création…';
  const res = await api('POST', '/api/register', { username, password, bggUsername, inviteToken: token });
  btn.disabled = false; btn.textContent = 'Créer mon compte';
  if (res.error) { err.textContent = res.error; err.classList.add('visible'); return; }
  currentUser = res.user;
  if (bggUsername) showToast(`Compte créé ! Collection BGG en cours de synchronisation…`);
  else showToast('Compte créé !');
  onLoggedIn();
}

async function doLogout() {
  await api('POST', '/api/logout');
  currentUser = null; currentSession = null;
  showPage('page-login');
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// theme.js — Gestion du thème visuel et des features du site
//
// Chargé EN SECOND (après api.js) car ses fonctions sont
// appelées très tôt dans onLoggedIn().
//
// Contient :
//   - applyFeatures()       Masque/affiche les éléments selon les features activées
//                           (BGG, IA, email reset)
//   - applyStoredTheme()    Applique le thème et les overrides CSS sauvegardés
//   - setTheme(theme)       Change le thème clair/sombre et recharge les overrides
//   - toggleTheme()         Bascule entre clair et sombre
//   - TYPO_VARS / LAYOUT_VARS  Définition des variables CSS éditables
//   - renderThemeEditor()   Construit l'interface d'édition du thème dans l'admin
//   - IIFE au chargement    Applique immédiatement le thème pour éviter le flash
// ─────────────────────────────────────────────────────────────

// THEME
// ═══════════════════════════════════════════════════
function applyTheme(theme) {
  setTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// Appliquer le thème sauvegardé au chargement
(function() {
  const saved = localStorage.getItem('gameday_theme') || localStorage.getItem('gd_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  const navText = localStorage.getItem('gameday_nav_text');
  if (navText) document.documentElement.style.setProperty('--nav-text', navText);
})();

// ═══════════════════════════════════════════════════

function applyFeatures() {
  // BGG — masquer collections et sync si pas disponible
  document.querySelectorAll('.bgg-feature').forEach(el => {
    el.style.display = siteFeatures.bgg ? '' : 'none';
  });
  // IA — masquer section génération IA si pas de clé Anthropic
  document.querySelectorAll('.ai-feature').forEach(el => {
    el.style.display = siteFeatures.ai ? '' : 'none';
  });

  // Appliquer le thème sauvegardé
  applyStoredTheme();
}

function applyStoredTheme() {
  const theme = localStorage.getItem('gameday_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-toggle:not(#cbBtn), #themeBtn').forEach(btn => {
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  });
  applyThemeOverrides(theme);
  // Appliquer typo et layout
  const overrides = getThemeOverrides(theme);
  if (overrides['--font-mono']) document.body.style.fontFamily = overrides['--font-mono'];
  if (overrides['--font-size-base']) document.body.style.fontSize = overrides['--font-size-base'];
  if (overrides['--content-width']) {
    document.querySelectorAll('.container').forEach(el => el.style.maxWidth = overrides['--content-width']);
  }
}

function toggleApparenceSub(titleEl) {
  titleEl.closest('.apparence-sub').classList.toggle('collapsed');
}

const TYPO_VARS = [
  { key: '--font-mono',    label: 'Police principale', type: 'font',   default: "'DM Mono', monospace",
    options: ["'DM Mono', monospace", "'Space Mono', monospace", "'Courier New', monospace", "'IBM Plex Mono', monospace", "monospace"] },
  { key: '--font-serif',   label: 'Police des titres', type: 'font',   default: "'Fraunces', serif",
    options: ["'Fraunces', serif", "'Playfair Display', serif", "'Georgia', serif", "'Crimson Text', serif", "serif"] },
  { key: '--font-size-base', label: 'Taille du texte', type: 'range', default: '14px', min: 11, max: 18, step: 1, unit: 'px' },
];

const LAYOUT_VARS = [
  { key: '--radius',    label: 'Arrondi des coins (grand)', type: 'range', default: '14px', min: 0, max: 28, step: 2, unit: 'px' },
  { key: '--radius-sm', label: 'Arrondi des coins (petit)', type: 'range', default: '8px',  min: 0, max: 16, step: 2, unit: 'px' },
  { key: '--content-width', label: 'Largeur du contenu',  type: 'range', default: '1000px', min: 700, max: 1400, step: 50, unit: 'px' },
  { key: '--noise-opacity', label: 'Grain de fond',        type: 'range', default: '0.03',  min: 0, max: 0.1, step: 0.01, unit: '' },
];

function renderTypoEditor() {
  const panel = document.getElementById('themeTypoEditor');
  if (!panel) return;
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const overrides = getThemeOverrides(theme);

  panel.innerHTML = TYPO_VARS.map(v => {
    const current = overrides[v.key] || v.default;
    if (v.type === 'font') {
      return `<div style="margin-bottom:10px" onclick="event.stopPropagation()">
        <div style="font-size:.72rem;margin-bottom:4px">${v.label}</div>
        <select class="form-input" style="font-size:.75rem" onchange="applyThemeVarLive('${v.key}', this.value, '${theme}')">
          ${v.options.map(o => `<option value="${o}" ${current === o ? 'selected' : ''}>${o.split(',')[0].replace(/'/g,'')}</option>`).join('')}
        </select>
      </div>`;
    } else {
      const numVal = parseFloat(current) || parseFloat(v.default);
      return `<div style="margin-bottom:10px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:.72rem">${v.label}</span>
          <span style="font-size:.7rem;color:var(--text-muted)" id="tv_${v.key.replace(/-/g,'_')}">${numVal}${v.unit}</span>
        </div>
        <input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${numVal}"
          style="width:100%;accent-color:var(--accent)"
          oninput="applyTypoVar('${v.key}', this.value, '${v.unit}', '${theme}', 'tv_${v.key.replace(/-/g,'_')}')">
      </div>`;
    }
  }).join('');
}

function applyTypoVar(key, value, unit, theme, labelId) {
  const fullVal = value + unit;
  document.documentElement.style.setProperty(key, fullVal);
  saveThemeOverride(theme, key, fullVal);
  const label = document.getElementById(labelId);
  if (label) label.textContent = value + unit;
  // Appliquer les polices sur body/titres
  if (key === '--font-mono') document.body.style.fontFamily = fullVal;
  if (key === '--font-size-base') document.body.style.fontSize = fullVal;
}

function renderLayoutEditor() {
  const panel = document.getElementById('themeLayoutEditor');
  if (!panel) return;
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const overrides = getThemeOverrides(theme);

  panel.innerHTML = LAYOUT_VARS.map(v => {
    const current = overrides[v.key] || v.default;
    const numVal = parseFloat(current) || parseFloat(v.default);
    return `<div style="margin-bottom:10px" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:.72rem">${v.label}</span>
        <span style="font-size:.7rem;color:var(--text-muted)" id="tl_${v.key.replace(/-/g,'_')}">${numVal}${v.unit}</span>
      </div>
      <input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${numVal}"
        style="width:100%;accent-color:var(--accent)"
        oninput="applyLayoutVar('${v.key}', this.value, '${v.unit}', '${theme}', 'tl_${v.key.replace(/-/g,'_')}')">
    </div>`;
  }).join('');
}

function applyLayoutVar(key, value, unit, theme, labelId) {
  const fullVal = value + unit;
  document.documentElement.style.setProperty(key, fullVal);
  saveThemeOverride(theme, key, fullVal);
  const label = document.getElementById(labelId);
  if (label) label.textContent = value + unit;
  // Appliquer largeur contenu
  if (key === '--content-width') {
    document.querySelectorAll('.container').forEach(el => el.style.maxWidth = fullVal);
  }
}

function renderThemeEditor() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.getElementById('themeBtnDark')?.classList.toggle('accent', theme === 'dark');
  document.getElementById('themeBtnLight')?.classList.toggle('accent', theme === 'light');
  renderThemeVarsEditor();
  renderTypoEditor();
  renderLayoutEditor();
}

function applyTheme(theme) { setTheme(theme); }

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

const THEME_EDIT_VARS = [
  { key: '--bg',        label: 'Fond' },
  { key: '--surface',   label: 'Surface carte' },
  { key: '--accent',    label: 'Couleur principale' },
  { key: '--accent2',   label: 'Couleur secondaire' },
  { key: '--text',      label: 'Texte' },
  { key: '--text-muted',label: 'Texte secondaire' },
  { key: '--nav-text',  label: 'Texte navigation' },
  { key: '--border',    label: 'Bordure' },
];

// Defaults par thème
const THEME_DEFAULTS = {
  dark: {
    '--bg':'#0f0e0b','--surface':'#1a1814','--accent':'#e8b84b','--accent2':'#c47a3a',
    '--text':'#f0ead8','--text-muted':'#6a6458','--nav-text':'#6a6458','--border':'#2e2c24'
  },
  light: {
    '--bg':'#cfc8ba','--surface':'#dcd6c8','--accent':'#b8860b','--accent2':'#a0621a',
    '--text':'#2a2620','--text-muted':'#8a8070','--nav-text':'#8a8070','--border':'#ddd8cc'
  }
};

function getThemeOverrides(theme) {
  return JSON.parse(localStorage.getItem(`gameday_theme_${theme}`) || '{}');
}

function saveThemeOverride(theme, key, value) {
  const overrides = getThemeOverrides(theme);
  overrides[key] = value;
  localStorage.setItem(`gameday_theme_${theme}`, JSON.stringify(overrides));
  // Persister en DB si admin
  if (currentUser?.is_admin) {
    api('PATCH', '/api/settings', { key: `theme_${theme}`, value: overrides }).catch(() => {});
  }
}

function applyThemeOverrides(theme) {
  const overrides = getThemeOverrides(theme);
  Object.entries(overrides).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

function renderThemeVarsEditor() {
  const panel = document.getElementById('themeVarsEditor');
  if (!panel) return;
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const overrides = getThemeOverrides(theme);
  const defaults = THEME_DEFAULTS[theme] || {};

  panel.innerHTML = `<div style="font-size:.75rem;font-weight:600;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Thème ${theme === 'dark' ? 'Sombre 🌙' : 'Clair ☀️'}</div>` +
    THEME_EDIT_VARS.map(v => {
      const current = overrides[v.key] || defaults[v.key] || '#888888';
      const hasOverride = !!overrides[v.key];
      return `<div data-varkey="${v.key}" style="display:flex;align-items:center;gap:10px;margin-bottom:8px" onclick="event.stopPropagation()">
        <input type="color" value="${current}" style="width:36px;height:32px;border:none;cursor:pointer;border-radius:6px;padding:2px;flex-shrink:0"
          oninput="applyThemeVarLive('${v.key}', this.value, '${theme}')"
          onchange="applyThemeVarLive('${v.key}', this.value, '${theme}')">
        <span style="font-size:.78rem;flex:1">${v.label}</span>
        <button class="btn-sm ghost var-reset-btn" style="padding:2px 6px;font-size:.65rem;${hasOverride ? '' : 'display:none'}" onclick="event.stopPropagation();resetThemeVar('${v.key}','${theme}')">↺</button>
      </div>`;
    }).join('');
}

function applyThemeVarLive(key, value, theme) {
  document.documentElement.style.setProperty(key, value);
  saveThemeOverride(theme, key, value);
  // Afficher le bouton reset sans recréer le DOM
  const row = event?.target?.closest('[data-varkey]');
  if (row) {
    const resetBtn = row.querySelector('.var-reset-btn');
    if (resetBtn) resetBtn.style.display = '';
  }
}

function resetThemeVar(key, theme) {
  const overrides = getThemeOverrides(theme);
  delete overrides[key];
  localStorage.setItem(`gameday_theme_${theme}`, JSON.stringify(overrides));
  document.documentElement.style.removeProperty(key);
  renderThemeVarsEditor();
}

function resetCurrentTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  localStorage.removeItem(`gameday_theme_${theme}`);
  [...THEME_EDIT_VARS, ...TYPO_VARS, ...LAYOUT_VARS].forEach(v => document.documentElement.style.removeProperty(v.key));
  document.body.style.fontFamily = '';
  document.body.style.fontSize = '';
  document.querySelectorAll('.container').forEach(el => el.style.maxWidth = '');
  if (currentUser?.is_admin) {
    api('PATCH', '/api/settings', { key: `theme_${theme}`, value: {} }).catch(() => {});
  }
  renderThemeEditor();
  showToast('Thème réinitialisé');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gameday_theme', theme);
  // Thème personnel : uniquement en localStorage, pas synchro serveur
  // (le thème serveur est le défaut pour les nouveaux utilisateurs, géré dans admin)
  document.querySelectorAll('.theme-toggle:not(#cbBtn), #themeBtn').forEach(btn => {
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  });
  document.getElementById('themeBtnDark')?.classList.toggle('accent', theme === 'dark');
  document.getElementById('themeBtnLight')?.classList.toggle('accent', theme === 'light');
  // Appliquer les overrides du nouveau thème
  [...THEME_EDIT_VARS, ...TYPO_VARS, ...LAYOUT_VARS].forEach(v => document.documentElement.style.removeProperty(v.key));
  document.body.style.fontFamily = '';
  document.body.style.fontSize = '';
  document.querySelectorAll('.container').forEach(el => el.style.maxWidth = '');
  applyThemeOverrides(theme);
  const overrides = getThemeOverrides(theme);
  if (overrides['--font-mono']) document.body.style.fontFamily = overrides['--font-mono'];
  if (overrides['--font-size-base']) document.body.style.fontSize = overrides['--font-size-base'];
  if (overrides['--content-width']) document.querySelectorAll('.container').forEach(el => el.style.maxWidth = overrides['--content-width']);
  renderThemeEditor();
}


function toggleAdminSection(titleEl) {
  titleEl.closest('.admin-section').classList.toggle('collapsed');
}


// ─────────────────────────────────────────────────────────────
// MODE COLOR-BLIND (overlay sur le thème clair/sombre)
// ─────────────────────────────────────────────────────────────

function toggleColorblind() {
  const enabled = document.documentElement.getAttribute('data-cb') === '1';
  setColorblind(!enabled);
}

function setColorblind(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-cb', '1');
    localStorage.setItem('colorblind', '1');
  } else {
    document.documentElement.removeAttribute('data-cb');
    localStorage.removeItem('colorblind');
  }
  // Mettre à jour l'état visuel du bouton (highlight si actif)
  const btn = document.getElementById('cbBtn');
  if (btn) btn.classList.toggle('cb-active', enabled);
}

// Restaurer le mode au chargement
(function() {
  if (localStorage.getItem('colorblind') === '1') {
    document.documentElement.setAttribute('data-cb', '1');
    // Appliquer la classe highlight dès que le DOM est prêt
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('cbBtn');
      if (btn) btn.classList.add('cb-active');
    }, { once: true });
  }
})();
// ─────────────────────────────────────────────────────────────
// app.js — Point d'entrée de l'application, state global
//
// Chargé EN DERNIER après tous les autres modules JS.
//
// Contient :
//   - Variables globales : currentUser, currentSession, siteFeatures, etc.
//   - init()          Vérifie la session au chargement, redirige login/accueil
//   - onLoggedIn()    Appelé après login : charge données, applique thème/features
//   - showPage(id)    Affiche une page (div#page-xxx), masque les autres
//   - switchTab()     Gère les onglets d'une séance (Proposer/Voter/Programme/etc.)
// ─────────────────────────────────────────────────────────────

// STATE
// ═══════════════════════════════════════════════════
let currentUser = null;
let currentSession = null; // full session data
let userCollections = {}; // userId -> games[]
let allSiteUsers = []; // tous les membres inscrits au site
let sitePermissions = {}; // action -> level
let siteFeatures = { bgg: true, ai: false, email_reset: false }; // features disponibles
let activeCollectionUserId = null; // which user's collection is shown in propose

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
async function init() {
  // Check if invite link
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('invite');
  if (invite) {
    document.getElementById('regInvite').value = invite;
    showPage('page-register');
    return;
  }

  const me = await api('GET', '/api/me');
  if (me.user) {
    currentUser = me.user;
    if (me.features) siteFeatures = { ...siteFeatures, ...me.features };
    onLoggedIn();
  } else {
    showPage('page-login');
  }
}

function onLoggedIn() {
  // Générer les options du datalist horaires (8h00 → 22h00 par 15min)
  const dl = document.getElementById('slotTimeOptions');
  if (dl && !dl.children.length) {
    for (let i = 0; i <= 56; i++) {
      const total = 8 * 60 + i * 15;
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (h > 22) break;
      const opt = document.createElement('option');
      opt.value = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      dl.appendChild(opt);
    }
  }
  document.querySelectorAll('.uname').forEach(el => el.textContent = currentUser.username);
  if (currentUser.is_admin) {
    const _aBtn = document.getElementById('adminNavBtn'); if (_aBtn) _aBtn.style.display = '';
  }
  applyFeatures();
  // Charger les settings de thème + email depuis le serveur
  api('GET', '/api/settings').then(res => {
    const s = res.settings || {};
    if (s.theme_dark) { localStorage.setItem('gameday_theme_dark', JSON.stringify(s.theme_dark)); }
    if (s.theme_light) { localStorage.setItem('gameday_theme_light', JSON.stringify(s.theme_light)); }
    // Ne PAS écraser le choix local de l'utilisateur — le thème serveur sert seulement de défaut
    if (s.theme_active && !localStorage.getItem('gameday_theme')) {
      localStorage.setItem('gameday_theme', s.theme_active);
    }
    applyStoredTheme();
    // Afficher lien "Mot de passe oublié" si email reset activé
    if (s.email_reset_enabled) {
      sitePermissions['email_reset_enabled'] = true;
      const lnk = document.getElementById('forgotPasswordLink');
      if (lnk) lnk.style.display = '';
    }
  }).catch(() => {});
  // Charger tous les membres du site et les permissions
  api('GET', '/api/users').then(res => { allSiteUsers = res.users || []; }).catch(() => {});
  api('GET', '/api/permissions').then(res => {
    sitePermissions = {};
    (res.permissions || []).forEach(p => sitePermissions[p.action] = p.level);
  }).catch(() => {});
  // Détecter URL /doodle/:token
  const doodleMatch = window.location.pathname.match(/^\/doodle\/([^/]+)$/);
  if (doodleMatch) {
    showPage('page-doodle');
    openDoodle(doodleMatch[1]);
    return;
  }
  loadHome();
  initSSE();
}

// ═══════════════════════════════════════════════════
// SERVER-SENT EVENTS
// ═══════════════════════════════════════════════════
let _sseSource = null;
let _sseSessionId = 0;
let _sseRetryTimer = null;

function initSSE(sessionId) {
  if (_sseSource) { _sseSource.close(); _sseSource = null; }
  if (_sseRetryTimer) { clearTimeout(_sseRetryTimer); _sseRetryTimer = null; }

  _sseSessionId = sessionId || 0;
  const es = new EventSource('/api/events?sessionId=' + _sseSessionId);
  _sseSource = es;

  es.addEventListener('connected', () => {
    console.log('SSE connecté, séance:', _sseSessionId);
  });

  // Rafraîchir l'accueil et la séance courante
  const refreshAll = () => {
    if (currentSession?.session?.id === _sseSessionId) reloadSession();
    api('GET', '/api/sessions').catch(() => {});
  };

  es.addEventListener('participant.joined', refreshAll);
  es.addEventListener('participant.left',   refreshAll);
  es.addEventListener('session.updated',    refreshAll);

  es.addEventListener('vote.submitted', (e) => {
    const data = JSON.parse(e.data);
    if (data.userId === currentUser?.id) return;
    if (currentSession?.session?.id === _sseSessionId) {
      reloadSession().then(() => {
        const activeTab = document.querySelector('.tab.active');
        const tabName = activeTab?.getAttribute('onclick')?.match(/switchTab\('(\w+)'/)?.[1];
        if (tabName === 'vote') renderVotePanel();
        if (tabName === 'results') renderResultsPanel();
      });
    }
  });

  es.addEventListener('archive.updated', (e) => {
    const data = JSON.parse(e.data);
    if (data.userId === currentUser?.id) return;
    if (currentSession?.session?.id === _sseSessionId) {
      const activeTab = document.querySelector('.tab.active');
      const tabName = activeTab?.getAttribute('onclick')?.match(/switchTab\('(\w+)'/)?.[1];
      if (tabName === 'archive') renderArchivePanel();
    }
  });

  es.addEventListener('session.created', () => {
    // Rafraîchir l'accueil pour voir la nouvelle séance
    if (document.getElementById('page-home')?.classList.contains('active')) loadHome();
  });

  es.addEventListener('doodle.created', () => {
    // Rafraîchir la bannière doodles sur l'accueil
    if (document.getElementById('doodleBanner')) loadHome();
  });

  es.addEventListener('doodle.voted', () => {
    // Rafraîchir si on est sur la page doodle ou accueil
    if (typeof loadDoodlePage === 'function' && document.getElementById('page-doodle')?.classList.contains('active')) loadDoodlePage();
    if (document.getElementById('doodleBanner')) loadHome();
  });

  es.addEventListener('notes.updated', () => {
    if (currentSession?.session?.id === _sseSessionId) {
      api('GET', `/api/sessions/${_sseSessionId}/notes`).then(r => {
        if (r.notes) { currentSession.notes = r.notes; renderLocationBox(); }
      });
    }
  });

  es.addEventListener('programme.updated', (e) => {
    const data = JSON.parse(e.data);
    if (data.userId === currentUser?.id) return;
    if (currentSession?.session?.id === _sseSessionId) {
      const activeTab = document.querySelector('.tab.active');
      const tabName = activeTab?.getAttribute('onclick')?.match(/switchTab\('(\w+)'/)?.[1];
      if (tabName === 'programme') renderProgrammePanel();
    }
  });

  es.onerror = () => {
    es.close();
    _sseSource = null;
    _sseRetryTimer = setTimeout(() => initSSE(_sseSessionId), 5000);
  };
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  // Nav globale : masquée sur login/register/forgot, visible sinon
  const noNav = ['page-login', 'page-register', 'page-forgot-password'];
  const nav = document.getElementById('global-nav');
  if (nav) nav.style.display = noNav.includes(id) ? 'none' : '';

  // Surbrillance du bouton actif
  const pageToNav = {
    'page-home':    'navHome',
    'page-session': 'navHome',
    'page-doodle':  'navDoodle',
    'page-stats':   'navStats',
    'page-profile': 'navProfile',
    'page-admin':   'adminNavBtn',
  };
  document.querySelectorAll('#global-nav .btn-sm.ghost').forEach(b => b.classList.remove('nav-active'));
  const activeNavId = pageToNav[id];
  if (activeNavId) {
    const activeBtn = document.getElementById(activeNavId);
    if (activeBtn) activeBtn.classList.add('nav-active');
  }

  // Bouton Accueil : toujours visible mais actif sur home/session
  const navHome = document.getElementById('navHome');
  if (navHome) navHome.style.display = '';

  if (id === 'page-profile') loadProfile();
  if (id === 'page-stats') loadStats();
  if (id === 'page-admin') loadAdmin();
  if (id === 'page-doodle') loadDoodlePage();
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
  if (tab === 'vote') renderVotePanel();
  if (tab === 'results') renderResultsPanel();
  if (tab === 'programme') renderProgrammePanel();
  if (tab === 'convention') renderConventionPanel();
  if (tab === 'reservations') renderReservationsPanel();
  if (tab === 'archive') renderArchivePanel();
}

// ═══════════════════════════════════════════════════

init();
// ─────────────────────────────────────────────────────────────
// home.js — Page d'accueil : liste des séances
//
// Contient :
//   - loadHome()                Charge et affiche toutes les séances
//   - makeSessionCard(s)        Construit le HTML d'une carte séance
//   - openNewSession()          Ouvre le formulaire de création
//   - createSession()           Soumet le formulaire, crée la séance via API
//   - toggleArchivedSessions()  Affiche/masque les séances passées
// ─────────────────────────────────────────────────────────────

// HOME
// ═══════════════════════════════════════════════════
async function loadHome() {
  showPage('page-home');
  await refreshHome();
}

async function refreshHome() {
  document.getElementById('navUsername') && (document.getElementById('navUsername').textContent = currentUser.username);
  if (currentUser.is_admin) {
    const el = document.getElementById('adminNavBtn');
    if (el) el.style.display = '';
  }
  const [res, doodleRes] = await Promise.all([
    api('GET', '/api/sessions'),
    api('GET', '/api/doodles').catch(() => ({ doodles: [] }))
  ]);

  // Afficher/cacher le bouton créer séance
  const nsBtn = document.getElementById('newSessionBtn');
  if (nsBtn) nsBtn.style.display = canDoAction('session_create') ? '' : 'none';

  // Bannière doodles en attente de réponse (uniquement pour ceux qui n'ont pas voté)
  const doodleBanner = document.getElementById('doodleBanner');
  if (doodleBanner) {
    const pending = (doodleRes.doodles || []).filter(d => !d.closed && !d.has_voted);
    if (pending.length) {
      doodleBanner.innerHTML = `
        <div class="doodle-banner">
          <span class="doodle-banner-icon">📅</span>
          <div class="doodle-banner-content">
            <div class="doodle-banner-title">Doodle${pending.length > 1 ? 's' : ''} en attente de ta réponse</div>
            <div class="doodle-banner-list">
              ${pending.map(d => `<button class="doodle-banner-btn" onclick="showPage('page-doodle');openDoodle('${d.token}')">${esc(d.title)}</button>`).join('')}
            </div>
          </div>
        </div>`;
      doodleBanner.style.display = 'block';
    } else {
      doodleBanner.style.display = 'none';
    }
  }

  const grid = document.getElementById('sessionsGrid');
  grid.innerHTML = '';
  if (!res.sessions?.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-icon">🗓</span><div class="empty-label">Aucune séance active</div></div>';
  } else {
    res.sessions.forEach(s => grid.appendChild(makeSessionCard(s, false)));
  }

  const archGrid = document.getElementById('archivedGrid');
  if (archGrid) {
    archGrid.innerHTML = '';
    if (!res.archived?.length) {
      archGrid.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic">Aucune session archivée</div>';
    } else {
      // Grouper par année
      const byYear = {};
      const currentYear = new Date().getFullYear().toString();
      res.archived.forEach(s => {
        const year = s.date ? s.date.slice(0,4) : 'Autre';
        if (!byYear[year]) byYear[year] = [];
        byYear[year].push(s);
      });
      const years = Object.keys(byYear).sort((a,b) => b-a);
      years.forEach(year => {
        const isCurrentYear = year === currentYear;
        const yearDiv = document.createElement('div');
        yearDiv.className = 'arch-year-group';
        yearDiv.innerHTML = `
          <div class="arch-year-header" onclick="toggleYearGroup(this)">
            <span class="arch-year-chevron">${isCurrentYear ? '▾' : '▸'}</span>
            <span class="arch-year-label">${year}</span>
            <span class="arch-year-count">${byYear[year].length} séance${byYear[year].length>1?'s':''}</span>
          </div>
          <div class="arch-year-sessions" style="${isCurrentYear ? '' : 'display:none'}"></div>
        `;
        const sessionsDiv = yearDiv.querySelector('.arch-year-sessions');
        const grid = document.createElement('div');
        grid.className = 'sessions-grid';
        byYear[year].forEach(s => grid.appendChild(makeSessionCard(s, true)));
        sessionsDiv.appendChild(grid);
        archGrid.appendChild(yearDiv);
      });
    }
  }
}

function toggleYearGroup(header) {
  const sessions = header.nextElementSibling;
  const chevron = header.querySelector('.arch-year-chevron');
  const hidden = sessions.style.display === 'none';
  sessions.style.display = hidden ? 'block' : 'none';
  chevron.textContent = hidden ? '▾' : '▸';
}

function makeSessionCard(s, isArchived) {
  const card = document.createElement('div');
  card.className = 'session-card' + (isArchived ? ' session-card-archived' : '');
  card.innerHTML = `
    <div class="session-card-title">${esc(s.name)}</div>
    <div class="session-card-date">📅 ${formatDate(s.date)}</div>
    <div class="session-card-meta">
      ${isArchived
        ? '<span class="sc-badge">📚 Archivée</span>'
        : `<span class="sc-badge ${s.is_open ? 'open' : ''}">${s.is_open ? '🟢 Ouvert' : '⛔ Fermé'}</span>`}
      ${s.is_private ? '<span class="sc-badge sc-badge-private">🔒 Privée</span>' : ''}
      ${s.is_convention ? '<span class="sc-badge" style="background:rgba(130,80,200,.15);color:#8250d8">🎪 Convention</span>' : ''}
      <span class="sc-badge">👥 ${s.participant_count} participant${s.participant_count !== 1 ? 's' : ''}</span>
      <span class="sc-badge">par ${esc(s.created_by_name)}</span>
    </div>
    ${s.new_proposals?.length ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(224,112,48,.12);border:1px solid #e07030;border-radius:6px;font-size:.72rem;color:#e07030">
      ⚠ ${(() => {
        const byUser = {};
        s.new_proposals.forEach(p => { if (!byUser[p.added_by]) byUser[p.added_by] = 0; byUser[p.added_by]++; });
        return Object.entries(byUser).map(([u, n]) => `<strong>${esc(u)}</strong> a ajouté ${n} jeu${n>1?'x':''}`).join(', ');
      })()} depuis ton dernier vote — pense à mettre à jour tes votes !
    </div>` : ''}
    ${s.vote_status?.type === 'none' ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(74,111,165,.12);border:1px solid var(--accent);border-radius:6px;font-size:.72rem;color:var(--accent)">
      🗳 Tu n'as pas encore voté dans cette séance
    </div>` : ''}
    ${s.vote_status?.type === 'incomplete' ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(74,111,165,.12);border:1px solid var(--accent);border-radius:6px;font-size:.72rem;color:var(--accent)">
      🗳 Vote incomplet — catégorie${s.vote_status.missing.length > 1 ? 's' : ''} manquante${s.vote_status.missing.length > 1 ? 's' : ''} : <strong>${s.vote_status.missing.map(n => esc(n)).join(', ')}</strong>
    </div>` : ''}
  `;
  card.onclick = (e) => {
    if (e.target.closest('button')) return;
    loadSession(s.id, isArchived);
  };
  return card;
}

function toggleArchivedSessions() {
  const div = document.getElementById('archivedSessionsDiv');
  const icon = document.getElementById('archivedToggleIcon');
  const hidden = div.style.display === 'none';
  div.style.display = hidden ? 'block' : 'none';
  icon.textContent = hidden ? '▾' : '▸';
}

async function openNewSession() {
  document.getElementById('nsDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('nsPrivate').checked = false;
  const noJoin = document.getElementById('nsNoJoin'); if (noJoin) noJoin.checked = false;
  document.getElementById('nsMembersWrap').style.display = 'none';
  const privSection = document.getElementById('nsPrivateSection');
  if (privSection) privSection.style.display = currentUser?.is_admin ? 'block' : 'none';
  openModal('newSessionModal');
  if (currentUser?.is_admin) {
    const usersRes = await api('GET', '/api/users');
    const users = usersRes.users || usersRes;
    const container = document.getElementById('nsMembers');
    if (container) container.innerHTML = users.filter(u => u.id !== currentUser.id).map(u =>
      `<label class="priv-member-item"><input type="checkbox" value="${u.id}" class="priv-member-cb"> ${esc(u.username)}</label>`
    ).join('');
  }
}

async function createSession() {
  const name = document.getElementById('nsName').value.trim();
  const date = document.getElementById('nsDate').value;
  if (!name || !date) { showToast('Nom et date requis'); return; }
  const isPrivate = document.getElementById('nsPrivate')?.checked || false;
  const memberIds = isPrivate
    ? [...document.querySelectorAll('.priv-member-cb:checked')].map(cb => parseInt(cb.value))
    : [];
  const noJoin = document.getElementById('nsNoJoin')?.checked || false;
  const isConvention = document.getElementById('nsConvention')?.checked || false;
  const res = await api('POST', '/api/sessions', { name, date, is_private: isPrivate, member_ids: memberIds, no_join: noJoin, is_convention: isConvention });
  if (res.error) { showToast(res.error); return; }
  closeModal('newSessionModal');
  document.getElementById('nsName').value = '';
  await loadHome(); // rafraîchir la liste des séances sur l'accueil
  await loadSession(res.sessionId);
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// session.js — Chargement et gestion d'une séance
//
// Contient :
//   - loadSession(id)       Charge une séance, affiche ses onglets et données
//   - reloadSession()       Recharge la séance courante (après une action)
//   - renderParticipants()  Affiche les chips des participants
//   - archiveSession()      Archive ou désarchive une séance
//   - toggleVotesLock()     Verrouille/déverrouille les votes
//   - deleteSession()       Supprime une séance après confirmation
//   - simulateVotes()       (admin) Génère des votes aléatoires pour tester
// ─────────────────────────────────────────────────────────────

// SESSION
// ═══════════════════════════════════════════════════
async function loadSession(id, openArchiveTab) {
  const res = await api('GET', `/api/sessions/${id}`);
  if (res.error) { showToast(res.error); return; }
  currentSession = res;
  const sessTitle = document.getElementById('sessTitle');
  if (sessTitle) sessTitle.innerHTML = res.session.name
    + (res.session.is_private ? ' <span class="sess-private-badge" title="Séance privée">🔒</span>' : '');
  const sessDate = document.getElementById('sessDate');
  if (sessDate) sessDate.textContent = '📅 ' + formatDate(res.session.date);
  const sessCreator = document.getElementById('sessCreator');
  if (sessCreator) sessCreator.textContent = 'par ' + res.session.created_by_name;
  const sessStatus = document.getElementById('sessStatus');
  if (sessStatus) sessStatus.innerHTML = res.session.is_open
    ? '<span style="color:var(--green-text)">🟢 Ouvert</span>'
    : '<span style="color:var(--text-muted)">⛔ Fermé</span>';

  // Barre de gestion (créateur ou admin)
  const canManage = res.session.created_by === currentUser.id || currentUser.is_admin;
  const mgmt = document.getElementById('sessMgmt');
  const sessOwnerId = res.session.created_by;
  const canEditSess = canDoAction('session_edit', sessOwnerId);
  const canDelSess = canDoAction('session_delete', sessOwnerId);
  const canLockVotes = canDoAction('vote_lock', sessOwnerId);
  const canGenProg = canDoAction('programme_generate', sessOwnerId);
  const canPubProg = canDoAction('programme_publish', sessOwnerId);

  if (canManage || canEditSess || canDelSess) {
    mgmt.style.display = 'flex';
    mgmt.innerHTML = `
      <span class="session-mgmt-label">Gérer :</span>
      ${canEditSess ? `<button class="btn-sm ghost" onclick="openEditSession()">✏️ Renommer</button>` : ''}
      ${canEditSess ? (res.session.is_open
        ? `<button class="btn-sm warning" onclick="toggleSession(false)">🔒 Fermer la séance</button>`
        : `<button class="btn-sm accent"  onclick="toggleSession(true)">🟢 Rouvrir la séance</button>`) : ''}
      ${canEditSess ? (res.session.is_archived
        ? `<button class="btn-sm ghost" onclick="archiveSession(false)">↩ Désarchiver</button>`
        : `<button class="btn-sm ghost" onclick="archiveSession(true)">📚 Archiver</button>`) : ''}
      ${canEditSess && res.session.is_private ? `<button class="btn-sm ghost" onclick="openPrivateMembersModal()">👥 Membres privés</button>` : ''}
      ${canLockVotes ? (res.session.votes_locked
        ? `<button class="btn-sm accent" onclick="toggleVotesLock(false)">🗳 Rouvrir les votes</button>`
        : `<button class="btn-sm warning" onclick="toggleVotesLock(true)">🔒 Verrouiller les votes</button>`) : ''}
      ${canDelSess ? `<button class="btn-sm danger" onclick="deleteSession()">🗑 Supprimer</button>` : ''}
      ${currentUser.is_admin && isSimVotesEnabled() ? `<button class="btn-sm ghost" onclick="simulateVotes()" title="Créer Claudia, Claudine, Claudette et Claude François et leur faire voter aléatoirement">🤖 Simuler votes</button>
      <button class="btn-sm ghost" style="color:var(--red-text)" onclick="deleteTestAccounts()" title="Supprimer les comptes test et leurs votes">🗑 Comptes test</button>` : ''}
      ${currentUser.is_admin ? `<button class="btn-sm ghost bgg-feature" onclick="enrichSessionProposals()" title="Récupérer notes et weights BGG pour les jeux proposés">⭐ Enrichir BGG</button>` : ''}
    `;
  } else {
    mgmt.style.display = 'none';
  }

  // Charger toutes les collections des participants avant de rendre
  userCollections = {};
  progLoaded = false;
  const collPromises = res.participants
    .filter(p => p.bgg_username)
    .map(p => api('GET', `/api/bgg/collection/${p.id}`).then(r => {
      if (r.games) userCollections[p.id] = r.games;
    }).catch(() => {}));
  await Promise.all(collPromises);

  renderParticipants();
  renderLocationBox();

  // Connecter SSE à cette séance pour les mises à jour en temps réel
  if (typeof initSSE === 'function') initSSE(res.session.id);

  // Afficher/cacher les onglets selon le mode
  const isConvention = res.session.is_convention;
  const isOrganizer = currentUser.is_admin || res.session.created_by === currentUser.id;
  const convTab = document.getElementById('tab-convention');
  const resvTab = document.getElementById('tab-reservations');
  const proposeTab = document.getElementById('tab-propose');
  const voteTab = document.getElementById('tab-vote');
  const resultsTab = document.getElementById('tab-results');
  const progTab2 = document.querySelector('.tab[onclick*="programme"]');
  if (convTab) convTab.style.display = isConvention && isOrganizer ? '' : 'none';
  if (resvTab) resvTab.style.display = isConvention ? '' : 'none';
  if (proposeTab) proposeTab.style.display = isConvention ? 'none' : '';
  if (voteTab) voteTab.style.display = isConvention ? 'none' : '';
  if (resultsTab) resultsTab.style.display = isConvention ? 'none' : '';
  if (progTab2 && isConvention) progTab2.style.display = isOrganizer ? '' : 'none';

  // Choisir l'onglet par défaut selon l'état des votes
  const showProgramme = res.session.votes_locked && res.session.programme_validated;
  document.querySelectorAll('.tab').forEach((t,i) => { t.classList.toggle('active', i===0); });
  document.querySelectorAll('.panel').forEach((p,i) => { p.classList.toggle('active', i===0); });
  if (isConvention) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    if (isOrganizer) {
      if (convTab) convTab.classList.add('active');
      const convPanel = document.getElementById('panel-convention');
      if (convPanel) { convPanel.classList.add('active'); renderConventionPanel(); }
    } else {
      if (resvTab) resvTab.classList.add('active');
      const resvPanel = document.getElementById('panel-reservations');
      if (resvPanel) { resvPanel.classList.add('active'); renderReservationsPanel(); }
    }
  } else if (showProgramme) {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');
    const progTab = [...tabs].find(t => t.getAttribute('onclick')?.includes('programme'));
    const progPanel = document.getElementById('panel-programme');
    if (progTab && progPanel) {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      progTab.classList.add('active');
      progPanel.classList.add('active');
      renderProgrammePanel();
    } else {
      renderProposePanel();
    }
  } else {
    renderProposePanel();
  }
  showPage('page-session');
  if (openArchiveTab || res.session.is_archived) {
    // Ouvrir onglet archive
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    const archTab = [...tabs].find(t => t.textContent.includes('Archive'));
    const archPanel = document.getElementById('panel-archive');
    if (archTab) archTab.classList.add('active');
    if (archPanel) { archPanel.classList.add('active'); renderArchivePanel(); }
  }
}

async function reloadSession() {
  if (!currentSession) return;
  // Mémoriser l'onglet actif
  const activeTab = document.querySelector('.tab.active');
  const activeTabText = activeTab?.textContent?.trim();
  await loadSession(currentSession.session.id);
  // Restaurer l'onglet actif si ce n'est pas le tab par défaut
  if (activeTabText && !activeTabText.includes('Proposer')) {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');
    const targetTab = [...tabs].find(t => t.textContent.trim() === activeTabText);
    if (targetTab) {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      targetTab.classList.add('active');
      // Trouver le panel correspondant
      const tabIndex = [...tabs].indexOf(targetTab);
      const targetPanel = panels[tabIndex];
      if (targetPanel) {
        targetPanel.classList.add('active');
        // Déclencher le rendu du bon panel
        const tabName = targetTab.getAttribute('onclick')?.match(/switchTab\('(\w+)'/)?.[1];
        if (tabName === 'vote') renderVotePanel();
        else if (tabName === 'results') renderResultsPanel();
        else if (tabName === 'programme') renderProgrammePanel();
        else if (tabName === 'convention') renderConventionPanel();
        else if (tabName === 'archive') renderArchivePanel();
      }
    }
  }
}

async function archiveSession(archive) {
  const label = archive ? 'archiver' : 'désarchiver';
  if (!confirm(`Voulez-vous ${label} cette séance ?`)) return;
  await api('PATCH', `/api/sessions/${currentSession.session.id}/archive`, { is_archived: archive });
  showToast(archive ? '📚 Séance archivée' : '↩ Séance désarchivée');
  await reloadSession();
  if (!archive) loadHome();
}

async function toggleVotesLock(lock) {
  const label = lock ? 'verrouiller' : 'rouvrir';
  if (!confirm(`Voulez-vous ${label} les votes de cette séance ?`)) return;
  await api('PATCH', `/api/sessions/${currentSession.session.id}`, { votes_locked: lock });
  await reloadSession();
}

async function toggleSession(open) {
  const label = open ? 'rouvrir' : 'fermer';
  if (!confirm(`Voulez-vous ${label} cette séance ?`)) return;
  const res = await api('PATCH', `/api/sessions/${currentSession.session.id}`, { is_open: open });
  if (res.error) { showToast(res.error); return; }
  showToast(open ? '🟢 Séance rouverte' : '🔒 Séance fermée');
  await reloadSession();
}

async function simulateVotes() {
  if (!confirm('Créer Claudia, Claudine, Claudette et Claude François et leur faire voter aléatoirement ?')) return;
  const res = await api('POST', `/api/sessions/${currentSession.session.id}/simulate-votes`);
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  showToast(`✅ Votes simulés pour : ${res.created.join(', ')}`);
  await reloadSession();
  renderVotePanel && renderVotePanel();
}

async function deleteTestAccounts() {
  if (!confirm('Supprimer les comptes test (Claudia, Claudine, Claudette, Claude François) et leurs votes pour cette séance ?')) return;
  const res = await api('DELETE', `/api/sessions/${currentSession.session.id}/simulate-votes`);
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  showToast('🗑 Comptes test supprimés');
  await reloadSession();
  renderVotePanel && renderVotePanel();
}

async function deleteSession() {
  if (!confirm(`Supprimer définitivement "${currentSession.session.name}" ?\n\nToutes les propositions et tous les votes seront perdus.`)) return;
  const res = await api('DELETE', `/api/sessions/${currentSession.session.id}`);
  if (res.error) { showToast(res.error); return; }
  showToast('Séance supprimée');
  await loadHome();
}

function renderParticipants() {
  const row = document.getElementById('sessParticipants');
  const isParticipant = currentSession.participants.some(p => p.id === currentUser.id);
  const isCreator = currentSession.session.created_by === currentUser.id;
  const canKick = currentUser.is_admin || isCreator;
  row.innerHTML = '';

  currentSession.participants.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'participant-chip' + (p.id === currentUser.id ? ' me' : '');
    chip.style.position = 'relative';

    const name = document.createElement('span');
    name.textContent = (p.id === currentUser.id ? '👤 ' : '') + p.username;
    if (p.bgg_username) chip.title = 'BGG: ' + p.bgg_username;
    chip.appendChild(name);

    // Bouton retirer (admin/créateur, pas sur soi-même)
    if (canKick && p.id !== currentUser.id) {
      const x = document.createElement('span');
      x.textContent = '×';
      x.title = `Retirer ${p.username}`;
      x.style.cssText = 'cursor:pointer;margin-left:4px;color:var(--text-muted);font-size:1rem;line-height:1;opacity:.6';
      x.onmouseover = () => x.style.opacity = '1';
      x.onmouseout = () => x.style.opacity = '.6';
      x.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Retirer ${p.username} de la séance ?`)) return;
        const res = await api('DELETE', `/api/sessions/${currentSession.session.id}/participants/${p.id}`);
        if (res.ok) { await reloadSession(); }
        else showToast(res.error || 'Erreur');
      };
      chip.appendChild(x);
    }

    row.appendChild(chip);
  });

  if (!isParticipant) {
    const btn = document.createElement('button');
    btn.className = 'join-btn';
    btn.textContent = '+ Rejoindre la séance';
    btn.onclick = async () => {
      await api('POST', `/api/sessions/${currentSession.session.id}/join`);
      await reloadSession();
    };
    row.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.className = 'leave-btn';
    btn.textContent = '↩ Quitter la séance';
    btn.onclick = async () => {
      const myProposals = currentSession.proposals.filter(p => p.proposed_by === currentUser.id);
      const msg = myProposals.length
        ? `Quitter la séance ? Vos ${myProposals.length} proposition${myProposals.length > 1 ? 's' : ''} et vote${myProposals.length > 1 ? 's' : ''} seront supprimés.`
        : 'Quitter la séance ?';
      if (!confirm(msg)) return;
      await api('DELETE', `/api/sessions/${currentSession.session.id}/leave`);
      await reloadSession();
      showToast('Vous avez quitté la séance');
    };
    row.appendChild(btn);
  }
}

// ═══════════════════════════════════════════════════

// ── LOCATION BOX ────────────────────────────────────────────
let _mapsLoaded = false;
let _mapsLoading = false;
let _mapsCallbacks = [];

function loadGoogleMaps(apiKey) {
  return new Promise((resolve) => {
    if (_mapsLoaded) return resolve();
    _mapsCallbacks.push(resolve);
    if (_mapsLoading) return;
    _mapsLoading = true;
    window._gmapsReady = () => {
      _mapsLoaded = true;
      _mapsCallbacks.forEach(cb => cb());
      _mapsCallbacks = [];
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=_gmapsReady`;
    s.async = true;
    document.head.appendChild(s);
  });
}

async function renderLocationBox() {
  const box = document.getElementById('sessLocationBox');
  if (!box) return;
  _acInitialized = false;

  const sess = currentSession.session;
  const canEdit = sess.created_by === currentUser.id || currentUser.is_admin;
  const isParticipant = currentSession.participants.some(p => p.id === currentUser.id);
  const location = sess.location || '';

  // Charger la clé Maps en premier
  const settingsRes = await api('GET', '/api/settings');
  const mapsKey = settingsRes.settings?.google_maps_key || '';

  const mapUrl = location && mapsKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(location)}&zoom=15&size=600x200&scale=2&markers=color:red|${encodeURIComponent(location)}&key=${mapsKey}`
    : '';

  box.innerHTML = `
    <div id="sessLocWrapper" style="margin:6px 0">
      <div style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.78rem;color:var(--text-muted)" onclick="toggleLocationBox()">
        <span>📍</span>
        <span id="sessLocLabel">${location ? location : 'Lieu non défini'}</span>
        <span id="sessLocChevron" style="font-size:.6rem">${location ? '▾' : '▸'}</span>
      </div>
      <div id="sessLocPanel" style="display:${location ? 'block' : 'none'};margin-top:8px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        ${location ? `
          ${mapUrl ? `<a href="https://www.google.com/maps/search/${encodeURIComponent(location)}" target="_blank" rel="noopener" style="display:block;margin-bottom:8px;border-radius:8px;overflow:hidden;cursor:pointer">
            <img src="${mapUrl}" style="width:100%;height:140px;object-fit:cover;display:block;border-radius:8px" alt="Carte du lieu" onerror="this.style.display='none'">
          </a>` : ''}
          <div style="font-size:.82rem;margin-bottom:8px">📍 ${esc(location)}</div>
          ${canEdit ? `
            <div id="sessLocEditZone" style="display:none;margin-top:8px">
              <input id="sessLocInput" class="form-input" placeholder="Rechercher une adresse…" style="font-size:.8rem" value="${esc(location)}">
              <div style="display:flex;gap:6px;margin-top:6px">
                <button class="btn-sm accent" onclick="saveLocation()">💾 Enregistrer</button>
                <button class="btn-sm ghost" style="color:var(--red-text)" onclick="saveLocation('')">✕ Supprimer</button>
              </div>
            </div>
            <button class="btn-sm ghost" style="font-size:.72rem;margin-top:4px" onclick="showLocEditZone()">✏️ Modifier le lieu</button>
            <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:.75rem;cursor:pointer">
              <input type="checkbox" ${sess.show_location_public !== 0 ? 'checked' : ''} onchange="saveLocationVisibility(this.checked)">
              Afficher sur la page publique
            </label>
          ` : ''}
        ` : `
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">Aucun lieu défini</div>
          ${canEdit ? `
            <input id="sessLocInput" class="form-input" placeholder="Rechercher une adresse…" style="font-size:.8rem" value="">
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn-sm accent" onclick="saveLocation()">💾 Enregistrer</button>
            </div>
          ` : ''}
        `}
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">💬 Notes pratiques</div>
          <div id="notesList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
            ${(currentSession.notes || []).length ? (currentSession.notes || []).map(n => `
              <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 10px;font-size:.8rem">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                  <div>
                    <span style="font-weight:600;color:var(--accent)">${esc(n.username)}</span>
                    <span style="color:var(--text-muted);font-size:.7rem;margin-left:6px">${new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                    <div style="margin-top:3px">${esc(n.content)}</div>
                  </div>
                  ${n.user_id === currentUser.id || currentUser.is_admin ? `<button onclick="deleteNote(${n.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);flex-shrink:0;padding:0" title="Supprimer">✕</button>` : ''}
                </div>
              </div>
            `).join('') : '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic">Aucune note pour l\'instant</div>'}
          </div>
          ${isParticipant ? `
            <div style="display:flex;gap:6px">
              <input id="noteInput" class="form-input" placeholder="Parking, accès, code d'entrée…" style="font-size:.8rem;flex:1" onkeydown="if(event.key==='Enter')addNote()">
              <button class="btn-sm accent" onclick="addNote()">↵</button>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Lazy-load Google Maps si admin et clé dispo
  if (canEdit && mapsKey) {
    await loadGoogleMaps(mapsKey);
    // Si pas de lieu, l'input est visible directement — init autocomplete immédiatement
    if (!location) {
      initLocAutocomplete();
    }
  }
}

let _acInitialized = false;

function initLocAutocomplete() {
  if (_acInitialized || !window.google?.maps?.places) return;
  const input = document.getElementById('sessLocInput');
  if (!input) return;
  _acInitialized = true;
  const ac = new google.maps.places.Autocomplete(input, { types: ['establishment', 'geocode'] });
  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (place.formatted_address) input.value = place.formatted_address;
    else if (place.name) input.value = place.name;
  });
}

function showLocEditZone() {
  const zone = document.getElementById('sessLocEditZone');
  if (!zone) return;
  const isHidden = zone.style.display === 'none';
  zone.style.display = isHidden ? 'block' : 'none';
  if (isHidden) initLocAutocomplete();
}

function toggleLocationBox() {
  const panel = document.getElementById('sessLocPanel');
  const chevron = document.getElementById('sessLocChevron');
  if (!panel) return;
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? 'block' : 'none';
  chevron.textContent = hidden ? '▾' : '▸';
}

async function saveLocationVisibility(visible) {
  await api('PATCH', `/api/sessions/${currentSession.session.id}`, { show_location_public: visible ? 1 : 0 });
  currentSession.session.show_location_public = visible ? 1 : 0;
}

async function saveLocation(val) {
  const location = val !== undefined ? val : (document.getElementById('sessLocInput')?.value.trim() || '');
  const res = await api('PATCH', `/api/sessions/${currentSession.session.id}`, { location });
  if (res.error) { showToast(res.error); return; }
  currentSession.session.location = location;
  showToast(location ? '📍 Lieu enregistré' : 'Lieu supprimé');
  renderLocationBox();
}

// ── NOTES PRATIQUES ─────────────────────────────────────────
async function renderNotesBox() {
  const box = document.getElementById('sessNotesBox');
  if (!box) return;

  const notes = currentSession.notes || [];
  const isParticipant = currentSession.participants.some(p => p.id === currentUser.id);

  box.innerHTML = `
    <div style="margin:8px 0">
      <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">💬 Notes pratiques</div>
      <div id="notesList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
        ${notes.length ? notes.map(n => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font-size:.8rem">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div>
                <span style="font-weight:600;color:var(--accent)">${esc(n.username)}</span>
                <span style="color:var(--text-muted);font-size:.7rem;margin-left:6px">${new Date(n.created_at).toLocaleDateString('fr-FR', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                <div style="margin-top:3px">${esc(n.content)}</div>
              </div>
              ${n.user_id === currentUser.id || currentUser.is_admin ? `
                <button onclick="deleteNote(${n.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:.8rem;flex-shrink:0;padding:0" title="Supprimer">✕</button>
              ` : ''}
            </div>
          </div>
        `).join('') : '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic">Aucune note — soyez le premier à partager une info pratique !</div>'}
      </div>
      ${isParticipant ? `
        <div style="display:flex;gap:6px">
          <input id="noteInput" class="form-input" placeholder="Parking, accès, code d'entrée…" style="font-size:.8rem;flex:1" onkeydown="if(event.key==='Enter')addNote()">
          <button class="btn-sm accent" onclick="addNote()">Envoyer</button>
        </div>
      ` : ''}
    </div>
  `;
}

async function addNote() {
  const input = document.getElementById('noteInput');
  const content = input?.value.trim();
  if (!content) return;
  const res = await api('POST', `/api/sessions/${currentSession.session.id}/notes`, { content });
  if (res.error) { showToast(res.error); return; }
  input.value = '';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/notes`);
  if (r.notes) { currentSession.notes = r.notes; renderLocationBox(); }
}

async function deleteNote(noteId) {
  const res = await api('DELETE', `/api/sessions/${currentSession.session.id}/notes/${noteId}`);
  if (res.error) { showToast(res.error); return; }
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/notes`);
  if (r.notes) { currentSession.notes = r.notes; renderLocationBox(); }
}
// ─────────────────────────────────────────────────────────────
// proposals.js — Panel "Proposer" : collection BGG et ajout manuel
//
// Contient :
//   - renderProposePanel()      Construit le panel avec toutes les catégories
//   - makeProposeCol(cat)       Construit une colonne catégorie avec son browser BGG
//   - renderCollBrowser()       Affiche la collection BGG d'un joueur avec filtres
//   - toggleColl() / toggleManual()  Ouvre/ferme les sections BGG et formulaire manuel
//   - searchBGG(catId)          Recherche un jeu sur BGG par nom
//   - proposeFromCollection()   Propose un jeu depuis la collection BGG
//   - addManual(catId)          Propose un jeu via le formulaire manuel
//   - openEditProposal(id)      Ouvre le modal d'édition d'une proposition
//   - saveEditProposal()        Sauvegarde les modifications d'une proposition
//   - deleteProposal(id)        Supprime une proposition
// ─────────────────────────────────────────────────────────────

// PROPOSE PANEL
// ═══════════════════════════════════════════════════
function renderProposePanel() {
  const el = document.getElementById('panel-propose');
  const canManage = currentSession.session.created_by === currentUser.id || currentUser.is_admin;
  el.innerHTML = '<div class="cats-grid" id="catsGrid"></div>'
    + (canManage ? '<div style="margin-top:12px;text-align:center"><button class="btn-sm ghost" onclick="openAddCat()">＋ Ajouter une catégorie</button></div>' : '');
  const grid = document.getElementById('catsGrid');
  currentSession.categories.forEach(cat => grid.appendChild(makeProposeCol(cat)));
}

function makeProposeCol(cat) {
  const proposals = currentSession.proposals.filter(p => p.category_id === cat.id);
  const isCreator = currentSession.session.created_by === currentUser.id;
  const col = document.createElement('div');
  col.className = 'cat-col';

  col.innerHTML = `
    <div class="cat-col-header">
      <div>
        <div class="cat-col-title">${cat.icon} ${esc(cat.name)}</div>
        <div class="cat-col-sub">${esc(cat.subtitle || '')} · ${proposals.length} jeu${proposals.length !== 1 ? 'x' : ''}</div>
      </div>
      ${isCreator || currentUser.is_admin ? `
        <div style="display:flex;gap:4px">
          <button class="btn-sm ghost" onclick="openEditCat(${cat.id},'${esc(cat.name)}','${cat.icon}','${esc(cat.subtitle||'')}')">✏️</button>
          <button class="btn-sm ghost" style="color:#e07070;font-weight:700" onclick="deleteCat(${cat.id},this)" title="Supprimer">✕</button>
        </div>` : ''}
    </div>
    <div class="cat-col-body">
      ${canDoAction('proposal_add') ? `
      <span class="manual-toggle bgg-feature" onclick="toggleColl(${cat.id})"><span id="ca_${cat.id}">▸</span> Collections BGG</span>
      <div id="collBrowser_${cat.id}" style="display:none"></div>
      <span class="manual-toggle" onclick="toggleManual(${cat.id})"><span id="ma_${cat.id}">▸</span> Ajout manuel</span>
      <div class="manual-form" id="mf_${cat.id}">
        <div class="mf-bgg-row">
          <input type="text" class="form-input" id="mfurl_${cat.id}" placeholder="URL BGG (optionnel) — ex: boardgamegeek.com/boardgame/174430" oninput="onBGGUrlInput(${cat.id})">
          <button class="bgg-fetch-btn" id="mffetch_${cat.id}" onclick="fetchFromBGGUrl(${cat.id})" title="Charger depuis BGG">↓</button>
        </div>
        <div class="mf-fetch-status" id="mfstatus_${cat.id}"></div>
        <div class="mf-preview" id="mfpreview_${cat.id}"></div>
        <div class="mf-row">
          <input type="text" class="form-input" id="mfn_${cat.id}" placeholder="Nom du jeu *">
          <input type="text" class="form-input" id="mfy_${cat.id}" placeholder="Année" style="max-width:75px">
        </div>
        <div class="mf-row">
          <input type="text" class="form-input" id="mfp_${cat.id}" placeholder="Joueurs (ex: 2-6)">
          <input type="text" class="form-input" id="mft_${cat.id}" placeholder="Durée (min)" style="max-width:95px">
        </div>
        <div class="mf-row">
          <input type="text" class="form-input" id="mfmyludo_${cat.id}" placeholder="URL MyLudo (optionnel) — ex: myludo.fr/#!/game/nom-12345">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-sm accent" id="mfadd_${cat.id}" onclick="addManual(${cat.id})">+ Ajouter</button>
          <span style="font-size:.62rem;color:var(--text-muted)" id="mfthumb_${cat.id}"></span>
        </div>
      </div>` : ''}
      <div class="proposals-list" id="propsList_${cat.id}"></div>
    </div>
  `;

  // Render collection browser
  renderCollBrowser(cat.id, col);

  // Render proposals
  const list = col.querySelector(`#propsList_${cat.id}`);
  if (!proposals.length) {
    list.innerHTML = '<div class="empty" style="padding:20px"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu proposé</div></div>';
  } else {
    proposals.forEach(p => list.appendChild(makePropItem(p)));
  }
  return col;
}

function renderCollBrowser(catId, colEl) {
  const container = (colEl || document).querySelector(`#collBrowser_${catId}`);
  if (!container) return;

  // Build user tabs — only participants with a collection or the current user
  const participants = currentSession.participants;
  const usersWithColl = participants.filter(p => p.bgg_username);

  if (!usersWithColl.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:14px 0">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:8px">Aucune collection BGG chargée</div>
        <button class="btn-sm ghost" onclick="showPage('page-profile')">Configurer mon BGG</button>
      </div>`;
    return;
  }

  if (activeCollectionUserId !== -1 && (!activeCollectionUserId || !usersWithColl.find(u => u.id === activeCollectionUserId))) {
    activeCollectionUserId = usersWithColl[0]?.id || -1;
  }

  const proposed = currentSession.proposals.filter(p => p.category_id === catId);
  const proposedBggIds = new Set(proposed.map(p => p.bgg_id).filter(Boolean));
  const games = userCollections[activeCollectionUserId] || [];
  const filterVal = (document.getElementById(`cf_${catId}`)?.value || '').toLowerCase();
  const filtered = games.filter(g => !filterVal || g.name.toLowerCase().includes(filterVal));

  // activeCollectionUserId = -1 = mode recherche BGG
  const isBGGMode = activeCollectionUserId === -1;

  const tabsHtml = usersWithColl.map(u => `
    <button class="ctab ${u.id === activeCollectionUserId ? 'active' : ''}"
      onclick="setActiveCollection(${u.id},${catId})">${esc(u.username)}</button>
  `).join('') + `<button class="ctab ${isBGGMode ? 'active' : ''}" onclick="setActiveCollection(-1,${catId})">🔍 BGG</button>`;

  if (isBGGMode) {
    container.innerHTML = `
      <div class="section-label" style="margin-bottom:8px">Collections des joueurs</div>
      <div class="collection-tabs">${tabsHtml}</div>
      <div class="bgg-search-row">
        <input type="text" class="collection-filter" id="bggs_${catId}" placeholder="Rechercher sur BoardGameGeek…" onkeydown="if(event.key==='Enter')searchBGG(${catId})">
        <button class="bgg-search-btn" id="bggsbtn_${catId}" onclick="searchBGG(${catId})">Chercher</button>
      </div>
      <div class="bgg-status" id="bggstatus_${catId}"></div>
      <div class="collection-list" id="cl_${catId}"></div>
    `;
    return;
  }

  // Récupérer les valeurs des filtres existants si déjà affichés
  const prevPlayers = document.getElementById(`cfp_${catId}`)?.value || '';
  const prevDuration = document.getElementById(`cfd_${catId}`)?.value || '240';
  const prevDurationMin = document.getElementById(`cfdmin_${catId}`)?.value || '0';

  container.innerHTML = `
    <div class="section-label" style="margin-bottom:8px">Collections des joueurs</div>
    <div class="collection-tabs">${tabsHtml}</div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <input type="text" class="collection-filter" id="cf_${catId}" placeholder="Filtrer (${games.length} jeux)…" oninput="filterColl(${catId})" value="${filterVal}" style="margin-bottom:0;flex:1">
      <button class="btn-sm ghost" onclick="toggleCollFilters(${catId})" id="cffbtn_${catId}" title="Filtres avancés" style="flex-shrink:0">⚙️</button>
    </div>
    <div id="cff_${catId}" class="coll-filters-panel" style="display:none">
      <div class="coll-filters-inner">
        <div class="coll-filter-group">
          <label class="coll-filter-label">👥 Joueurs</label>
          <select class="coll-filter-select" id="cfp_${catId}" onchange="filterColl(${catId})">
            <option value="">Tous</option>
            <option value="2" ${prevPlayers==='2'?'selected':''}>2</option>
            <option value="3" ${prevPlayers==='3'?'selected':''}>3</option>
            <option value="4" ${prevPlayers==='4'?'selected':''}>4</option>
            <option value="5" ${prevPlayers==='5'?'selected':''}>5</option>
            <option value="6" ${prevPlayers==='6'?'selected':''}>6+</option>
          </select>
        </div>
        <div class="coll-filter-group" style="flex:1;min-width:180px">
          <label class="coll-filter-label">⏱ Durée — <span id="cfdlabel_${catId}">${prevDurationMin||'0'} – ${prevDuration||'240'}+ min</span></label>
          <div class="dual-range-wrap" id="cfdwrap_${catId}">
            <div class="dual-range-track">
              <div class="dual-range-fill" id="cfdfill_${catId}"></div>
            </div>
            <input type="range" class="dual-range dual-range-min" id="cfdmin_${catId}"
              min="0" max="240" step="15" value="${prevDurationMin||0}"
              oninput="updateDualRange(${catId})">
            <input type="range" class="dual-range dual-range-max" id="cfd_${catId}"
              min="0" max="240" step="15" value="${prevDuration||240}"
              oninput="updateDualRange(${catId})">
          </div>
        </div>
        <button class="btn-sm ghost" onclick="resetCollFilters(${catId})" style="font-size:.68rem;align-self:flex-end">✕ Reset</button>
      </div>
    </div>
    <div class="collection-list" id="cl_${catId}"></div>
  `;

  const list = container.querySelector(`#cl_${catId}`);
  setTimeout(() => initDualRange(catId), 0);
  if (!filtered.length) {
    list.innerHTML = '<div style="font-size:.7rem;color:var(--text-muted);padding:6px">Aucun résultat</div>';
    return;
  }
  // Trouver le nom du propriétaire de la collection active
  const ownerUser = participants.find(u => u.id === activeCollectionUserId);
  const ownerName = ownerUser ? ownerUser.username : '';

  filtered.forEach(g => {
    const alreadyIn = proposedBggIds.has(g.bgg_id);
    const div = document.createElement('div');
    div.className = 'coll-item';
    div.style.flexWrap = 'wrap';
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`)
      : '';
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}–${g.max_time}min`)
      : '';
    const descId = `desc_${catId}_${g.bgg_id}`;
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info" style="flex:1;min-width:0">
        <div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div>
        <div class="coll-meta">${[players && `👥 ${players}`, time && `⏱ ${time}`, g.bgg_rating && `⭐ ${g.bgg_rating}`, g.bgg_weight && `⚖️ ${g.bgg_weight}`].filter(Boolean).join(' · ')}</div>
        ${ownerName ? `<div class="coll-owner">📚 ${esc(ownerName)}</div>` : ''}
        ${g.bgg_id ? `<button class="coll-desc-btn" onclick="toggleDescription('${descId}','${g.bgg_id}',this)">▶ Description</button>
        <div class="coll-desc-box" id="${descId}" style="display:none;width:100%"></div>` : ''}
      </div>
      ${alreadyIn
        ? `<span class="coll-added">✓ proposé</span>`
        : `<button class="coll-add" onclick='proposeFromCollection(${catId},${JSON.stringify(g).replace(/'/g,"&#39;")})'>+ Proposer</button>`}
    `;
    list.appendChild(div);
  });
}

const descCache = {}; // bggId -> description traduite

async function toggleDescription(descId, bggId, btn) {
  const box = document.getElementById(descId);
  if (!box) return;
  const isOpen = box.style.display !== 'none';
  if (isOpen) {
    box.style.display = 'none';
    btn.textContent = '▶ Description';
    return;
  }
  box.style.display = 'block';
  btn.textContent = '▼ Description';
  if (descCache[bggId]) {
    box.textContent = descCache[bggId];
    return;
  }
  box.textContent = '⏳ Chargement…';
  const res = await api('GET', `/api/bgg/description/${bggId}`);
  if (res.error) {
    box.textContent = '⚠ ' + res.error;
    return;
  }
  const desc = res.description || 'Aucune description disponible.';
  descCache[bggId] = desc;
  box.textContent = desc;
}

function setActiveCollection(userId, catId) {
  activeCollectionUserId = userId;
  if (userId === -1) { renderCollBrowser(catId); return; }
  if (!userCollections[userId]) {
    api('GET', `/api/bgg/collection/${userId}`).then(r => {
      if (r.games) { userCollections[userId] = r.games; renderCollBrowser(catId); }
    });
  } else {
    renderCollBrowser(catId);
  }
}

function updateDualRange(catId) {
  const minEl = document.getElementById(`cfdmin_${catId}`);
  const maxEl = document.getElementById(`cfd_${catId}`);
  const fill = document.getElementById(`cfdfill_${catId}`);
  const label = document.getElementById(`cfdlabel_${catId}`);
  if (!minEl || !maxEl) return;
  let minVal = parseInt(minEl.value);
  let maxVal = parseInt(maxEl.value);
  // Empêcher croisement
  if (minVal > maxVal - 15) { minVal = maxVal - 15; minEl.value = minVal; }
  const pct = v => (v / 240) * 100;
  if (fill) { fill.style.left = pct(minVal) + '%'; fill.style.width = (pct(maxVal) - pct(minVal)) + '%'; }
  const fmt = v => v === 0 ? '0' : v >= 60 ? (v % 60 === 0 ? `${v/60}h` : `${Math.floor(v/60)}h${v%60}`) : `${v}min`;
  if (label) label.textContent = `${fmt(minVal)} – ${maxVal >= 240 ? '∞' : fmt(maxVal)}`;
  filterColl(catId);
}

function initDualRange(catId) {
  updateDualRange(catId);
}

function toggleCollFilters(catId) {
  const panel = document.getElementById(`cff_${catId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function resetCollFilters(catId) {
  const p = document.getElementById(`cfp_${catId}`);
  const d = document.getElementById(`cfd_${catId}`);
  const t = document.getElementById(`cf_${catId}`);
  const dmin = document.getElementById(`cfdmin_${catId}`);
  if (p) p.value = '';
  if (d) { d.value = '240'; }
  if (dmin) { dmin.value = '0'; }
  updateDualRange(catId);
  if (t) t.value = '';
  filterColl(catId);
}

function filterColl(catId) {
  // Si la liste existe déjà, mettre à jour seulement les résultats sans recréer l'input
  const list = document.getElementById(`cl_${catId}`);
  if (list) {
    const filterVal = (document.getElementById(`cf_${catId}`)?.value || '').toLowerCase();
    const playersFilter = document.getElementById(`cfp_${catId}`)?.value || '';
    const durationFilter = parseInt(document.getElementById(`cfd_${catId}`)?.value || '240');
    const durationMinFilter = parseInt(document.getElementById(`cfdmin_${catId}`)?.value || '0');
    const games = userCollections[activeCollectionUserId] || [];
    const proposed = currentSession.proposals.filter(p => p.category_id === catId);
    const proposedBggIds = new Set(proposed.map(p => p.bgg_id).filter(Boolean));
    const filtered = games.filter(g => {
      if (filterVal && !g.name.toLowerCase().includes(filterVal)) return false;
      if (playersFilter) {
        const nb = parseInt(playersFilter);
        const min = parseInt(g.min_players) || 1;
        const max = parseInt(g.max_players) || 99;
        if (nb >= 6) { if (max < 6) return false; }
        else { if (min > nb || max < nb) return false; }
      }
      if (durationFilter < 240) {
        const maxTime = parseInt(g.max_time) || parseInt(g.min_time) || 0;
        if (maxTime > 0 && maxTime > durationFilter) return false;
      }
      if (durationMinFilter > 0) {
        const minTime = parseInt(g.min_time) || parseInt(g.max_time) || 0;
        if (minTime > 0 && minTime < durationMinFilter) return false;
      }
      return true;
    });
    if (!filtered.length) {
      list.innerHTML = '<div style="font-size:.7rem;color:var(--text-muted);padding:6px">Aucun résultat</div>';
      return;
    }
    list.innerHTML = filtered.map(g => `
      <div class="coll-item ${proposedBggIds.has(g.bgg_id) ? 'already-proposed' : ''}" onclick='proposeFromCollection(${catId},${JSON.stringify(g).replace(/'/g,"&#39;")})'>
        ${g.thumbnail ? `<img class="coll-thumb" src="${esc(g.thumbnail)}" onerror="this.style.display='none'">` : '<div class="coll-thumb-ph">🎲</div>'}
        <div class="coll-info">
          <div class="coll-name">${esc(g.name)}</div>
          ${g.year ? `<div class="coll-year">${g.year}</div>` : ''}
        </div>
        ${proposedBggIds.has(g.bgg_id) ? '<span class="coll-proposed-badge">✓</span>' : ''}
      </div>
    `).join('');
  } else {
    renderCollBrowser(catId);
  }
}

async function searchBGG(catId) {
  const input = document.getElementById(`bggs_${catId}`);
  const btn = document.getElementById(`bggsbtn_${catId}`);
  const status = document.getElementById(`bggstatus_${catId}`);
  const list = document.getElementById(`cl_${catId}`);
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  status.textContent = '⏳ Recherche en cours…';
  list.innerHTML = '';

  const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  btn.disabled = false;

  if (res.error) {
    status.textContent = '⚠ ' + res.error;
    return;
  }
  if (!res.games?.length) {
    status.textContent = 'Aucun résultat — essayez en anglais';
    return;
  }

  status.textContent = `${res.games.length} résultat(s) trouvé(s)`;

  const proposed = currentSession.proposals.filter(p => p.category_id === catId);
  const proposedBggIds = new Set(proposed.map(p => p.bgg_id).filter(Boolean));

  res.games.forEach(g => {
    const alreadyIn = proposedBggIds.has(g.bgg_id);
    const div = document.createElement('div');
    div.className = 'coll-item';
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`) : '';
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}–${g.max_time}min`) : '';
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info">
        <div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div>
        <div class="coll-meta">${[players && `👥 ${players}`, time && `⏱ ${time}`, g.bgg_rating && `⭐ ${g.bgg_rating}`, g.bgg_weight && `⚖️ ${g.bgg_weight}`].filter(Boolean).join(' · ')}</div>
      </div>
      ${alreadyIn
        ? `<span class="coll-added">✓ proposé</span>`
        : `<button class="coll-add" onclick='proposeFromCollection(${catId},${JSON.stringify(g).replace(/'/g,"&#39;")})'>+ Proposer</button>`}
    `;
    list.appendChild(div);
  });
}

async function proposeFromCollection(catId, g) {
  const players = g.min_players && g.max_players
    ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`) : '';
  const time = g.min_time && g.min_time !== '0'
    ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}–${g.max_time}min`) : '';
  const res = await api('POST', `/api/sessions/${currentSession.session.id}/proposals`, {
    categoryId: catId, bggId: g.bgg_id, name: g.name, year: g.year,
    thumbnail: g.thumbnail, minPlayers: g.min_players, maxPlayers: g.max_players,
    minTime: g.min_time, maxTime: g.max_time, bggRating: g.bgg_rating || null, bggWeight: g.bgg_weight || null,
    tutoUrl: g.tuto_url || ''
  });
  if (res.error) { showToast(res.error); return; }
  showToast(`"${g.name}" proposé !`);
  await reloadSession();
}

// Stocke temporairement les données récupérées depuis BGG par catégorie
const mfBGGData = {};

function onBGGUrlInput(catId) {
  const url = document.getElementById(`mfurl_${catId}`).value.trim();
  const status = document.getElementById(`mfstatus_${catId}`);
  if (!url) {
    document.getElementById(`mfpreview_${catId}`).classList.remove('visible');
    status.textContent = '';
    delete mfBGGData[catId];
    document.getElementById(`mfthumb_${catId}`).textContent = '';
    return;
  }
  // Extraire l'ID BGG depuis l'URL immédiatement (sans appel API)
  const match = url.match(/boardgame(?:expansion)?\/(\d+)/);
  if (match) {
    const bggId = match[1];
    if (!mfBGGData[catId]) mfBGGData[catId] = {};
    mfBGGData[catId].bgg_id = bggId;
    status.textContent = `✓ ID BGG extrait : ${bggId} — cliquez ↓ pour charger les détails (token requis)`;
  } else {
    status.textContent = '⚠ URL non reconnue — format : boardgamegeek.com/boardgame/XXXXX';
    delete mfBGGData[catId];
  }
}

async function fetchFromBGGUrl(catId) {
  const urlInput = document.getElementById(`mfurl_${catId}`).value.trim();
  if (!urlInput) return;

  // Extraire l'ID BGG depuis l'URL (ex: boardgamegeek.com/boardgame/174430/... → 174430)
  const match = urlInput.match(/boardgame(?:expansion)?\/(\d+)/);
  if (!match) {
    document.getElementById(`mfstatus_${catId}`).textContent = '⚠ URL non reconnue — format attendu : boardgamegeek.com/boardgame/XXXXX';
    return;
  }
  const bggId = match[1];

  const btn = document.getElementById(`mffetch_${catId}`);
  const status = document.getElementById(`mfstatus_${catId}`);
  btn.disabled = true;
  status.textContent = '⏳ Chargement depuis BGG…';

  const res = await api('GET', `/api/bgg/thing/${bggId}`);
  btn.disabled = false;

  if (res.error) { status.textContent = '⚠ ' + res.error; return; }

  const g = res.game;
  mfBGGData[catId] = g;

  // Remplir les champs automatiquement
  document.getElementById(`mfn_${catId}`).value = g.name;
  document.getElementById(`mfy_${catId}`).value = g.year || '';
  const players = g.min_players && g.max_players
    ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`) : '';
  document.getElementById(`mfp_${catId}`).value = players;
  const time = g.min_time && g.min_time !== '0'
    ? (g.min_time === g.max_time ? `${g.min_time}` : `${g.min_time}–${g.max_time}`) : '';
  document.getElementById(`mft_${catId}`).value = time;

  // Afficher la preview de la couverture
  const preview = document.getElementById(`mfpreview_${catId}`);
  if (g.thumbnail) {
    preview.innerHTML = `
      <img src="${g.thumbnail}" alt="" onerror="this.style.display='none'">
      <div class="mf-preview-info">
        <div class="mf-preview-name">${esc(g.name)}</div>
        <div class="mf-preview-meta">${[players && `👥 ${players}`, time && `⏱ ${time}min`].filter(Boolean).join(' · ')}</div>
      </div>`;
    preview.classList.add('visible');
    document.getElementById(`mfthumb_${catId}`).textContent = '🖼 image BGG incluse';
  } else {
    preview.classList.remove('visible');
  }
  status.textContent = `✓ Jeu trouvé sur BGG`;
}

async function addManual(catId) {
  const name = document.getElementById(`mfn_${catId}`).value.trim();
  if (!name) { showToast('Entrez un nom de jeu'); return; }
  const time = document.getElementById(`mft_${catId}`).value.trim();
  const bggData = mfBGGData[catId] || {};

  const myludoRaw = document.getElementById(`mfmyludo_${catId}`)?.value.trim() || '';
  const res = await api('POST', `/api/sessions/${currentSession.session.id}/proposals`, {
    categoryId: catId,
    bggId: bggData.bgg_id || '',
    name,
    year: document.getElementById(`mfy_${catId}`).value.trim(),
    minPlayers: document.getElementById(`mfp_${catId}`).value.trim(),
    minTime: time,
    thumbnail: bggData.thumbnail || '',
    myludoUrl: myludoRaw,
    bggRating: bggData.bgg_rating || null,
    bggWeight: bggData.bgg_weight || null,
  });
  if (res.error) { showToast(res.error); return; }
  showToast(`"${name}" ajouté !`);
  ['mfn','mfy','mfp','mft','mfurl','mfmyludo'].forEach(f => {
    const el = document.getElementById(`${f}_${catId}`);
    if (el) el.value = '';
  });
  delete mfBGGData[catId];
  document.getElementById(`mfpreview_${catId}`).classList.remove('visible');
  document.getElementById(`mfstatus_${catId}`).textContent = '';
  document.getElementById(`mfthumb_${catId}`).textContent = '';
  await reloadSession();
}

function makePropItem(p) {
  const div = document.createElement('div');
  div.className = 'prop-item';
  const players = p.min_players && p.max_players
    ? (p.min_players === p.max_players ? p.min_players : `${p.min_players}–${p.max_players}`) : '';
  const time = p.min_time && p.min_time !== '0'
    ? (p.min_time === p.max_time ? `${p.min_time}min` : `${p.min_time}–${p.max_time}min`) : '';
  const meta = [p.year && `📅 ${p.year}`, players && `👥 ${players}`, time && `⏱ ${time}`].filter(Boolean).join(' · ');
  const canDel = canDoAction('proposal_delete', p.proposed_by);
  const canEdit = canDoAction('proposal_edit', p.proposed_by);
  const bggUrl = p.bgg_id ? `https://boardgamegeek.com/boardgame/${p.bgg_id}` : '';

  div.innerHTML = `
    ${p.thumbnail ? `<img class="prop-thumb" src="${p.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="prop-thumb-ph">🎲</div>`}
    <div class="prop-info" style="flex:1;min-width:0">
      <div class="prop-name">${esc(p.name)}</div>
      ${meta ? `<div class="prop-meta">${meta}${p.bgg_rating ? ` · ⭐ ${p.bgg_rating}` : ''}${p.bgg_weight ? ` · ⚖️ ${p.bgg_weight}` : ''}</div>` : ((p.bgg_rating || p.bgg_weight) ? `<div class="prop-meta">${p.bgg_rating ? `⭐ ${p.bgg_rating}` : ''}${p.bgg_weight ? ` ⚖️ ${p.bgg_weight}` : ''}</div>` : '')}
      ${p.teacher ? `<div class="prop-meta" style="color:var(--accent)">🎓 ${esc(p.teacher)}${p.teach_duration ? ` <span style="font-weight:normal;color:var(--text-muted)">(teaching: ${p.teach_duration}min)</span>` : ''}</div>` : ''}
      <div class="prop-by">par ${esc(p.proposed_by_name)}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
        ${bggUrl ? `<a class="ext-btn" href="${bggUrl}" target="_blank" rel="noopener">🌐 BGG</a>` : ''}
        ${p.myludo_url ? `<a class="ext-btn" href="${p.myludo_url}" target="_blank" rel="noopener">🎲 MyLudo</a>` : ''}
        ${p.tuto_url ? `<a class="ext-btn" href="${esc(p.tuto_url)}" target="_blank" rel="noopener">🎬 Tuto</a>` : ''}
        ${p.bgg_id ? `<button class="coll-desc-btn" onclick="toggleDescription('pdesc_${p.id}','${p.bgg_id}',this)">▶ Description</button>` : ''}
      </div>
      ${p.bgg_id ? `<div class="coll-desc-box" id="pdesc_${p.id}" style="display:none"></div>` : ''}
    </div>
    <div class="prop-actions">
      ${canEdit ? `<button class="prop-edit" onclick="openEditProposal(${p.id})" title="Modifier">✏️</button>` : ''}
      ${canDel ? `<button class="prop-del" onclick="deleteProposal(${p.id})">✕</button>` : ''}
    </div>
  `;
  return div;
}

async function deleteProposal(id) {
  await api('DELETE', `/api/proposals/${id}`);
  await reloadSession();
}

async function openEditProposal(id) {
  const p = currentSession.proposals.find(x => x.id === id);
  if (!p) return;
  document.getElementById('epId').value = id;
  document.getElementById('epName').value = p.name || '';
  document.getElementById('epYear').value = p.year || '';
  const players = p.min_players && p.max_players
    ? (p.min_players === p.max_players ? p.min_players : `${p.min_players}-${p.max_players}`) : '';
  document.getElementById('epPlayers').value = players;
  const time = p.min_time && p.min_time !== '0'
    ? (p.min_time === p.max_time ? p.min_time : `${p.min_time}-${p.max_time}`) : '';
  document.getElementById('epTime').value = time;
  document.getElementById('epBgg').value = p.bgg_id ? `https://boardgamegeek.com/boardgame/${p.bgg_id}` : '';
  document.getElementById('epThumb').value = p.thumbnail || '';
  const thumbPrev = document.getElementById('epThumbPreview');
  if (thumbPrev) { thumbPrev.src = p.thumbnail || ''; thumbPrev.style.display = p.thumbnail ? 'block' : 'none'; }
  document.getElementById('epMyludo').value = p.myludo_url || '';
  document.getElementById('epTeachDur').value = p.teach_duration || '';
  if (document.getElementById('epTutoUrl')) document.getElementById('epTutoUrl').value = p.tuto_url || '';
  const ratingGroup = document.getElementById('epRatingGroup');
  const ratingEl = document.getElementById('epRating');
  if (p.bgg_rating && ratingGroup && ratingEl) {
    ratingEl.textContent = `⭐ ${p.bgg_rating}`;
    document.getElementById('epRatingVal').value = p.bgg_rating;
    if (p.bgg_weight) { document.getElementById('epWeightDisplay').textContent = `⚖️ ${p.bgg_weight}/5`; document.getElementById('epWeightVal').value = p.bgg_weight; }
    ratingGroup.style.display = '';
  } else if (ratingGroup) {
    document.getElementById('epRatingVal').value = '';
    document.getElementById('epWeightVal').value = '';
    ratingGroup.style.display = 'none';
  }
  // Charger la liste des membres dans le select teacher
  const teacherSel = document.getElementById('epTeacher');
  teacherSel.innerHTML = '<option value="">— Personne (jeu connu de tous)</option>';
  try {
    const usersRes = await api('GET', '/api/users');
    const members = usersRes.users || usersRes;
    members.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.username;
      opt.textContent = u.username;
      if (u.username === (p.teacher || '')) opt.selected = true;
      teacherSel.appendChild(opt);
    });
  } catch(e) {}
  openModal('editPropModal');
}

async function searchBGGForEdit() {
  const q = document.getElementById('epBggSearch')?.value.trim();
  if (!q) return;
  const results = document.getElementById('epBggResults');
  results.style.display = 'block';
  results.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);padding:8px">Recherche…</div>';
  const r = await api('GET', '/api/bgg/search?q=' + encodeURIComponent(q));
  if (!r.games?.length) {
    results.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);padding:8px">Aucun résultat</div>';
    return;
  }
  results.innerHTML = r.games.map(g => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"
      onclick='fillEditFromBGG(${JSON.stringify(g).replace(/'/g, "\\'")})'>
      ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:36px;height:36px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<div style="width:36px;height:36px;border-radius:4px;background:var(--surface3);flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:500">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div>
        ${g.min_players && g.max_players ? `<div style="font-size:.68rem;color:var(--text-muted)">👥 ${g.min_players}-${g.max_players} · ⏱ ${g.min_time||'?'}-${g.max_time||'?'}min${g.bgg_rating ? ' · ⭐ ' + g.bgg_rating : ''}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function fillEditFromBGG(g) {
  if (g.name)        document.getElementById('epName').value = g.name;
  if (g.year)        document.getElementById('epYear').value = g.year;
  if (g.min_players || g.max_players)
    document.getElementById('epPlayers').value = g.min_players === g.max_players
      ? g.min_players : `${g.min_players}-${g.max_players}`;
  if (g.min_time || g.max_time)
    document.getElementById('epTime').value = g.min_time === g.max_time
      ? g.min_time : `${g.min_time}-${g.max_time}`;
  if (g.bgg_id)
    document.getElementById('epBgg').value = 'https://boardgamegeek.com/boardgame/' + g.bgg_id;
  if (g.bgg_rating) {
    document.getElementById('epRating').textContent = '⭐ ' + g.bgg_rating;
    document.getElementById('epRatingVal').value = g.bgg_rating;
    document.getElementById('epRatingGroup').style.display = '';
  }
  if (g.bgg_weight) {
    document.getElementById('epWeightDisplay').textContent = '⚖️ ' + g.bgg_weight + '/5';
    document.getElementById('epWeightVal').value = g.bgg_weight;
    document.getElementById('epRatingGroup').style.display = '';
  }
  if (g.thumbnail) {
    document.getElementById('epThumb').value = g.thumbnail;
    const prev = document.getElementById('epThumbPreview');
    if (prev) { prev.src = g.thumbnail; prev.style.display = 'block'; }
  }
  document.getElementById('epBggResults').style.display = 'none';
  document.getElementById('epBggSearch').value = '';
  showToast('✓ Données BGG appliquées');
}

async function refreshProposalFromBGG() {
  const bggRaw = document.getElementById('epBgg').value.trim();
  const bggId = bggRaw.match(/boardgame(?:expansion)?\/(\d+)/)?.[1] || bggRaw.replace(/\D/g,'');
  if (!bggId) { showToast('Aucun ID BGG trouvé'); return; }
  showToast('Chargement BGG…');
  const res = await api('GET', `/api/bgg/thing/${bggId}`);
  if (res.error || !res.game) { showToast('Erreur BGG'); return; }
  const g = res.game;
  if (g.name) document.getElementById('epName').value = g.name;
  if (g.year) document.getElementById('epYear').value = g.year;
  if (g.min_players || g.max_players) document.getElementById('epPlayers').value = g.min_players === g.max_players ? g.min_players : `${g.min_players}-${g.max_players}`;
  if (g.min_time || g.max_time) document.getElementById('epTime').value = g.min_time === g.max_time ? g.min_time : `${g.min_time}-${g.max_time}`;
  if (g.bgg_rating) {
    document.getElementById('epRating').textContent = `⭐ ${g.bgg_rating}`;
    document.getElementById('epRatingVal').value = g.bgg_rating;
    document.getElementById('epRatingGroup').style.display = '';
  }
  if (g.bgg_weight) {
    document.getElementById('epWeightDisplay').textContent = `⚖️ ${g.bgg_weight}/5`;
    document.getElementById('epWeightVal').value = g.bgg_weight;
    document.getElementById('epRatingGroup').style.display = '';
  }
  showToast(`✓ Infos mises à jour depuis BGG`);
}

async function saveEditProposal() {
  const id = parseInt(document.getElementById('epId').value);
  const name = document.getElementById('epName').value.trim();
  if (!name) { showToast('Le nom est obligatoire'); return; }

  // Parser joueurs
  const playersRaw = document.getElementById('epPlayers').value.trim();
  const playersParts = playersRaw.split(/[-–]/);
  const minPlayers = playersParts[0]?.trim() || '';
  const maxPlayers = playersParts[1]?.trim() || playersParts[0]?.trim() || '';

  // Parser durée
  const timeRaw = document.getElementById('epTime').value.trim();
  const timeParts = timeRaw.split(/[-–]/);
  const minTime = timeParts[0]?.trim() || '';
  const maxTime = timeParts[1]?.trim() || timeParts[0]?.trim() || '';

  // Extraire bgg_id depuis URL
  const bggRaw = document.getElementById('epBgg').value.trim();
  const bggMatch = bggRaw.match(/boardgame(?:expansion)?\/(\d+)/);
  const bggId = bggMatch ? bggMatch[1] : '';

  const res = await api('PATCH', `/api/proposals/${id}`, {
    name, year: document.getElementById('epYear').value.trim(),
    minPlayers, maxPlayers, minTime, maxTime,
    bggId, myludoUrl: document.getElementById('epMyludo').value.trim(),
    teacher: document.getElementById('epTeacher').value.trim(),
    teachDuration: document.getElementById('epTeachDur').value ? parseInt(document.getElementById('epTeachDur').value) : null,
    tutoUrl: document.getElementById('epTutoUrl')?.value.trim() || '',
    bggRating: document.getElementById('epRatingVal').value || null,
    bggWeight: document.getElementById('epWeightVal')?.value || null,
    thumbnail: document.getElementById('epThumb')?.value || null
  });

  if (res.error) { showToast(res.error); return; }
  closeModal('editPropModal');
  showToast('Jeu mis à jour !');
  await reloadSession();
}

function toggleManual(catId) {
  const f = document.getElementById(`mf_${catId}`);
  const a = document.getElementById(`ma_${catId}`);
  const v = f.classList.toggle('visible');
  a.textContent = v ? '▾' : '▸';
}

function toggleColl(catId) {
  const b = document.getElementById(`collBrowser_${catId}`);
  const a = document.getElementById(`ca_${catId}`);
  const hidden = b.style.display === 'none';
  b.style.display = hidden ? '' : 'none';
  a.textContent = hidden ? '▾' : '▸';
}

async function deleteCat(catId, btn) {
  const col = btn.closest('.cat-col');
  const catName = col ? col.querySelector('.cat-col-title')?.textContent?.trim() : 'cette catégorie';
  const proposals = currentSession.proposals.filter(p => p.category_id === catId);
  const msg = proposals.length
    ? `Supprimer "${catName}" et ses ${proposals.length} proposition${proposals.length>1?'s':''} ?`
    : `Supprimer "${catName}" ?`;
  if (!confirm(msg)) return;
  await api('DELETE', `/api/categories/${catId}`);
  await reloadSession();
  showToast('Catégorie supprimée');
}

function openAddCat() {
  document.getElementById('ecCatId').value = '';
  document.getElementById('ecName').value = '';
  document.getElementById('ecIcon').value = '🎲';
  document.getElementById('ecSub').value = '';
  document.querySelector('#editCatModal .modal-title').textContent = '➕ Nouvelle catégorie';
  openModal('editCatModal');
}

function openEditCat(id, name, icon, sub) {
  document.querySelector('#editCatModal .modal-title').textContent = '✏️ Modifier la catégorie';
  document.getElementById('ecCatId').value = id;
  document.getElementById('ecName').value = name;
  document.getElementById('ecIcon').value = icon;
  document.getElementById('ecSub').value = sub;
  openModal('editCatModal');
}

async function saveEditCat() {
  const id = document.getElementById('ecCatId').value;
  const name = document.getElementById('ecName').value.trim();
  const icon = document.getElementById('ecIcon').value.trim();
  const subtitle = document.getElementById('ecSub').value.trim();
  if (!name) { showToast('Le nom est obligatoire'); return; }
  if (id) {
    await api('PATCH', `/api/categories/${id}`, { name, icon, subtitle });
  } else {
    await api('POST', `/api/sessions/${currentSession.session.id}/categories`, { name, icon, subtitle });
  }
  closeModal('editCatModal');
  await reloadSession();
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// vote.js — Panel "Voter" : classement des jeux par drag & drop
//
// Contient :
//   - renderVotePanel()         Construit le panel de vote avec toutes les catégories
//   - makeVoteCol(cat)          Construit une colonne de vote pour une catégorie
//   - makeRankItem(p, rank)     Construit un item draggable pour un jeu
//   - initDragDrop(list)        Active le drag & drop sur une liste de jeux
//   - submitRanking(catId)      Soumet le classement d'une catégorie via API
//   - retractRanking(catId)     Retire son vote pour une catégorie
//   - computeScores(catId)      Calcule les scores localement pour prévisualisation
// ─────────────────────────────────────────────────────────────

// VOTE PANEL
// ═══════════════════════════════════════════════════
function renderVotePanel() {
  const el = document.getElementById('panel-vote');
  const locked = currentSession.session.votes_locked;

  // Détecter les jeux ajoutés après le dernier vote de l'utilisateur
  const warnings = [];
  currentSession.categories.forEach(cat => {
    const myRankings = currentSession.rankings.filter(r =>
      r.category_id === cat.id && r.user_id === currentUser.id
    );
    if (!myRankings.length) return; // pas encore voté dans cette catégorie
    const lastVote = myRankings.reduce((max, r) => r.submitted_at > max ? r.submitted_at : max, '');
    const newProposals = currentSession.proposals.filter(p =>
      p.category_id === cat.id && p.created_at > lastVote
    );
    if (newProposals.length) {
      const byUser = {};
      newProposals.forEach(p => {
        const name = currentSession.participants.find(u => u.id === p.proposed_by)?.username || 'quelqu\'un';
        if (!byUser[name]) byUser[name] = [];
        byUser[name].push(p.name);
      });
      Object.entries(byUser).forEach(([user, games]) => {
        warnings.push(`<strong>${esc(user)}</strong> a ajouté ${games.length} jeu${games.length > 1 ? 'x' : ''} dans <em>${esc(cat.name)}</em> depuis ton dernier vote : ${games.map(g => `<strong>${esc(g)}</strong>`).join(', ')}`);
      });
    }
  });

  el.innerHTML = `
    ${warnings.length ? `<div style="background:var(--surface2);border:1px solid #e07030;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:.8rem;color:#e07030">
      ⚠ ${warnings.join('<br>⚠ ')}<br><span style="font-size:.72rem;opacity:.8">Merci de mettre à jour tes votes.</span>
    </div>` : ''}
    ${locked ? `<div style="background:var(--surface2);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:.8rem;color:var(--accent)">🔒 Les votes sont verrouillés par l'organisateur — aucune modification possible.</div>` : ''}
    <div class="vote-grid" id="voteGrid"></div>`;
  const grid = document.getElementById('voteGrid');
  currentSession.categories.forEach(cat => grid.appendChild(makeVoteCol(cat)));
}

function makeVoteCol(cat) {
  const proposals = currentSession.proposals.filter(p => p.category_id === cat.id);
  const proposalIds = new Set(proposals.map(p => p.id));
  const myRankings = currentSession.rankings.filter(r =>
    r.category_id === cat.id &&
    r.user_id === currentUser.id &&
    proposalIds.has(r.proposal_id)  // défensif : ignorer les votes vers d'autres catégories
  );
  const submitted = myRankings.length > 0;

  const col = document.createElement('div');
  col.className = 'vote-col';
  col.innerHTML = `
    <div class="vote-col-header">
      <div class="vote-col-title">${cat.icon} ${esc(cat.name)}</div>
      <div class="vote-status ${submitted ? 'done' : ''}">${submitted ? '✓ Classement soumis' : proposals.length ? 'Glissez pour ordonner' : 'Aucun jeu proposé'}</div>
    </div>
    <div class="vote-col-body" id="vcb_${cat.id}"></div>
  `;

  const body = col.querySelector(`#vcb_${cat.id}`);
  if (!proposals.length) { body.innerHTML = '<div class="empty" style="padding:20px"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu proposé</div></div>'; return col; }

  // Order: submitted ranking first, then previous order if available, then default
  let ordered;
  if (submitted) {
    const sorted = [...myRankings].sort((a, b) => a.rank - b.rank);
    ordered = sorted.map(r => proposals.find(p => p.id === r.proposal_id)).filter(Boolean);
    const rest = proposals.filter(p => !sorted.find(r => r.proposal_id === p.id));
    ordered = [...ordered, ...rest];
  } else if (window._prevRankOrder?.[cat.id]?.length) {
    // Restaurer l'ordre précédent après retract
    const prevIds = window._prevRankOrder[cat.id];
    ordered = prevIds.map(id => proposals.find(p => p.id === id)).filter(Boolean);
    const rest = proposals.filter(p => !prevIds.includes(p.id));
    ordered = [...ordered, ...rest];
    delete window._prevRankOrder[cat.id];
  } else {
    ordered = [...proposals];
  }

  body.innerHTML = `<div class="rank-hint">${window.matchMedia("(pointer:coarse)").matches ? "↕ Utilisez les flèches pour ordonner (1 = favori)" : "☰ Glissez les jeux dans votre ordre de préférence (1 = favori)"}</div>`;
  const list = document.createElement('div');
  list.className = 'rank-list';
  list.id = `rl_${cat.id}`;
  ordered.forEach((p, i) => list.appendChild(makeRankItem(p, i + 1, submitted)));
  body.appendChild(list);
  const locked = !!currentSession.session.votes_locked;
  const canVote = !locked || currentSession.session.created_by === currentUser.id || currentUser.is_admin;

  if (!submitted && canVote) initDragDrop(list);

  const submitArea = document.createElement('div');
  if (submitted) {
    submitArea.innerHTML = `<div class="submitted-badge">✓ Classement enregistré ${canVote ? `<button class="edit-rank-btn" onclick="retractRanking(${cat.id})">Modifier</button>` : ''}</div>`;
  } else if (canVote) {
    submitArea.innerHTML = `<button class="submit-rank-btn" onclick="submitRanking(${cat.id})">✓ Valider mon classement</button>`;
  } else {
    submitArea.innerHTML = `<div class="submitted-badge" style="color:var(--text-muted)">🔒 Votes verrouillés</div>`;
  }
  body.appendChild(submitArea);
  return col;
}

function makeRankItem(p, rank, locked) {
  const div = document.createElement('div');
  div.className = 'rank-item' + (locked ? ' locked' : '');
  div.dataset.proposalid = p.id;
  if (!locked) div.draggable = true;
  const rc = rank <= 3 ? ` r${rank}` : '';
  const players = p.min_players && p.max_players ? (p.min_players === p.max_players ? p.min_players : `${p.min_players}–${p.max_players}`) : '';
  const time = p.min_time && p.min_time !== '0' ? (p.min_time === p.max_time ? `${p.min_time}min` : `${p.min_time}-${p.max_time}min`) : '';
  const bggUrl = p.bgg_id ? `https://boardgamegeek.com/boardgame/${p.bgg_id}` : '';
  const meta = [players && `👥 ${players}`, time && `⏱ ${time}`].filter(Boolean).join(' · ');
  div.innerHTML = `
    ${!locked ? `<span class="rank-handle">⋮⋮</span>
    <div class="rank-arrows">
      <button class="rank-arrow" onclick="moveRankItem(this,-1)" title="Monter">▲</button>
      <button class="rank-arrow" onclick="moveRankItem(this,1)" title="Descendre">▼</button>
    </div>` : ''}
    <div class="rank-num${rc}">${rank}</div>
    ${p.thumbnail ? `<img class="ri-thumb" src="${p.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="ri-thumb-ph">🎲</div>`}
    <div class="ri-info">
      <div class="ri-name">${esc(p.name)}${p.year ? ` <span style="font-size:.65rem;color:var(--text-muted)">(${p.year})</span>` : ''}</div>
      ${meta ? `<div class="ri-meta">${meta}</div>` : ''}
      <div class="ri-links">
        ${bggUrl ? `<a class="ext-btn" href="${bggUrl}" target="_blank" rel="noopener">🌐 BGG</a>` : ''}
        ${p.myludo_url ? `<a class="ext-btn" href="${p.myludo_url}" target="_blank" rel="noopener">🎲 MyLudo</a>` : ''}
        ${p.bgg_id ? `<button class="coll-desc-btn" onclick="toggleDescription('rdesc_${p.id}','${p.bgg_id}',this)">▶ Description</button>` : ''}
      </div>
      ${p.bgg_id ? `<div class="coll-desc-box" id="rdesc_${p.id}" style="display:none"></div>` : ''}
    </div>
  `;
  return div;
}

// Drag & Drop
function initDragDrop(list) {
  let dragSrc = null; // local à cette liste — évite la contamination entre catégories
  list.addEventListener('dragstart', e => { dragSrc = e.target.closest('.rank-item'); if (dragSrc) dragSrc.classList.add('dragging'); });
  list.addEventListener('dragend', () => { list.querySelectorAll('.rank-item').forEach(i => i.classList.remove('dragging', 'drag-over')); dragSrc = null; updateRankNums(list); });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('.rank-item');
    if (!over || over === dragSrc) return;
    list.querySelectorAll('.rank-item').forEach(i => i.classList.remove('drag-over'));
    over.classList.add('drag-over');
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    const over = e.target.closest('.rank-item');
    if (!over || over === dragSrc || !dragSrc) return;
    const items = [...list.querySelectorAll('.rank-item')];
    if (items.indexOf(dragSrc) < items.indexOf(over)) list.insertBefore(dragSrc, over.nextSibling);
    else list.insertBefore(dragSrc, over);
    list.querySelectorAll('.rank-item').forEach(i => i.classList.remove('drag-over'));
    dragSrc = null;
    updateRankNums(list);
  });
}

// Déplace un item de ±1 position via les boutons ▲ ▼ (mobile)
function moveRankItem(btn, dir) {
  const item = btn.closest('.rank-item');
  const list = item.closest('.rank-list');
  const items = [...list.querySelectorAll('.rank-item')];
  const idx = items.indexOf(item);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= items.length) return;
  if (dir === -1) list.insertBefore(item, items[newIdx]);
  else list.insertBefore(item, items[newIdx].nextSibling);
  updateRankNums(list);
}
function updateRankNums(list) { list.querySelectorAll('.rank-item').forEach((item, i) => { const n = item.querySelector('.rank-num'); n.textContent = i + 1; n.className = 'rank-num' + (i < 3 ? ` r${i + 1}` : ''); }); }

async function submitRanking(catId) {
  const list = document.getElementById(`rl_${catId}`);
  const order = [...list.querySelectorAll('.rank-item')].map(i => parseInt(i.dataset.proposalid));
  const res = await api('POST', `/api/sessions/${currentSession.session.id}/rankings`, { categoryId: catId, order });
  if (res.error) { showToast(res.error); return; }
  showToast('Classement enregistré ✓');
  await reloadSession();
  renderVotePanel();
  refreshHome();
}

async function retractRanking(catId) {
  // Mémoriser l'ordre actuel avant de supprimer
  const list = document.getElementById(`rl_${catId}`);
  if (!window._prevRankOrder) window._prevRankOrder = {};
  window._prevRankOrder[catId] = list ? [...list.querySelectorAll('.rank-item')].map(i => parseInt(i.dataset.proposalid)) : [];
  await api('DELETE', `/api/sessions/${currentSession.session.id}/rankings/${catId}`);
  await reloadSession();
  refreshHome();
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// results.js — Panel "Résultats" : affichage des scores de vote
//
// Contient :
//   - renderResultsPanel()   Affiche le classement final de chaque catégorie
//   - toggleVoter(pid)       Filtre les résultats par votant
// ─────────────────────────────────────────────────────────────

// RESULTS PANEL
// ═══════════════════════════════════════════════════
function computeScores(catId) {
  const proposals = currentSession.proposals.filter(p => p.category_id === catId);
  const scores = {};
  proposals.forEach(p => scores[p.id] = 0);
  // Group rankings by user
  const byUser = {};
  currentSession.rankings.filter(r => r.category_id === catId).forEach(r => {
    if (!byUser[r.user_id]) byUser[r.user_id] = [];
    byUser[r.user_id].push(r);
  });
  Object.values(byUser).forEach(userRanks => {
    const n = userRanks.length;
    userRanks.forEach(r => { if (scores[r.proposal_id] !== undefined) scores[r.proposal_id] += (n - r.rank + 1); });
  });
  return scores;
}

function renderResultsPanel() {
  const grid = document.getElementById('panel-results');
  grid.innerHTML = '<div class="results-grid" id="resGrid"></div><div class="voter-section"><div class="section-label">Classements individuels</div><div id="voterList"></div></div>';

  const resGrid = document.getElementById('resGrid');
  currentSession.categories.forEach(cat => {
    const proposals = currentSession.proposals.filter(p => p.category_id === cat.id);
    const scores = computeScores(cat.id);
    const sorted = [...proposals].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    const maxScore = scores[sorted[0]?.id] || 1;
    const voterIds = new Set(currentSession.rankings.filter(r => r.category_id === cat.id).map(r => r.user_id));

    const col = document.createElement('div');
    col.className = 'res-col';
    col.innerHTML = `
      <div class="res-col-header">
        <div class="res-col-title">${cat.icon} ${esc(cat.name)}</div>
        <div class="res-col-sub">${voterIds.size} participant(s) ont classé · score Borda</div>
      </div>
      <div class="res-col-body" id="resbody_${cat.id}"></div>
    `;
    const body = col.querySelector(`#resbody_${cat.id}`);
    if (!sorted.length) { body.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu</div></div>'; }
    else {
      sorted.forEach((p, i) => {
        const score = scores[p.id] || 0;
        const rc = i < 3 ? ` r${i + 1}` : '';
        const pct = Math.round(score / maxScore * 100);
        const div = document.createElement('div');
        div.className = 'res-game';
        const bggUrlRes = p.bgg_id ? `https://boardgamegeek.com/boardgame/${p.bgg_id}` : '';
        div.innerHTML = `
          <div class="res-rank${rc}">${i + 1}</div>
          ${p.thumbnail ? `<img class="rg-thumb" src="${p.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="rg-thumb-ph">🎲</div>`}
          <div class="rg-info">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div class="rg-name">${esc(p.name)}</div>
              ${bggUrlRes ? `<a class="ext-btn" href="${bggUrlRes}" target="_blank" rel="noopener">🌐 BGG</a>` : ''}
            </div>
            <div class="rg-score"><div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div><span class="score-val">${score}pts</span></div>
          </div>`;
        body.appendChild(div);
      });
    }
    resGrid.appendChild(col);
  });

  // Voter breakdown
  const voterList = document.getElementById('voterList');
  const players = currentSession.participants;
  if (!players.length) { voterList.innerHTML = '<div class="empty"><span class="empty-icon">🗳️</span><div class="empty-label">Aucun vote encore</div></div>'; return; }
  players.forEach(player => {
    const row = document.createElement('div');
    row.className = 'voter-row';
    const pid = `vr_${player.id}`;
    const badges = currentSession.categories.map(cat => {
      const hasVoted = currentSession.rankings.some(r => r.user_id === player.id && r.category_id === cat.id);
      return `<span class="voter-badge ${hasVoted ? 'done' : ''}">${cat.icon} ${esc(cat.name)} ${hasVoted ? '✓' : '—'}</span>`;
    }).join('');
    row.innerHTML = `
      <div class="voter-row-hd" onclick="toggleVoter('${pid}')">
        <div class="voter-name">👤 ${esc(player.username)}</div>
        <div class="voter-badges">${badges}</div>
        <span class="voter-expand" id="ve_${pid}">▶</span>
      </div>
      <div class="voter-detail" id="${pid}">
        ${currentSession.categories.map(cat => {
          const catRanks = currentSession.rankings.filter(r => r.user_id === player.id && r.category_id === cat.id).sort((a, b) => a.rank - b.rank);
          if (!catRanks.length) return `<div><div class="vd-cat-label">${cat.icon} ${esc(cat.name)}</div><div style="font-size:.68rem;color:var(--text-muted)">Pas encore classé</div></div>`;
          const items = catRanks.map((r, i) => {
            const p = currentSession.proposals.find(p => p.id === r.proposal_id);
            if (!p) return '';
            const rc = i < 3 ? ` r${i + 1}` : '';
            return `<div class="vd-item"><span class="vd-pos${rc}">${i + 1}</span>${esc(p.name)}</div>`;
          }).join('');
          return `<div><div class="vd-cat-label">${cat.icon} ${esc(cat.name)}</div><div class="vd-list">${items}</div></div>`;
        }).join('')}
      </div>`;
    voterList.appendChild(row);
  });
}

function toggleVoter(pid) {
  const detail = document.getElementById(pid);
  const expand = document.getElementById(`ve_${pid}`);
  detail.classList.toggle('open');
  expand.classList.toggle('open', detail.classList.contains('open'));
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// programme.js — Panel "Programme" : planning de la journée
//
// Contient :
//   - renderProgrammePanel()     Affiche le programme avec ses créneaux
//   - addSlot() / deleteSlot()   Ajoute/supprime un créneau manuellement
//   - generateProgramme()        Lance la génération IA via POST /api/programme/generate
//   - validateProgramme()        Publie le programme (visible par tous)
//   - renderSlotCard(slot)       Construit le HTML d'un créneau
//   - slotGameSearch()           Autocomplete jeux dans un créneau
//   - buildPlayersSelector()     Sélecteur de joueurs pour un créneau
//   - estimateDuration()         Estime la durée d'un créneau via IA
// ─────────────────────────────────────────────────────────────

// PROGRAMME IA
// ═══════════════════════════════════════════════════

// Programme slots en mémoire
let programmeSlots = [];
let progLoaded = false;
let conventionBookings = []; // réservations en mode convention

async function renderProgrammePanel() {
  // Mode convention — vue organisateur avec joueurs par table
  if (currentSession.session.is_convention) {
    await renderConventionProgramme();
    return;
  }

  // Charger tous les users si pas encore fait
  if (!window._allUsers) {
    const r = await api('GET', '/api/users');
    window._allUsers = r.users || r || [];
  }
  const el = document.getElementById('panel-programme');
  const hasVotes = currentSession.rankings.length > 0;
  const hasProposals = currentSession.proposals.length > 0;
  const canManage = currentSession.session.created_by === currentUser.id || currentUser.is_admin;

  const nbParticipants = currentSession.participants.length;
  const totalGames = currentSession.proposals.length;

  // Afficher un avertissement si pas encore de votes/propositions, mais laisser accès au programme
  const warnings = [];
  if (!hasProposals) warnings.push('Aucun jeu proposé encore.');
  if (hasProposals && !hasVotes) warnings.push("Personne n'a encore voté.");

  el.innerHTML = `
    <div class="prog-card">
      <div class="prog-card-header">
        <div class="prog-card-title">📋 Programme de la journée</div>
        ${currentSession.session.programme_validated ? `<a class="btn-sm accent" href="/programme/${currentSession.session.id}" target="_blank" style="text-decoration:none">🔗 Page publique</a>` : ''}
      </div>
      <div class="prog-card-body">
        ${warnings.length ? `<div class="prog-warn">${warnings.join(' ')} Vous pouvez quand même créer le programme manuellement.</div>` : ''}
        ${hasProposals ? `
        <div class="prog-participants">
          <strong>${nbParticipants} participant${nbParticipants > 1 ? 's' : ''}</strong> ·
          <strong>${totalGames} jeu${totalGames > 1 ? 'x' : ''}</strong> proposés
        </div>` : ''}
        ${hasVotes ? `
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn-sm ghost" style="flex:1" onclick="openRankingsPopup()">
            📊 Par joueur
          </button>
          <button class="btn-sm ghost" style="flex:1" onclick="openRankingsByGame()">
            🎲 Par jeu
          </button>
        </div>` : ''}

        <details class="prog-ai-section ai-feature">
          <summary>✨ Générer avec l'IA</summary>
          <div class="prog-ai-body">
            <div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:10px">
              <button class="btn-sm" id="progModeGuided" onclick="setProgMode('guided')" style="background:var(--accent);color:var(--bg)">⚙️ Mode guidé</button>
              <button class="btn-sm ghost" id="progModeFree" onclick="setProgMode('free')">✍️ Mode libre</button>
            </div>
            <div id="progGuidedForm">
              <div class="prog-options">
                <div class="prog-option">
                  <label>Heure de début</label>
                  <input type="time" id="progStart" value="10:00">
                </div>
                <div class="prog-option">
                  <label>Heure de fin</label>
                  <input type="time" id="progEnd" value="18:00">
                </div>
                <div class="prog-option">
                  <label>Pause déjeuner</label>
                  <div class="toggle-row">
                    <input type="checkbox" id="progLunch" checked onchange="document.getElementById('progLunchTime').style.display=this.checked?'block':'none'">
                    <span style="font-size:.75rem">Inclure une pause</span>
                  </div>
                  <input type="time" id="progLunchTime" value="12:30" style="margin-top:4px">
                </div>
                <div class="prog-option">
                  <label>Durée pause (min)</label>
                  <input type="number" id="progLunchDur" value="60" min="15" max="120" step="15">
                </div>
                <div class="prog-option">
                  <label>👥 Nombre de joueurs</label>
                  <input type="number" id="progNbPlayers" value="${nbParticipants}" min="2" max="20" step="1">
                </div>
                <div class="prog-option">
                  <label>🎲 Nombre de tables max</label>
                  <input type="number" id="progNbTables" class="form-input" value="2" min="1" max="10" step="1">
                </div>
                <div class="prog-option">
                  <label>🤝 Créneaux tous ensemble</label>
                  <input type="number" id="progNbTogether" value="0" min="0" max="10" step="1" placeholder="0 = pas de contrainte">
                </div>
                <div class="prog-option">
                  <label>⚡ Créneaux en parallèle</label>
                  <input type="number" id="progNbParallel" value="0" min="0" max="10" step="1" placeholder="0 = pas de contrainte">
                </div>
              </div>
              <button class="gen-btn" id="genBtn" onclick="generateProgramme()">
                ✨ Générer le programme avec l'IA
              </button>
              <button class="gen-btn" id="estimBtn" onclick="estimateDuration()" style="background:var(--surface);border:1px solid var(--accent);color:var(--accent);margin-top:8px">
                ⏱ Évaluer la durée de la séance
              </button>
            </div>
            <div id="progFreeForm" style="display:none">
              <div class="form-group">
                <label class="form-label" style="margin-bottom:6px">Décris le programme que tu veux :</label>
                <textarea class="form-input" id="progFreeText" rows="5" style="resize:vertical;font-size:.85rem" placeholder="Ex: Fais-moi un programme de 10h à 18h avec une pause déjeuner. Je veux 2 jeux où on est tous ensemble le matin, puis après-midi avec 3 tables de 3 joueurs. Commence par les jeux les mieux votés."></textarea>
              </div>
              <div class="prog-option" style="margin-bottom:10px">
                <label>👥 Nombre de joueurs</label>
                <input type="number" id="progNbPlayersFree" value="${nbParticipants}" min="2" max="20" step="1">
              </div>
              <button class="gen-btn" id="genBtnFree" onclick="generateProgrammeFree()">
                ✨ Générer le programme avec l'IA
              </button>
            </div>
            <div id="progOutput"></div>
          </div>
        </details>
        <div id="progSlots"></div>
        <div id="progValidateBar" style="margin-top:16px;display:flex;gap:8px;align-items:center"></div>
      </div>
    </div>
  `;

  // Charger les créneaux sauvegardés
  if (!progLoaded) {
    const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
    programmeSlots = r.slots || [];
    // Charger les réservations si mode convention
    if (currentSession.session.is_convention) {
      const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
      conventionBookings = br.bookings || [];
    }
    progLoaded = true;
  }
  renderSlots();
  renderValidateBar();
}

function renderValidateBar() {
  const bar = document.getElementById('progValidateBar');
  if (!bar) return;
  const sessOwnerId = currentSession.session.created_by;
  const canPub = canDoAction('programme_publish', sessOwnerId);
  if (!canPub || !programmeSlots.length) { bar.innerHTML = ''; return; }
  const validated = currentSession.session.programme_validated;
  bar.innerHTML = validated
    ? `<span style="color:var(--green-text);font-size:.8rem">✅ Programme publié</span>
       <button class="btn-sm ghost" onclick="validateProgramme(false)">Dépublier</button>`
    : `<button class="btn-sm accent" onclick="validateProgramme(true)">✅ Valider & publier le programme</button>`;
}

async function validateProgramme(publish) {
  const endpoint = publish ? 'validate' : 'unvalidate';
  await api('PATCH', `/api/sessions/${currentSession.session.id}/programme/${endpoint}`);
  currentSession.session.programme_validated = publish ? 1 : 0;
  renderValidateBar();
  showToast(publish ? 'Programme publié !' : 'Programme dépublié');
}

function buildTeacherOptions(players, current) {
  // Toujours proposer tous les participants, peu importe la valeur de players
  const list = [];
  (currentSession && currentSession.participants || []).forEach(function(p) {
    if (!list.includes(p.username)) list.push(p.username);
  });
  // Ajouter aussi les joueurs explicitement listés s'ils ne sont pas participants
  if (players && players.toLowerCase() !== 'tous') {
    players.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!list.includes(name)) list.push(name);
    });
  }
  return list.map(function(name) {
    const sel = current === name ? ' selected' : '';
    return '<option value="' + esc(name) + '"' + sel + '>' + esc(name) + '</option>';
  }).join('');
}

// table = numéro (1, 2, 3...)
function _teacherId(idx, tableNum, type) {
  if (type === 'sel')  return `steacher_${idx}_${tableNum}`;
  if (type === 'free') return `steacher_free_${idx}_${tableNum}`;
  return `steacher_warn_${idx}_${tableNum}`;
}

function _playersInputId(idx, tableNum) {
  return `sp_${idx}_${tableNum}`;
}

function onTeacherChange(idx, tableNum) {
  const sel  = document.getElementById(_teacherId(idx, tableNum, 'sel'));
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  if (free) free.value = '';
  checkTeacherWarning(idx, tableNum, sel?.value || '');
  checkTeacherConflictsLive(idx);
}

function onTeacherFreeInput(idx, tableNum) {
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  checkTeacherWarning(idx, tableNum, free?.value || '');
  checkTeacherConflictsLive(idx);
}

function getTeacherValue(idx, tableNum) {
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  if (free?.value.trim()) return free.value.trim();
  return document.getElementById(_teacherId(idx, tableNum, 'sel'))?.value || '';
}

function checkTeacherWarning(idx, tableNum, teacher) {
  const warn = document.getElementById(_teacherId(idx, tableNum, 'warn'));
  if (!warn || !teacher) { if (warn) warn.style.display = 'none'; return; }
  const playersInput = document.getElementById(_playersInputId(idx, tableNum));
  const players = playersInput?.value || '';
  if (players && players.toLowerCase() !== 'tous') {
    const list = players.split(',').map(s => s.trim().toLowerCase());
    if (!list.includes(teacher.toLowerCase())) {
      warn.textContent = `⚠ ${teacher} n'est pas dans les joueurs de cette table`;
      warn.style.display = 'block'; return;
    }
  }
  warn.style.display = 'none';
}

function checkTeacherConflictsLive(editIdx) {
  const slot = programmeSlots[editIdx];
  const teachers = (slot.tables || []).map(t => getTeacherValue(editIdx, t.table_number)).filter(Boolean);
  const seen = new Set();
  for (const t of teachers) {
    const key = t.toLowerCase();
    const warnId = `steacher_warn_${editIdx}_${(slot.tables || []).find(x => getTeacherValue(editIdx, x.table_number)?.toLowerCase() === key)?.table_number}`;
    const warnEl = document.getElementById(warnId);
    if (seen.has(key)) {
      if (warnEl) { warnEl.textContent = '⚠ Même teacher pour plusieurs tables !'; warnEl.style.display = 'block'; }
    }
    seen.add(key);
  }
}

function checkTeacherConflicts(editIdx) {
  const conflicts = [];
  const slot = programmeSlots[editIdx];
  const teachers = (slot.tables || []).map(t => t.teacher).filter(Boolean);

  // Conflits internes au créneau
  const seen = new Set();
  for (const t of teachers) {
    const key = t.toLowerCase();
    if (seen.has(key)) conflicts.push(`${t} ne peut pas enseigner plusieurs tables en même temps`);
    seen.add(key);
  }

  // Vérifier contre les autres créneaux simultanés
  const startTime = document.getElementById(`st_${editIdx}`)?.value || '';
  if (startTime) {
    programmeSlots.forEach((s, i) => {
      if (i === editIdx || s.is_break) return;
      if (s.start_time === startTime) {
        const others = (s.tables || []).map(t => t.teacher).filter(Boolean);
        teachers.forEach(t => {
          if (others.some(o => o.toLowerCase() === t.toLowerCase())) {
            conflicts.push(`${t} enseigne déjà à ${startTime} (autre créneau)`);
          }
        });
      }
    });
  }
  return [...new Set(conflicts)];
}

async function estimateSlotDuration(idx, tableNum) {
  const gameInput = document.getElementById(`sn_${idx}_${tableNum}`);
  const durInput  = document.getElementById(`sde_${idx}_${tableNum}`);
  const btn = document.querySelector(`[onclick="estimateSlotDuration(${idx},${tableNum})"]`);
  const gameName = gameInput?.value?.trim();
  if (!gameName) { showToast("Renseigne d'abord le nom du jeu"); return; }
  const nbPlayers = currentSession.participants?.length || 4;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const res = await api('POST', '/api/programme/estimate-slot', { gameName, nbPlayers });
  if (btn) { btn.textContent = '✨'; btn.disabled = false; }
  if (res.unknown || !res.duration) { showToast('Jeu inconnu de Claude'); return; }
  if (durInput) durInput.value = res.duration;
  showToast(`Durée estimée : ${res.duration}min pour ${nbPlayers} joueurs`);
}

function setProgMode(mode) {
  const guided = document.getElementById('progGuidedForm');
  const free = document.getElementById('progFreeForm');
  const btnG = document.getElementById('progModeGuided');
  const btnF = document.getElementById('progModeFree');
  if (mode === 'guided') {
    guided.style.display = ''; free.style.display = 'none';
    btnG.style.background = 'var(--accent)'; btnG.style.color = 'var(--bg)'; btnG.className = 'btn-sm';
    btnF.style.background = ''; btnF.style.color = ''; btnF.className = 'btn-sm ghost';
  } else {
    guided.style.display = 'none'; free.style.display = '';
    btnF.style.background = 'var(--accent)'; btnF.style.color = 'var(--bg)'; btnF.className = 'btn-sm';
    btnG.style.background = ''; btnG.style.color = ''; btnG.className = 'btn-sm ghost';
  }
}

async function generateProgrammeFree() {
  const btn = document.getElementById('genBtnFree');
  const output = document.getElementById('progOutput');
  const freeText = document.getElementById('progFreeText')?.value.trim();
  const nbPlayers = parseInt(document.getElementById('progNbPlayersFree')?.value) || currentSession.participants?.length || 4;

  if (!freeText) { showToast('Décris le programme souhaité avant de générer'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Génération…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude réfléchit…</span></div>`;

  const res = await api('POST', '/api/programme/generate', {
    sessionId: currentSession.session.id,
    freeText,
    nbPlayers,
    mode: 'free'
  });

  btn.disabled = false;
  btn.textContent = '✨ Générer le programme avec l\'IA';
  output.innerHTML = '';

  if (res.error) {
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">🔑 <strong>Clé API Anthropic non configurée</strong><br><span style="font-size:.8rem">${esc(res.message)}</span></div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }

  // Dépublier le programme existant si publié
  if (currentSession.session.programme_validated) {
    await api('PATCH', `/api/sessions/${currentSession.session.id}/programme/unvalidate`);
    currentSession.session.programme_validated = 0;
  }

  programmeSlots = res.slots || [];
  progLoaded = true;

  if (res.unscheduled?.length) {
    output.innerHTML = `<div class="prog-warn">⚠ Jeux non planifiés faute de temps : ${res.unscheduled.map(g => `<strong>${esc(g)}</strong>`).join(', ')}</div>`;
  }
  renderSlots();
  renderValidateBar();
}

async function generateProgramme() {
  const btn = document.getElementById('genBtn');
  const output = document.getElementById('progOutput');
  const nbParticipants = currentSession.participants?.length || 4;

  const startTime = document.getElementById('progStart').value;
  const endTime = document.getElementById('progEnd').value;
  const hasLunch = document.getElementById('progLunch').checked;
  const lunchTime = document.getElementById('progLunchTime').value;
  const lunchDur = document.getElementById('progLunchDur').value;

  btn.disabled = true;
  btn.textContent = '⏳ Génération…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude réfléchit…</span></div>`;

  const nbPlayers = parseInt(document.getElementById('progNbPlayers')?.value) || nbParticipants;
  const nbTables = parseInt(document.getElementById('progNbTables')?.value) || 2;
  const nbTogether = parseInt(document.getElementById('progNbTogether')?.value) || 0;
  const nbParallel = parseInt(document.getElementById('progNbParallel')?.value) || 0;

  // Enregistrer le listener SSE avant d'envoyer la requête
  window._pendingProgrammeGeneration = true;

  const res = await api('POST', '/api/programme/generate', {
    sessionId: currentSession.session.id,
    startTime, endTime, hasLunch, lunchTime,
    lunchDurationMinutes: parseInt(lunchDur),
    nbPlayers, nbTables, nbTogether, nbParallel
  });

  // Si erreur immédiate (clé manquante, session introuvable, etc.)
  if (res.error) {
    window._pendingProgrammeGeneration = false;
    btn.disabled = false;
    btn.textContent = '✨ Générer avec l\'IA';
    output.innerHTML = '';
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">
        🔑 <strong>Clé API Anthropic non configurée</strong><br>
        <span style="font-size:.8rem">${esc(res.message)}</span>
      </div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }

  // res.pending === true : la génération tourne en arrière-plan
  // Le résultat arrivera via SSE événement 'programme.generated'
  // (géré dans app.js → initSSE)
}

function _onProgrammeGenerated(data) {
  const btn = document.getElementById('genBtn');
  const output = document.getElementById('progOutput');
  window._pendingProgrammeGeneration = false;

  if (btn) { btn.disabled = false; btn.textContent = '✨ Générer avec l\'IA'; }
  if (output) output.innerHTML = '';

  if (data.error) {
    if (output) output.innerHTML = `<div class="prog-err">⚠ ${esc(data.error)}</div>`;
    return;
  }

  // Dépublier si nécessaire
  if (currentSession.session.programme_validated) {
    api('PATCH', `/api/sessions/${currentSession.session.id}/programme/unvalidate`);
    currentSession.session.programme_validated = 0;
  }

  programmeSlots = data.slots || [];
  progLoaded = true;

  if (data.unscheduled?.length) {
    if (output) output.innerHTML = `<div class="prog-unscheduled">⚠ Jeux non planifiés : ${data.unscheduled.map(esc).join(', ')}</div>`;
  }

  renderSlots();
  renderValidateBar();
}

function renderSlots() {
  const container = document.getElementById('progSlots');
  if (!container) return;

  if (!programmeSlots.length) {
    container.innerHTML = `
      <div class="prog-result">
        <div class="prog-result-header">
          <div class="prog-result-title">📋 Programme</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="prog-regen btn-sm ghost" onclick="addSlot()">+ Créneau</button>
          </div>
        </div>
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:.8rem">
          Aucun créneau — cliquez "+ Créneau" pour créer le programme manuellement
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="prog-result">
      <div class="prog-result-header">
        <div class="prog-result-title">📋 Programme</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="prog-regen btn-sm ghost" onclick="addSlot()">+ Créneau</button>
        </div>
      </div>
      <div id="slotList"></div>
    </div>
  `;

  const list = document.getElementById('slotList');
  programmeSlots.forEach((s, i) => {
    list.appendChild(makeSlotCard(s, i));
  });
  initSlotDragDrop(list);
}

function initSlotDragDrop(list) {
  let dragSrc = null;

  list.addEventListener('dragstart', e => {
    const card = e.target.closest('.slot-card');
    if (!card) return;
    dragSrc = card;
    card.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', e => {
    const card = e.target.closest('.slot-card');
    if (card) card.style.opacity = '';
    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));
    dragSrc = null;
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.slot-card');
    if (!card || card === dragSrc) return;
    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    const card = e.target.closest('.slot-card');
    if (!card || card === dragSrc || !dragSrc) return;

    const cards = [...list.querySelectorAll('.slot-card')];
    const fromIdx = cards.indexOf(dragSrc);
    const toIdx = cards.indexOf(card);
    if (fromIdx === -1 || toIdx === -1) return;

    // Réordonner programmeSlots
    const [moved] = programmeSlots.splice(fromIdx, 1);
    programmeSlots.splice(toIdx, 0, moved);

    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));

    // Recalculer les horaires et afficher immédiatement
    recalcSlotTimes();
    renderSlots();

    // Sauvegarder en arrière-plan
    const reorder = programmeSlots.map((s, i) => ({ id: s.id, sort_order: i })).filter(s => s.id);
    if (reorder.length) api('PATCH', '/api/programme/reorder', { slots: reorder });
    for (const s of programmeSlots) {
      if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, s);
    }
  });
}

function makeSlotCard(slot, idx) {
  const div = document.createElement('div');
  div.className = 'slot-card' + (slot.is_break ? ' slot-break' : '');
  div.dataset.id = slot.id;
  div.draggable = true;

  const tables = slot.tables || [];
  const multiTable = tables.length > 1;

  // Index BGG rating et tuto_url depuis les propositions
  const ratingIndex = {};
  const tutoIndex = {};
  (currentSession?.proposals || []).forEach(p => {
    if (p.bgg_rating) ratingIndex[p.name.toLowerCase()] = p.bgg_rating;
    if (p.tuto_url)   tutoIndex[p.name.toLowerCase()] = p.tuto_url;
  });

  function tableViewHtml(t) {
    const rating = t.game_name ? ratingIndex[t.game_name.toLowerCase()] : null;
    const tutoUrl = t.game_name ? tutoIndex[t.game_name.toLowerCase()] : null;
    return `<div class="slot-table-block${multiTable ? ' slot-table-boxed' : ''}" style="display:flex;gap:8px;align-items:flex-start">
      ${t.thumbnail ? `<img src="${esc(t.thumbnail)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        ${multiTable ? `<div class="table-badge">Table ${t.table_number}</div>` : ''}
        <div class="slot-name">${esc(t.game_name)}${rating ? ` <span style="font-size:.65rem;color:var(--accent);font-weight:700">⭐${rating}</span>` : ''}</div>
        <div class="slot-meta">${t.duration_est ? t.duration_est+'min · ' : ''}${esc(t.players)}${t.teacher ? ' · 🎓 '+esc(t.teacher) : ''}</div>
        ${tutoUrl ? `<a href="${esc(tutoUrl)}" target="_blank" rel="noopener" style="font-size:.68rem;color:var(--accent)">🎬 Vidéo tuto</a>` : ''}
        ${currentSession?.session?.is_convention && !slot.is_break ? (() => {
          const tableBookings = conventionBookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
          const myBooking = tableBookings.find(b => b.user_id === currentUser?.id);
          const mySlotBooking = conventionBookings.find(b => b.slot_id === slot.id && b.user_id === currentUser?.id);
          const isFull = t.max_players && tableBookings.length >= t.max_players;
          const count = `${tableBookings.length}${t.max_players ? '/'+t.max_players : ''} joueur${tableBookings.length !== 1 ? 's' : ''}`;
          const minInfo = t.min_players ? ` (min ${t.min_players})` : '';
          if (myBooking) {
            return `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:.72rem;color:var(--green,#4caf50)">✅ Tu es inscrit — ${count}</span>
              <button class="btn-sm ghost" style="font-size:.68rem;padding:2px 8px" onclick="cancelBooking(${slot.id})">Annuler</button>
            </div>`;
          }
          if (mySlotBooking) {
            return `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">⛔ Tu joues déjà sur ce créneau — ${count}</div>`;
          }
          if (isFull) {
            return `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">🔒 Complet — ${count}</div>`;
          }
          return `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:.72rem;color:var(--text-muted)">${count}${minInfo}</span>
            <button class="btn-sm accent" style="font-size:.68rem;padding:2px 8px" onclick="bookTable(${slot.id},${t.id})">Réserver</button>
          </div>`;
        })() : ''}
      </div>
    </div>`;
  }

  const tablesViewHtml = slot.is_break
    ? `<div class="slot-name">☕ ${esc(tables[0]?.game_name || slot.note || 'Pause')}</div>`
    : `<div class="slot-tables">${tables.map(t => tableViewHtml(t)).join('')}</div>`;

  // Formulaire d'édition — une section par table
  const tablesEditHtml = tables.map((t, ti) => makeTableEditBlock(ti, t, slot, idx)).join('');

  div.innerHTML = `
    <div class="slot-view">
      <div class="slot-drag-handle" title="Déplacer">⠿</div>
      <div class="slot-time">${esc(slot.start_time)}</div>
      <div class="slot-info" style="flex:1">
        ${tablesViewHtml}
        ${slot.note ? `<div class="slot-note">💬 ${esc(slot.note)}</div>` : ''}
      </div>
      <div class="slot-actions">
        <button class="prop-edit slot-toggle-btn" id="stoggle_${idx}" onclick="toggleSlotEdit(${idx})" title="Modifier">▸</button>
        <button class="prop-del" onclick="deleteSlot(${idx})">✕</button>
      </div>
    </div>
    <div class="slot-edit-form" id="sedit_${idx}" style="display:none">
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label">⏰ Heure</label>
        <input type="time" class="form-input" id="st_${idx}" value="${esc(slot.start_time)}" style="max-width:120px" onchange="cascadeTimeFrom(${idx}, this.value)">
      </div>
      <div id="stablesEdit_${idx}">${tablesEditHtml}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn-sm ghost" onclick="addTableToSlot(${idx})">+ Ajouter une table</button>
        ${tables.length > 1 ? `<button class="btn-sm ghost" onclick="removeTableFromSlot(${idx})">− Retirer dernière table</button>` : ''}
      </div>
      <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="sno_${idx}" value="${esc(slot.note)}" placeholder="Conseil, remarque…"></div>
      <div class="form-group"><label class="form-label"><input type="checkbox" id="sb_${idx}" ${slot.is_break ? 'checked' : ''}> Pause (déjeuner, café…)</label></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-sm ghost" onclick="cancelEditSlot(${idx})">Annuler</button>
        <button class="btn-sm accent" onclick="saveSlot(${idx})">Enregistrer</button>
        ${idx > 0 ? `<button class="btn-sm ghost" onclick="moveSlot(${idx},-1)">↑</button>` : ''}
        ${idx < programmeSlots.length-1 ? `<button class="btn-sm ghost" onclick="moveSlot(${idx},1)">↓</button>` : ''}
      </div>
    </div>
  `;
  return div;
}

function makeTableEditBlock(tableIndex, table, slot, idx) {
  const tn = table.table_number;
  const gameName  = table.game_name  || '';
  const players   = table.players    || '';
  const teacher   = table.teacher    || '';
  const durEst    = table.duration_est;
  const gameId    = `sn_${idx}_${tn}`;
  const nbId      = `snj_${idx}_${tn}`;
  const durId     = `sde_${idx}_${tn}`;
  const wrapId    = `spwrap_${idx}_${tn}`;
  const teachSelId  = `steacher_${idx}_${tn}`;
  const teachFreeId = `steacher_free_${idx}_${tn}`;
  const teachWarnId = `steacher_warn_${idx}_${tn}`;
  const browserId   = `sgBrowser_${idx}_${tn}`;
  const searchResultId = `sgResults_${idx}_${tn}`;
  const participants = currentSession?.participants || [];

  const tabsHtml =
    `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',0,'${browserId}',this)">🗳 Votés</button>` +
    participants.map(u =>
      `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',${u.id},'${browserId}',this)">${esc(u.username)}</button>`
    ).join('') +
    `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',-1,'${browserId}',this)">🔍 BGG</button>`;

  const tutoUrl = (() => {
    const p = (currentSession?.proposals || []).find(x => x.name === gameName);
    return p?.tuto_url || '';
  })();

  return `<div data-table-block="${tn}" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px">
    <div class="form-label" style="margin-bottom:8px;color:var(--accent)">Table ${tn}${tn > 1 ? ' <span style="font-weight:normal;font-size:.7rem">(parallèle)</span>' : ''}</div>
    <div class="slot-edit-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Jeu sélectionné</label>
        <input class="form-input" id="${gameId}" value="${esc(gameName)}" placeholder="(rechercher ci-dessous)" style="background:var(--surface2)" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">Durée estimée</label>
        <div style="display:flex;gap:4px;align-items:center">
          <input class="form-input" type="number" id="${durId}" value="${durEst ?? ''}" style="max-width:75px" placeholder="min">
          <button class="btn-sm ghost" style="padding:4px 7px;font-size:.7rem" title="Estimer avec l'IA" onclick="estimateSlotDuration(${idx},${tn})">✨</button>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">🔍 Ajouter un jeu</label>
      <div class="collection-tabs" style="margin-bottom:6px">${tabsHtml}</div>
      <div id="${browserId}">
        <div style="font-size:.72rem;color:var(--text-muted);padding:4px">Clique sur un joueur pour voir sa collection, ou 🔍 BGG pour chercher.</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Joueurs</label>
      <div class="slot-players-wrap" id="${wrapId}">
        ${buildPlayersSelector(players, idx, tn)}
      </div>
    </div>
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">🎓 Teacher</label>
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" id="${teachSelId}" onchange="onTeacherChange(${idx},${tn})" style="flex:1">
          <option value="">Pas de teach (jeu connu)</option>
          ${buildTeacherOptions(players, teacher)}
        </select>
        <input class="form-input" id="${teachFreeId}" value="${esc(teacher)}" placeholder="Saisie libre…" style="max-width:140px"
          oninput="document.getElementById('${teachSelId}').value=''; onTeacherFreeInput(${idx},${tn})">
      </div>
      <div id="${teachWarnId}" style="font-size:.72rem;color:#e07070;margin-top:3px;display:none"></div>
    </div>
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">🎬 Vidéo tuto (URL)</label>
      <input class="form-input" id="stuto_${idx}_${tn}" value="${esc(tutoUrl)}" placeholder="youtube.com/watch?v=…" style="font-size:.8rem">
    </div>
    ${currentSession?.session?.is_convention ? `
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">👥 Joueurs min / max (convention)</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="form-input" type="number" id="sminp_${idx}_${tn}" value="${esc(String(table.min_players || ''))}" placeholder="min" style="max-width:70px">
        <span style="font-size:.8rem;color:var(--text-muted)">→</span>
        <input class="form-input" type="number" id="smaxp_${idx}_${tn}" value="${esc(String(table.max_players || ''))}" placeholder="max" style="max-width:70px">
      </div>
    </div>` : ''}
  </div>`;
}

function addTableToSlot(idx) {
  const slot = programmeSlots[idx];
  if (!slot.tables) slot.tables = [];
  const newNum = slot.tables.length + 1;
  const newTable = { table_number: newNum, game_name: '', players: '', teacher: '', duration_est: null, thumbnail: '' };
  slot.tables.push(newTable);
  const container = document.getElementById(`stablesEdit_${idx}`);
  if (container) {
    container.insertAdjacentHTML('beforeend', makeTableEditBlock(slot.tables.length - 1, newTable, slot, idx));
  }
  // Rafraîchir les boutons
  renderSlots();
}

function removeTableFromSlot(idx) {
  const slot = programmeSlots[idx];
  if (!slot.tables || slot.tables.length <= 1) return;
  slot.tables.pop();
  renderSlots();
}
function cancelEditSlot(idx) { toggleSlotEdit(idx, false); }
function toggleSlotEdit(idx, forceOpen) {
  const form = document.getElementById(`sedit_${idx}`);
  const btn = document.getElementById(`stoggle_${idx}`);
  if (!form) return;
  const open = forceOpen !== undefined ? forceOpen : form.style.display === 'none';
  form.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? '▾' : '▸';
}

async function saveSlot(idx) {
  const slot = programmeSlots[idx];
  slot.start_time = document.getElementById(`st_${idx}`).value.trim();
  slot.note       = document.getElementById(`sno_${idx}`).value.trim();
  slot.is_break   = document.getElementById(`sb_${idx}`).checked ? 1 : 0;

  // Lire chaque table depuis le DOM
  const tables = (slot.tables || []).map(t => {
    const tn = t.table_number;
    return {
      table_number: tn,
      game_name:    document.getElementById(`sn_${idx}_${tn}`)?.value.trim()   || '',
      players:      getSlotPlayers(idx, tn),
      teacher:      document.getElementById(`steacher_free_${idx}_${tn}`)?.value.trim() || document.getElementById(`steacher_${idx}_${tn}`)?.value || '',
      duration_est: document.getElementById(`sde_${idx}_${tn}`)?.value !== '' ? parseInt(document.getElementById(`sde_${idx}_${tn}`)?.value) || null : null,
      max_players:  document.getElementById(`smaxp_${idx}_${tn}`)?.value ? parseInt(document.getElementById(`smaxp_${idx}_${tn}`)?.value) || null : null,
      min_players:  document.getElementById(`sminp_${idx}_${tn}`)?.value ? parseInt(document.getElementById(`sminp_${idx}_${tn}`)?.value) || null : null,
      thumbnail:    t.thumbnail || '',
    };
  }).filter(t => t.game_name || slot.is_break);
  slot.tables = tables;

  // Vérification conflits
  const conflicts = checkTeacherConflicts(idx);
  if (conflicts.length) {
    if (!confirm('⚠ Conflits détectés :\n' + conflicts.join('\n') + '\n\nSauvegarder quand même ?')) return;
  }

  if (slot.id) {
    await api('PATCH', `/api/programme/slots/${slot.id}`, { ...slot, tables });
  } else {
    const r = await api('POST', '/api/programme/slots', { ...slot, tables, sessionId: currentSession.session.id, sort_order: idx });
    slot.id = r.id;
  }

  // Cascade horaires
  recalcSlotTimesFrom(idx);
  updateSlotView(idx);
  toggleSlotEdit(idx, false);
  for (const s of programmeSlots) {
    if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, { start_time: s.start_time, note: s.note, is_break: s.is_break, sort_order: programmeSlots.indexOf(s), tables: s.tables || [] });
  }

  // Sauvegarder tuto_url dans les proposals
  tables.forEach(t => {
    const tutoUrl = document.getElementById(`stuto_${idx}_${t.table_number}`)?.value.trim() || '';
    if (tutoUrl && t.game_name) {
      const p = currentSession.proposals?.find(x => x.name === t.game_name);
      if (p?.id) api('PATCH', `/api/proposals/${p.id}`, { ...p, tutoUrl });
    }
  });
}
function updateSlotView(idx) {
  const slot = programmeSlots[idx];
  const card = document.querySelector(`.slot-card[data-id="${slot.id}"]`);
  if (!card) return;
  const tables = slot.tables || [];
  const multiTable = tables.length > 1;
  const view = card.querySelector('.slot-view');
  if (!view) return;
  const timeEl = view.querySelector('.slot-time');
  const infoEl = view.querySelector('.slot-info');
  if (timeEl) timeEl.textContent = slot.start_time;
  if (infoEl) infoEl.innerHTML = slot.is_break
    ? `<div class="slot-name">☕ ${esc(tables[0]?.game_name || slot.note || 'Pause')}</div>`
    : `<div class="slot-tables">
        ${tables.map(t => `<div class="slot-table-block${multiTable ? ' slot-table-boxed' : ''}" style="display:flex;gap:8px;align-items:flex-start">
          ${t.thumbnail ? `<img src="${esc(t.thumbnail)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0">
            ${multiTable ? `<div class="table-badge">Table ${t.table_number}</div>` : ''}
            <div class="slot-name">${esc(t.game_name)}</div>
            <div class="slot-meta">${t.duration_est ? t.duration_est+'min · ' : ''}${esc(t.players)}${t.teacher ? ' · 🎓 '+esc(t.teacher) : ''}</div>
          </div>
        </div>`).join('')}
      </div>
      ${slot.note ? `<div class="slot-note">💬 ${esc(slot.note)}</div>` : ''}`;
}

async function deleteSlot(idx) {
  const slot = programmeSlots[idx];
  if (slot.id) await api('DELETE', `/api/programme/slots/${slot.id}`);
  programmeSlots.splice(idx, 1);
  renderSlots();
}

async function moveSlot(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= programmeSlots.length) return;
  [programmeSlots[idx], programmeSlots[newIdx]] = [programmeSlots[newIdx], programmeSlots[idx]];
  // Recalculer et afficher immédiatement
  recalcSlotTimes();
  renderSlots();
  // Sauvegarder en arrière-plan
  const reorder = programmeSlots.map((s, i) => ({ id: s.id, sort_order: i })).filter(s => s.id);
  if (reorder.length) api('PATCH', '/api/programme/reorder', { slots: reorder });
  for (const s of programmeSlots) {
    if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, s);
  }
}

async function bookTable(slotId, tableId) {
  const res = await api('POST', '/api/convention/book', { slotId, tableId });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Réservation enregistrée !');
  const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  conventionBookings = br.bookings || [];
  renderSlots();
}

async function cancelBooking(slotId) {
  if (!confirm('Annuler ta réservation ?')) return;
  await api('DELETE', '/api/convention/book', { slotId });
  showToast('Réservation annulée');
  const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  conventionBookings = br.bookings || [];
  renderSlots();
}

function cascadeTimeFrom(idx, newTime) {
  programmeSlots[idx].start_time = newTime;
  recalcSlotTimesFrom(idx);
}

function recalcSlotTimesFrom(fromIdx) {
  let cursor = programmeSlots[fromIdx].start_time;
  if (!cursor) return;
  for (let i = fromIdx; i < programmeSlots.length; i++) {
    const s = programmeSlots[i];
    s.start_time = cursor;
    const card = document.querySelector(`.slot-card[data-id="${s.id}"]`);
    if (card) {
      const timeEl = card.querySelector('.slot-time');
      if (timeEl) timeEl.textContent = cursor;
      const stInput = card.querySelector(`input[id^="st_"]`);
      if (stInput) stInput.value = cursor;
    }
    const slotDur = s.tables?.length
      ? Math.max(...s.tables.map(t => t.duration_est || 60))
      : (s.duration_est || s.duration_min || 60);
    cursor = addMinutes(cursor, slotDur);
  }
}

function recalcSlotTimes() {
  if (!programmeSlots.length) return;
  let cursor = null;
  for (const s of programmeSlots) {
    if (s.start_time && s.start_time.trim()) { cursor = s.start_time; break; }
  }
  if (!cursor) {
    const startInput = document.getElementById('progStart');
    cursor = startInput?.value?.trim() || '10:00';
  }

  for (let i = 0; i < programmeSlots.length; i++) {
    const s = programmeSlots[i];
    s.start_time = cursor;
    const card = document.querySelector(`.slot-card[data-id="${s.id}"]`);
    if (card) {
      const timeEl = card.querySelector('.slot-time');
      if (timeEl) timeEl.textContent = cursor;
      const stInput = card.querySelector(`input[id^="st_"]`);
      if (stInput) stInput.value = cursor;
    }
    const slotDur = s.tables?.length
      ? Math.max(...s.tables.map(t => t.duration_est || 60))
      : (s.duration_est || s.duration_min || 60);
    cursor = addMinutes(cursor, slotDur);
  }
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}

async function addSlot() {
  const newSlot = { start_time: '', game_name: '', duration_min: 60, players: 'tous', note: '', is_break: 0 };
  const r = await api('POST', '/api/programme/slots', { ...newSlot, sessionId: currentSession.session.id, sort_order: programmeSlots.length });
  newSlot.id = r.id;
  programmeSlots.push(newSlot);
  renderSlots();
  // Ouvrir le formulaire du dernier créneau
  setTimeout(() => toggleSlotEdit(programmeSlots.length - 1, true), 50);
}

// ═══════════════════════════════════════════════════
// SLOT GAME AUTOCOMPLETE + PLAYER SELECTOR
// ═══════════════════════════════════════════════════

function getSlotGameList() {
  // Propositions de la séance
  const fromProps = currentSession.proposals.map(p => ({ name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time, source: 'proposé' }));
  // Collections BGG de tous les participants
  const fromColl = [];
  for (const games of Object.values(userCollections)) {
    for (const g of games) {
      if (!fromColl.some(x => x.name.toLowerCase() === g.name.toLowerCase()))
        fromColl.push({ name: g.name, thumbnail: g.thumbnail, min_time: g.min_time, max_time: g.max_time, source: 'collection' });
    }
  }
  // Fusionner sans doublons
  const all = [...fromProps];
  for (const g of fromColl) {
    if (!all.some(x => x.name.toLowerCase() === g.name.toLowerCase())) all.push(g);
  }
  return all.sort((a,b) => a.name.localeCompare(b.name));
}

async function slotCollTab(gameId, resultId, nbId, durId, userId, browserId, btn) {
  // Activer onglet
  const tabs = btn.closest('.collection-tabs');
  if (tabs) tabs.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const browser = document.getElementById(browserId);
  if (!browser) return;

  function pickGame(g) {
    const gameInput = document.getElementById(gameId);
    if (gameInput) { gameInput.value = g.name; gameInput.removeAttribute('readonly'); }
    // Thumbnail caché — dérivé depuis gameId (sn_idx_tn -> sthumb_idx_tn)
    const thumbId = gameId.replace(/^sn_/, 'sthumb_');
    let thumbInput = document.getElementById(thumbId);
    if (!thumbInput) {
      thumbInput = document.createElement('input');
      thumbInput.type = 'hidden'; thumbInput.id = thumbId;
      gameInput?.parentElement?.appendChild(thumbInput);
    }
    thumbInput.value = g.thumbnail || '';
    if (g.min_time && g.min_time !== '0') {
      const durInput = document.getElementById(durId);
      if (durInput && !durInput.value) durInput.value = g.min_time;
    }
    showToast(`✅ ${g.name} sélectionné`);
  }

  function renderGames(games, filter) {
    const filtered = filter ? games.filter(g => g.name.toLowerCase().includes(filter.toLowerCase())) : games;
    if (!filtered.length) return '<div style="padding:8px;font-size:.75rem;color:var(--text-muted)">Aucun jeu</div>';
    return filtered.map(g => {
      const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
      const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
      return `<div class="coll-item slot-coll-item" data-name="${encodeURIComponent(g.name)}">
        ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
        <div class="coll-info"><div class="coll-name">${esc(g.name)}</div><div class="coll-meta">${[players,time, g.bgg_rating && `⭐ ${g.bgg_rating}`].filter(Boolean).join(' · ')}</div></div>
        <button class="coll-add">Choisir</button>
      </div>`;
    }).join('');
  }

  if (userId === 0) {
    // Mode jeux votés — propositions de la séance avec scores Borda
    const proposals = currentSession?.proposals || [];
    const rankings = currentSession?.rankings || [];
    const scores = {};
    proposals.forEach(p => scores[p.id] = 0);
    const rankingsByUser = {};
    rankings.forEach(r => {
      const key = `${r.user_id}_${r.category_id}`;
      if (!rankingsByUser[key]) rankingsByUser[key] = [];
      rankingsByUser[key].push(r);
    });
    Object.values(rankingsByUser).forEach(userRanks => {
      const n = userRanks.length;
      userRanks.forEach(r => { if (scores[r.proposal_id] !== undefined) scores[r.proposal_id] += (n - r.rank + 1); });
    });
    const sorted = [...proposals].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    browser.innerHTML = `<input type="text" class="collection-filter" id="sgVoteFilter_${browserId}" placeholder="Filtrer les jeux votés…" oninput="slotVoteFilter('${browserId}')">
      <div class="collection-list" id="sgVoteList_${browserId}"></div>`;
    browser._games = sorted.map(p => ({
      name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time,
      min_players: p.min_players, max_players: p.max_players, score: scores[p.id] || 0
    }));
    function renderVotedGames(games, filter) {
      const filtered = filter ? games.filter(g => g.name.toLowerCase().includes(filter.toLowerCase())) : games;
      return filtered.map(g => {
        const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
        const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
        return `<div class="coll-item slot-coll-item" data-name="${encodeURIComponent(g.name)}">
          ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
          <div class="coll-info"><div class="coll-name">${esc(g.name)}</div><div class="coll-meta">${[players,time].filter(Boolean).join(' · ')}${g.score ? ` · <span style="color:var(--accent)">${g.score}pts</span>` : ''}</div></div>
          <button class="coll-add">Choisir</button>
        </div>`;
      }).join('');
    }
    browser._renderGames = renderVotedGames;
    document.getElementById(`sgVoteList_${browserId}`).innerHTML = renderVotedGames(browser._games, '');
    browser._pickGame = pickGame;
    browser.addEventListener('click', e => {
      const btn = e.target.closest('.coll-add');
      if (!btn) return;
      const item = btn.closest('.slot-coll-item');
      const name = item?.dataset.name ? decodeURIComponent(item.dataset.name) : undefined;
      const g = (browser._games || []).find(x => x.name === name) || { name };
      browser._pickGame && browser._pickGame(g);
    });
    return;
  }

  if (userId === -1) {
    // Mode BGG
    browser.innerHTML = `
      <div class="bgg-search-row">
        <input type="text" class="collection-filter" id="sgBggInput_${browserId}" placeholder="Rechercher sur BoardGameGeek…" onkeydown="if(event.key==='Enter')slotBggSearch('${browserId}')">
        <button class="bgg-search-btn" onclick="slotBggSearch('${browserId}')">Chercher</button>
      </div>
      <div id="sgBggStatus_${browserId}" style="font-size:.72rem;color:var(--text-muted);padding:4px"></div>
      <div id="sgBggResults_${browserId}" class="collection-list"></div>`;
    // Stocker pickGame pour réutilisation
    browser._pickGame = pickGame;
    return;
  }

  // Mode collection joueur
  let games = userCollections[userId];
  if (!games) {
    browser.innerHTML = '<div style="padding:8px;font-size:.72rem;color:var(--text-muted)">⏳ Chargement…</div>';
    const r = await api('GET', `/api/bgg/collection/${userId}`);
    if (r.games) { userCollections[userId] = r.games; games = r.games; }
    else { browser.innerHTML = '<div style="padding:8px;font-size:.72rem;color:var(--text-muted)">Collection non disponible</div>'; return; }
  }

  browser.innerHTML = `
    <input type="text" class="collection-filter" id="sgFilter_${browserId}" placeholder="Filtrer (${games.length} jeux)…" oninput="slotCollFilter('${browserId}')">
    <div class="collection-list" id="sgList_${browserId}">${renderGames(games, '')}</div>`;
  browser._games = games;
  browser._pickGame = pickGame;
  browser._renderGames = renderGames;

  // Attacher les clics
  browser.addEventListener('click', e => {
    const btn = e.target.closest('.coll-add');
    if (!btn) return;
    const item = btn.closest('.slot-coll-item');
    const name = item?.dataset.name ? decodeURIComponent(item.dataset.name) : undefined;
    const g = (browser._games || []).find(x => x.name === name) ||
              (currentSession?.proposals || []).find(x => x.name === name) || { name };
    browser._pickGame && browser._pickGame(g);
  }, { once: false });
}

function canDoAction(action, ownerId = null) {
  if (!currentUser) return false;
  if (currentUser.is_admin) return true;
  const level = sitePermissions[action] ?? 0;
  if (level === 0) return true;
  if (level === 1) return ownerId != null && currentUser.id === ownerId;
  return false; // level 2 = admin only
}

function slotVoteFilter(browserId) {
  const browser = document.getElementById(browserId);
  const filter = document.getElementById(`sgVoteFilter_${browserId}`)?.value || '';
  const listEl = document.getElementById(`sgVoteList_${browserId}`);
  if (!listEl || !browser._games || !browser._renderGames) return;
  listEl.innerHTML = browser._renderGames(browser._games, filter);
}

function slotCollFilter(browserId) {
  const browser = document.getElementById(browserId);
  const filter = document.getElementById(`sgFilter_${browserId}`)?.value || '';
  const listEl = document.getElementById(`sgList_${browserId}`);
  if (!listEl || !browser._games || !browser._renderGames) return;
  listEl.innerHTML = browser._renderGames(browser._games, filter);
}

async function slotBggSearch(browserId) {
  const browser = document.getElementById(browserId);
  const q = document.getElementById(`sgBggInput_${browserId}`)?.value.trim();
  const statusEl = document.getElementById(`sgBggStatus_${browserId}`);
  const resultsEl = document.getElementById(`sgBggResults_${browserId}`);
  if (!q || !resultsEl) return;
  statusEl.textContent = '⏳ Recherche en cours…';
  resultsEl.innerHTML = '';
  const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (res.error) { statusEl.textContent = '⚠ ' + res.error; return; }
  if (!res.games?.length) { statusEl.textContent = 'Aucun résultat — essayez en anglais'; return; }
  statusEl.textContent = `${res.games.length} résultat(s)`;
  res.games.forEach(g => {
    const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
    const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
    const div = document.createElement('div');
    div.className = 'coll-item slot-coll-item';
    div.dataset.name = g.name;
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info"><div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div><div class="coll-meta">${[players,time].filter(Boolean).join(' · ')}</div></div>
      <button class="coll-add">Choisir</button>`;
    div.querySelector('.coll-add').addEventListener('click', () => {
      browser._pickGame && browser._pickGame(g);
    });
    resultsEl.appendChild(div);
  });
}

async function slotGameSearch(gameId, searchId, resultId, nbId, durId) {
  const thumbId = gameId.replace(/^sn_/, 'sthumb_');
  const q = document.getElementById(searchId)?.value.trim() || '';
  const resultEl = document.getElementById(resultId);
  if (!resultEl) return;

  resultEl.innerHTML = '';
  resultEl.style.display = 'block';

  function pickGame(g) {
    const gameInput = document.getElementById(gameId);
    if (gameInput) gameInput.value = g.name;
    // Sauvegarder thumbnail
    let thumbInput = document.getElementById(thumbId);
    if (!thumbInput) {
      thumbInput = document.createElement('input');
      thumbInput.type = 'hidden';
      thumbInput.id = thumbId;
      gameInput?.parentElement?.appendChild(thumbInput);
    }
    thumbInput.value = g.thumbnail || '';
    // Pré-remplir durée
    if (g.min_time && g.min_time !== '0') {
      const durInput = document.getElementById(durId);
      if (durInput && !durInput.value) durInput.value = g.min_time;
    }
    resultEl.style.display = 'none';
    const searchInput = document.getElementById(searchId);
    if (searchInput) searchInput.value = '';
  }

  function addItem(g, badge) {
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
    const div = document.createElement('div');
    div.className = 'coll-item';
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info">
        <div class="coll-name">${esc(g.name)}</div>
        <div class="coll-meta">${[players, time].filter(Boolean).join(' · ')}${badge ? ` <span style="color:var(--accent2);font-size:.6rem">${badge}</span>` : ''}</div>
      </div>
      <button class="coll-add">Choisir</button>
    `;
    div.querySelector('.coll-add').addEventListener('click', () => pickGame(g));
    resultEl.appendChild(div);
  }

  function addSection(title, items, badge) {
    if (!items.length) return;
    const header = document.createElement('div');
    header.style.cssText = 'font-size:.65rem;color:var(--text-muted);padding:4px 8px;background:var(--surface2);border-bottom:1px solid var(--border);font-weight:600';
    header.textContent = title;
    resultEl.appendChild(header);
    items.forEach(g => addItem(g, badge));
  }

  // Propositions de la séance
  const proposals = (currentSession?.proposals || [])
    .filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase()))
    .map(p => ({ name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time,
                 min_players: p.min_players, max_players: p.max_players }));
  addSection(`🗳 Propositions (${proposals.length})`, proposals, '');

  // Collections par joueur présent
  const participants = currentSession?.participants || [];
  for (const p of participants) {
    const coll = (userCollections[p.id] || [])
      .filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase()));
    if (coll.length) addSection(`📚 ${p.username} (${coll.length})`, coll, '');
  }

  if (!resultEl.children.length && !q) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px;font-size:.75rem;color:var(--text-muted)';
    empty.textContent = 'Collections non chargées — synchronisez les profils BGG';
    resultEl.appendChild(empty);
  }

  // Recherche BGG si query >= 2 chars
  if (q.length >= 2) {
    const loader = document.createElement('div');
    loader.style.cssText = 'font-size:.72rem;color:var(--text-muted);padding:8px;text-align:center';
    loader.textContent = '🌐 Recherche BGG en cours…';
    resultEl.appendChild(loader);
    try {
      const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
      if (resultEl.contains(loader)) resultEl.removeChild(loader);
      if (res.games?.length) addSection(`🌐 BGG (${res.games.length})`, res.games, '');
      if (!resultEl.children.length) {
        resultEl.innerHTML = '<div style="padding:8px;font-size:.75rem;color:var(--text-muted)">Aucun résultat</div>';
      }
    } catch(e) { if (resultEl.contains(loader)) resultEl.removeChild(loader); }
  }
}

function buildPlayersSelector(current, idx, tableNum) {
  const useAllSite = sitePermissions['players_scope'] !== 1;
  const allUsers = useAllSite
    ? (allSiteUsers.length ? allSiteUsers : (currentSession.participants || []))
    : (currentSession.participants || []);
  const currentList = current.split(',').map(s => s.trim()).filter(Boolean);
  const isTous = !current || current.toLowerCase() === 'tous';
  const inputId = `sp_${idx}_${tableNum}`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      <label class="priv-member-item">
        <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${tableNum}" value="tous" ${isTous ? 'checked' : ''}
          onchange="onSlotTousChange(this,${idx},${tableNum})"> Tous
      </label>
      ${allUsers.map(p => `
        <label class="priv-member-item">
          <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${tableNum}" value="${esc(p.username)}" ${!isTous && currentList.includes(p.username) ? 'checked' : ''}
            onchange="onSlotPlayerChange(this,${idx},${tableNum})"> ${esc(p.username)}
        </label>`).join('')}
    </div>
    <input class="form-input" id="${inputId}" value="${isTous ? 'tous' : esc(current)}" placeholder="Ou saisie libre…" style="font-size:.75rem"
      oninput="slotPlayerManualInput(this,${idx},${tableNum})">
  `;
}

function onSlotTousChange(cb, idx, tableNum) {
  if (cb.checked) {
    document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`).forEach(c => { if (c.value !== 'tous') c.checked = false; });
    const inp = document.getElementById(`sp_${idx}_${tableNum}`);
    if (inp) inp.value = 'tous';
  }
}

function onSlotPlayerChange(cb, idx, tableNum) {
  const tousCb = [...document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`)].find(c => c.value === 'tous');
  if (tousCb) tousCb.checked = false;
  const checked = [...document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}:checked`)].map(c => c.value).filter(v => v !== 'tous');
  const inp = document.getElementById(`sp_${idx}_${tableNum}`);
  if (inp) inp.value = checked.join(', ');
}

function slotPlayerManualInput(input, idx, tableNum) {
  const vals = input.value.split(',').map(s => s.trim().toLowerCase());
  const isTous = vals.includes('tous') || vals.join('') === '';
  document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`).forEach(cb => {
    if (cb.value === 'tous') cb.checked = isTous;
    else cb.checked = !isTous && vals.includes(cb.value.toLowerCase());
  });
}

function getSlotPlayers(idx, tableNum) {
  const inp = document.getElementById(`sp_${idx}_${tableNum}`);
  return inp?.value?.trim() || 'tous';
}

// ═══════════════════════════════════════════════════
// ESTIMATE DURATION
// ═══════════════════════════════════════════════════
async function estimateDuration() {
  const btn = document.getElementById('estimBtn');
  const output = document.getElementById('progOutput');
  const startTime = document.getElementById('progStart').value;
  const endTime = document.getElementById('progEnd').value;
  const hasLunch = document.getElementById('progLunch').checked;
  const lunchDur = parseInt(document.getElementById('progLunchDur').value) || 60;
  const nbPlayers = parseInt(document.getElementById('progNbPlayers')?.value) || currentSession.participants?.length || 4;

  btn.disabled = true;
  btn.textContent = '⏳ Analyse…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude évalue la durée…</span></div>`;

  const res = await api('POST', '/api/programme/estimate', {
    sessionId: currentSession.session.id,
    startTime, endTime, hasLunch, lunchDurationMinutes: lunchDur, nbPlayers
  });

  btn.disabled = false;
  btn.textContent = '⏱ Évaluer la durée de la séance';

  if (res.error) {
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">🔑 <strong>Clé API Anthropic non configurée</strong><br><span style="font-size:.8rem">${esc(res.message)}</span></div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }
  output.innerHTML = `<div class="prog-estimate">${res.html}</div>`;
}

// ═══════════════════════════════════════════════════

// ── VUE PROGRAMME CONVENTION (organisateur) ──────────────────

async function renderConventionProgramme() {
  const el = document.getElementById('panel-programme');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700;margin-bottom:16px">📋 Programme — Vue organisateur</div>
    <div id="convProgContent"><div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Chargement…</div></div>
  </div>`;

  await _loadConventionProgramme();
}

async function _loadConventionProgramme() {
  const content = document.getElementById('convProgContent');
  if (!content) return;

  const [progRes, bookRes] = await Promise.all([
    api('GET', `/api/sessions/${currentSession.session.id}/programme`),
    api('GET', `/api/sessions/${currentSession.session.id}/bookings`)
  ]);

  const slots = progRes.slots || [];
  const bookings = bookRes.bookings || [];

  if (!slots.length) {
    content.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu — ajoutez des jeux depuis l\'onglet Convention</div></div>';
    return;
  }

  // Grouper par jeu → tables → créneaux
  const byGame = {};
  for (const slot of slots) {
    if (slot.is_break) continue;
    for (const t of (slot.tables || [])) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) byGame[t.game_name] = { game_name: t.game_name, thumbnail: t.thumbnail, byTable: {} };
      const key = t.table_number;
      if (!byGame[t.game_name].byTable[key]) byGame[t.game_name].byTable[key] = [];
      const tableBookings = bookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
      byGame[t.game_name].byTable[key].push({ slot, table: t, tableBookings });
    }
  }

  content.innerHTML = Object.values(byGame).map(g => {
    const allEntries = Object.values(g.byTable).flat();
    const totalPlayers = allEntries.reduce((sum, e) => sum + e.tableBookings.length, 0);
    const gameId = `cprog_${g.game_name.replace(/\W/g,'_')}`;

    const tablesHtml = Object.entries(g.byTable).map(([tableNum, entries]) => {
      const tableId = `${gameId}_t${tableNum}`;

      const slotsHtml = entries.map(e => {
        const players = e.tableBookings;
        const count = `${players.length}${e.table.max_players ? '/'+e.table.max_players : ''} joueur${players.length !== 1 ? 's' : ''}`;
        const playersHtml = players.length
          ? players.map(b => `
            <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:2px 8px;font-size:.72rem;margin:2px">
              ${esc(b.username)}
              <button class="btn-icon" style="font-size:.6rem;padding:0 2px" title="Déplacer" onclick="openMovePlayer(${b.user_id},'${esc(b.username)}',${e.slot.id},${e.table.id},'${esc(g.game_name)}',${tableNum})">↕</button>
            </span>`).join('')
          : `<span style="font-size:.72rem;color:var(--text-muted);font-style:italic">Aucun joueur inscrit</span>`;

        return `<div style="padding:10px 14px 10px 24px;border-top:1px solid var(--border);background:var(--surface)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div>
              ${e.slot.start_time ? `<span style="color:var(--accent);font-weight:600;font-size:.8rem">${esc(e.slot.start_time)} · </span>` : ''}
              <span style="font-size:.78rem;color:var(--text-muted)">${count}</span>
            </div>
            <button class="btn-sm ghost" style="font-size:.65rem" onclick="addPlayerToSlot(${e.slot.id},${e.table.id},'${esc(g.game_name)}',${tableNum})">+ Ajouter</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:2px">${playersHtml}</div>
        </div>`;
      }).join('');

      const tablePlayers = entries.reduce((sum, e) => sum + e.tableBookings.length, 0);
      return `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--border);cursor:pointer;background:var(--surface2)"
             onclick="const d=document.getElementById('${tableId}');d.style.display=d.style.display==='none'?'block':'none';this.querySelector('.cp-chev').textContent=d.style.display==='none'?'▶':'▼'">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.82rem;font-weight:600">Table ${tableNum}</span>
            <span style="font-size:.72rem;color:var(--text-muted)">${tablePlayers} joueur${tablePlayers !== 1 ? 's' : ''}</span>
          </div>
          <span class="cp-chev" style="color:var(--text-muted);font-size:.75rem">▶</span>
        </div>
        <div id="${tableId}" style="display:none">${slotsHtml}</div>
      </div>`;
    }).join('');

    return `<div class="prog-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer"
           onclick="const d=document.getElementById('${gameId}');d.style.display=d.style.display==='none'?'block':'none';this.querySelector('.cp-chev').textContent=d.style.display==='none'?'▶':'▼'">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:44px;height:44px;background:var(--surface2);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${totalPlayers} joueur${totalPlayers !== 1 ? 's' : ''} inscrits · ${allEntries.length} créneau${allEntries.length !== 1 ? 'x' : ''}</div>
        </div>
        <span class="cp-chev" style="color:var(--text-muted)">▶</span>
      </div>
      <div id="${gameId}" style="display:none">${tablesHtml}</div>
    </div>`;
  }).join('');
}

async function addPlayerToSlot(slotId, tableId, gameName, tableNum) {
  const users = window._allUsers || [];
  const bookings = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  const alreadyBooked = (bookings.bookings || []).filter(b => b.slot_id === slotId).map(b => b.user_id);
  const available = users.filter(u => !alreadyBooked.includes(u.id));
  if (!available.length) { showToast('Tous les joueurs sont déjà inscrits sur ce créneau'); return; }
  const opts = available.map((u, i) => `${i+1}. ${u.username}`).join('\n');
  const choice = prompt(`Ajouter un joueur à "${gameName}" Table ${tableNum} :\n\n${opts}\n\nEntre le numéro :`);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= available.length) { showToast('Choix invalide'); return; }
  const user = available[idx];
  const res = await api('POST', '/api/convention/book', { slotId, tableId, userId: user.id });
  if (res.error) { showToast(res.error); return; }
  showToast(`✅ ${user.username} ajouté`);
  await _loadConventionProgramme();
}

async function openMovePlayer(userId, username, slotId, tableId, gameName, fromTableNum) {
  const progRes = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = progRes.slots || [];
  // Trouver les autres tables sur le même créneau pour ce jeu
  const targetSlot = slots.find(s => s.id === slotId);
  if (!targetSlot) return;
  const otherTables = (targetSlot.tables || []).filter(t => t.table_number !== fromTableNum && t.game_name === gameName);
  if (!otherTables.length) { showToast('Aucune autre table disponible sur ce créneau'); return; }
  const opts = otherTables.map((t, i) => `${i+1}. Table ${t.table_number}`).join('\n');
  const choice = prompt(`Déplacer ${username} vers :\n\n${opts}\n\nEntre le numéro :`);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= otherTables.length) { showToast('Choix invalide'); return; }
  const targetTable = otherTables[idx];
  // Annuler la réservation actuelle et créer une nouvelle
  await api('DELETE', '/api/convention/book', { slotId, userId });
  const res = await api('POST', '/api/convention/book', { slotId, tableId: targetTable.id, userId });
  if (res.error) { showToast(res.error); return; }
  showToast(`✅ ${username} déplacé vers Table ${targetTable.table_number}`);
  await _loadConventionProgramme();
}
// ─────────────────────────────────────────────────────────────
// doodle.js — Sondages de disponibilité (type Doodle)
//
// Contient :
//   - loadDoodlePage()         Charge la liste des sondages ouverts
//   - createDoodle()           Crée un nouveau sondage avec des dates proposées
//   - openDoodle(token)        Ouvre un sondage existant
//   - renderDoodleDetail()     Affiche un sondage avec les votes
//   - submitDoodleVotes()      Soumet les votes oui/non/peut-être
//   - validateDoodleDate()     Valide une date et crée une séance GameDay
//   - toggleDoodle()           Ouvre/ferme un sondage
// ─────────────────────────────────────────────────────────────

// DOODLE
// ═══════════════════════════════════════════════════

let _doodleSelectedDates = [];
let _currentDoodle = null;
let _doodleVotes = {}; // { dateId: 'yes'|'no'|'maybe' }

function showDoodleCreate() {
  _doodleSelectedDates = [];
  document.getElementById('doodleTitle').value = '';
  document.getElementById('doodleDatePicker').value = '';
  document.getElementById('doodleSelectedDates').innerHTML = '';
  document.getElementById('doodleCreateForm').style.display = 'block';
  document.getElementById('doodleList').style.display = 'none';
  document.getElementById('doodleDetail').style.display = 'none';
}

function hideDoodleCreate() {
  document.getElementById('doodleCreateForm').style.display = 'none';
  document.getElementById('doodleList').style.display = 'block';
}

function doodleAddDate(val) {
  if (!val || _doodleSelectedDates.includes(val)) return;
  _doodleSelectedDates.push(val);
  _doodleSelectedDates.sort();
  renderDoodleSelectedDates();
  document.getElementById('doodleDatePicker').value = '';
}

function doodleRemoveDate(val) {
  _doodleSelectedDates = _doodleSelectedDates.filter(d => d !== val);
  renderDoodleSelectedDates();
}

function renderDoodleSelectedDates() {
  const el = document.getElementById('doodleSelectedDates');
  el.innerHTML = _doodleSelectedDates.map(d => {
    const label = new Date(d+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    return `<span class="doodle-date-tag">${label}<button onclick="doodleRemoveDate('${d}')">✕</button></span>`;
  }).join('');
}

async function createDoodle() {
  const title = document.getElementById('doodleTitle').value.trim();
  if (!title) { showToast('Donne un titre au sondage'); return; }
  if (!_doodleSelectedDates.length) { showToast('Sélectionne au moins une date'); return; }
  const res = await api('POST', '/api/doodles', { title, dates: _doodleSelectedDates });
  if (res.error) { showToast('Erreur création : ' + res.error); return; }
  if (!res.token) { showToast('Erreur inattendue — pas de token reçu'); return; }
  hideDoodleCreate();
  await loadDoodlePage();
  openDoodle(res.token);
}

async function loadDoodlePage() {
  const res = await api('GET', '/api/doodles');
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  const list = document.getElementById('doodleList');
  list.style.display = 'block';
  document.getElementById('doodleDetail').style.display = 'none';
  if (!res.doodles?.length) {
    list.innerHTML = '<div class="empty"><span class="empty-icon">📅</span><div class="empty-label">Aucun sondage — crée le premier !</div></div>';
    return;
  }
  list.innerHTML = res.doodles.map(d => {
    const date = new Date(d.created_at).toLocaleDateString('fr-FR');
    const badge = d.closed ? '<span class="doodle-badge closed">Clôturé</span>' : '<span class="doodle-badge open">Ouvert</span>';
    const sessionLink = d.session_id ? `<span style="font-size:.7rem;color:var(--accent)"> → séance créée</span>` : '';
    return `<div class="doodle-card" onclick="openDoodle('${d.token}')">
      <div class="doodle-card-title">${esc(d.title)}${badge}${sessionLink}</div>
      <div class="doodle-card-meta">Par ${esc(d.creator)} · ${date}</div>
    </div>`;
  }).join('');
}

async function openDoodle(token) {
  const res = await api('GET', `/api/doodles/${token}`);
  if (res.error) { showToast(res.error); return; }
  _currentDoodle = res;
  // Pré-remplir mes votes
  _doodleVotes = {};
  res.votes.filter(v => v.user_id === currentUser.id).forEach(v => {
    _doodleVotes[String(v.date_id)] = v.answer;
  });
  document.getElementById('doodleList').style.display = 'none';
  document.getElementById('doodleCreateForm').style.display = 'none';
  renderDoodleDetail();
}

function renderDoodleDetail() {
  const { doodle, dates, votes, voters } = _currentDoodle;
  const el = document.getElementById('doodleDetail');
  el.style.display = 'block';

  const isOwner = doodle.created_by === currentUser.id || currentUser.is_admin;
  const isClosed = !!doodle.closed;

  // Calculer les totaux par date
  const totals = {};
  dates.forEach(d => { totals[d.id] = { yes:0, maybe:0, no:0 }; });
  votes.forEach(v => { if (totals[v.date_id]) totals[v.date_id][v.answer]++; });
  const maxYes = Math.max(...dates.map(d => totals[d.id].yes));

  // Construire la grille
  const dateHeaders = dates.map(d => {
    const label = new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
    const isBest = totals[d.id].yes === maxYes && maxYes > 0;
    return `<th class="date-col${isBest?' doodle-best':''}">${label}</th>`;
  }).join('');

  // Ligne de mon vote — toujours éditable (même si clôturé)
  const myRow = `<tr class="my-row">
    <td class="name-col">👤 ${esc(currentUser.username)} <span style="font-size:.65rem;color:var(--accent)">(toi)</span></td>
    ${dates.map(d => {
      const cur = _doodleVotes[String(d.id)] || 'no';
      return `<td>${['yes','maybe','no'].map(a => {
        const emoji = a==='yes'?'✅':a==='maybe'?'🤷':'❌';
        const sel = cur===a?` selected-${a}`:'';
        return `<button class="doodle-answer${sel}" onclick="doodleSetVote(${d.id},'${a}',this)">${emoji}</button>`;
      }).join('')}</td>`;
    }).join('')}
  </tr>`;

  // Lignes des autres votants
  const otherRows = voters.filter(v => v !== currentUser.username).map(voter => {
    const cells = dates.map(d => {
      const v = votes.find(x => x.username === voter && x.date_id === d.id);
      const emoji = !v ? '—' : v.answer==='yes'?'✅':v.answer==='maybe'?'🤷':'❌';
      return `<td>${emoji}</td>`;
    }).join('');
    return `<tr><td class="name-col">${esc(voter)}</td>${cells}</tr>`;
  }).join('');

  // Ligne totaux
  const totalRow = `<tr class="total-row">
    <td class="name-col">Total ✅</td>
    ${dates.map(d => `<td class="${totals[d.id].yes===maxYes&&maxYes>0?'doodle-best':''}">${totals[d.id].yes}✅ ${totals[d.id].maybe>0?totals[d.id].maybe+'🤷':''}</td>`).join('')}
  </tr>`;

  const shareUrl = `${location.origin}/doodle/${doodle.token}`;

  el.innerHTML = `
    <div style="padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn-sm ghost" onclick="backToDoodleList()">← Retour</button>
        <div style="flex:1"></div>
        ${isOwner && isClosed ? `<button class="btn-sm accent" onclick="toggleDoodle('${doodle.token}', false)">🔓 Rouvrir le sondage</button>` : ''}
        ${isOwner && !isClosed ? `<button class="btn-sm warning" onclick="toggleDoodle('${doodle.token}', true)">🔒 Clôturer le sondage</button>` : ''}
        ${isOwner ? `<button class="btn-sm danger" onclick="deleteDoodle('${doodle.token}')">🗑 Supprimer</button>` : ''}
      </div>
      <div class="doodle-detail-header">
        <div>
          <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1rem;font-weight:700;margin-bottom:2px">${esc(doodle.title)}
            ${isClosed ? '<span class="doodle-badge closed">Clôturé</span>' : '<span class="doodle-badge open">Ouvert</span>'}
          </div>
          <div style="font-size:.72rem;color:var(--text-muted)">Par ${esc(doodle.creator)} · ${voters.length} participant${voters.length>1?'s':''}</div>
        </div>
        
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        ${isOwner && !isClosed ? `<button class="btn-sm accent" style="background:var(--green-text,#6fcf97);color:#fff" onclick="showValidatePicker()">✅ Valider une date</button>` : ''}
        ${isOwner && !isClosed && maxYes > 0 ? (() => {
          const bestDate = dates.find(d => totals[d.id].yes === maxYes);
          const bestLabel = new Date(bestDate.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
          return `<button class="btn-sm accent" style="background:#2d6a4f;color:#fff" onclick="quickCreateSession(${bestDate.id},'${esc(doodle.title)}')">🎉 Créer séance — ${bestLabel} (${maxYes}✅)</button>`;
        })() : ''}
      </div>
      <div id="doodleValidatePicker" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px">
        <div class="form-label" style="margin-bottom:8px">Choisir la date retenue :</div>
        <select class="form-input" id="doodleDateSelect" style="margin-bottom:10px">
          ${dates.map(d => {
            const label = new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
            const yes = totals[d.id].yes;
            return `<option value="${d.id}" data-date="${d.date}">${label} — ${yes} ✅</option>`;
          }).join('')}
        </select>
        <div class="form-group">
          <label class="form-label">Nom de la séance</label>
          <input class="form-input" id="doodleSessionName" value="${esc(doodle.title)}" placeholder="Nom de la séance">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-sm ghost" onclick="document.getElementById('doodleValidatePicker').style.display='none'">Annuler</button>
          <button class="btn-sm accent" onclick="confirmValidateDoodle()">🎉 Créer la séance</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="doodle-grid">
          <thead><tr><th></th>${dateHeaders}</tr></thead>
          <tbody>${myRow}${otherRows}${totalRow}</tbody>
        </table>
      </div>
      <div style="margin-top:10px">
        <button class="btn-sm accent" onclick="submitDoodleVotes()">💾 Enregistrer mes réponses</button>
      </div>
      ${doodle.session_id ? `<div style="margin-top:12px;font-size:.8rem;color:var(--accent)">✅ Séance créée — <a href="#" onclick="loadSession(${doodle.session_id});showPage('page-session');return false">ouvrir la séance</a></div>` : ''}
      ${isClosed && !isOwner ? '' : !isClosed ? '' : ''}
    </div>
  `;
}

function doodleSetVote(dateId, answer, btn) {
  _doodleVotes[String(dateId)] = answer;
  // Mettre à jour visuellement les 3 boutons de cette date
  const cell = btn.closest('td');
  cell.querySelectorAll('.doodle-answer').forEach(b => {
    b.className = 'doodle-answer';
  });
  btn.className = `doodle-answer selected-${answer}`;
}

async function submitDoodleVotes() {
  const token = _currentDoodle.doodle.token;
  const res = await api('POST', `/api/doodles/${token}/vote`, { answers: _doodleVotes });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Votes enregistrés !');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  votes_backup = _doodleVotes;
  renderDoodleDetail();
  _doodleVotes = votes_backup;
}

async function quickCreateSession(dateId, defaultName) {
  const name = prompt('Nom de la séance :', defaultName);
  if (name === null) return;
  await validateDoodleDate(dateId, name || defaultName);
}

function showValidatePicker() {
  document.getElementById('doodleValidatePicker').style.display = 'block';
}

async function confirmValidateDoodle() {
  const select = document.getElementById('doodleDateSelect');
  const dateId = parseInt(select.value);
  const sessionName = document.getElementById('doodleSessionName').value.trim() || _currentDoodle.doodle.title;
  await validateDoodleDate(dateId, sessionName);
  document.getElementById('doodleValidatePicker').style.display = 'none';
}

async function validateDoodleDate(dateId, sessionName) {
  const token = _currentDoodle.doodle.token;
  const res = await api('POST', `/api/doodles/${token}/validate`, { dateId, sessionName });
  if (res.error) { showToast(res.error); return; }
  showToast('🎉 Séance créée !');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  renderDoodleDetail();
  // Recharger les séances sur la page d'accueil
  loadHome();
}

async function toggleDoodle(token, close) {
  const res = await api('PATCH', `/api/doodles/${token}/toggle`, { closed: close });
  if (res.error) { showToast(res.error); return; }
  showToast(close ? '🔒 Sondage clôturé' : '🔓 Sondage rouvert');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  renderDoodleDetail();
}

async function deleteDoodle(token) {
  if (!confirm('Supprimer ce sondage ?')) return;
  await api('DELETE', `/api/doodles/${token}`);
  backToDoodleList();
}

function backToDoodleList() {
  document.getElementById('doodleDetail').style.display = 'none';
  document.getElementById('doodleList').style.display = 'block';
  _currentDoodle = null;
}// ─────────────────────────────────────────────────────────────
// convention.js — Panneau de gestion des jeux en mode convention
//
// Contient :
//   - renderConventionPanel()   Affiche le panneau convention
//   - addConventionGame()       Ajoute un jeu avec ses tables/créneaux
//   - removeConventionSlot()    Supprime un créneau/table
// ─────────────────────────────────────────────────────────────

// CONVENTION PANEL
// ═══════════════════════════════════════════════════

async function renderConventionPanel() {
  const el = document.getElementById('panel-convention');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700">🎪 Jeux de la convention</div>
      <button class="btn-sm accent" onclick="openAddConventionGame()">+ Ajouter un jeu</button>
    </div>
    <div id="convGameForm" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px"></div>
    <div id="convGamesList"></div>
  </div>`;

  await loadConventionGames();
}

async function loadConventionGames() {
  const el = document.getElementById('convGamesList');
  if (!el) return;

  // Récupérer les slots du programme avec leurs tables
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = r.slots || [];

  if (!slots.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu ajouté — commence par ajouter un jeu</div></div>';
    return;
  }

  // Grouper les slots par jeu (nom du jeu de la table 1)
  const byGame = {};
  for (const slot of slots) {
    const tables = slot.tables || [];
    for (const t of tables) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) byGame[t.game_name] = { tables: [], game_name: t.game_name, thumbnail: t.thumbnail, min_players: t.min_players, max_players: t.max_players, bgg_id: t.bgg_id || '', myludo_url: t.myludo_url || '' };
      byGame[t.game_name].tables.push({ slot, table: t });
    }
  }

  if (!Object.keys(byGame).length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu configuré</div></div>';
    return;
  }

  el.innerHTML = Object.values(byGame).map(g => {
    const nbTables = new Set(g.tables.map(x => x.slot.id + '-' + x.table.table_number)).size;
    const slots = g.tables.map(x => x.slot);
    const uniqueSlots = [...new Map(slots.map(s => [s.id, s])).values()];
    const capacity = g.max_players ? `${g.min_players || 1}–${g.max_players} joueurs` : '';

    return `<div class="prog-card" style="margin-bottom:12px">
      <div class="prog-card-header" style="display:flex;align-items:center;gap:10px">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">` : ''}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${nbTables} table${nbTables > 1 ? 's' : ''} · ${uniqueSlots.length} créneau${uniqueSlots.length > 1 ? 'x' : ''}${capacity ? ' · ' + capacity : ''}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
            ${g.bgg_id ? `<a class="ext-btn" href="https://boardgamegeek.com/boardgame/${esc(g.bgg_id)}" target="_blank" rel="noopener">🌐 BGG</a>` : ''}
            ${g.myludo_url ? `<a class="ext-btn" href="${esc(g.myludo_url)}" target="_blank" rel="noopener">🎲 MyLudo</a>` : ''}
          </div>
        </div>
        <button class="btn-sm ghost" style="font-size:.72rem" onclick="removeConventionGame('${esc(g.game_name)}')">✕ Retirer</button>
      </div>
      <div class="prog-card-body" style="padding:10px 14px">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${uniqueSlots.map(s => `
            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:.75rem">
              ${s.start_time ? `<span style="color:var(--accent);font-weight:600">${esc(s.start_time)} · </span>` : ''}Créneau ${uniqueSlots.indexOf(s) + 1}
              <button class="btn-icon" style="margin-left:6px;font-size:.65rem" onclick="removeConventionSlot(${s.id})">✕</button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAddConventionGame() {
  const form = document.getElementById('convGameForm');
  if (!form) return;
  form.style.display = 'block';
  form.innerHTML = `
    <div class="section-label" style="margin-bottom:12px">➕ Nouveau jeu</div>
    <div class="form-group">
      <label class="form-label">Rechercher sur BGG</label>
      <input class="form-input" id="convBggSearch" placeholder="Tapez le nom du jeu…" oninput="convSearchDebounce()" onkeydown="if(event.key==='Enter')convSearchBGG()" style="flex:1">
      <div id="convBggStatus" style="font-size:.72rem;color:var(--text-muted);margin-top:4px"></div>
      <div id="convBggResults" style="margin-top:6px;max-height:220px;overflow-y:auto"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Jeu sélectionné</label>
      <input class="form-input" id="convGameName" placeholder="Ou saisie libre…">
      <input type="hidden" id="convGameThumb">
      <input type="hidden" id="convGameBggId">
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Nb tables</label>
        <input class="form-input" type="number" id="convNbTables" value="1" min="1" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Nb créneaux</label>
        <input class="form-input" type="number" id="convNbSlots" value="1" min="1" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Min joueurs</label>
        <input class="form-input" type="number" id="convMinP" placeholder="—" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Max joueurs</label>
        <input class="form-input" type="number" id="convMaxP" placeholder="—" style="max-width:80px">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">🔗 Lien MyLudo (optionnel)</label>
      <input class="form-input" id="convMyLudo" placeholder="myludo.fr/#!/game/…">
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-sm ghost" onclick="document.getElementById('convGameForm').style.display='none'">Annuler</button>
      <button class="btn-sm accent" onclick="addConventionGame()">✅ Créer les tables</button>
    </div>
  `;
}

let _convSearchTimer = null;
function convSearchDebounce() {
  clearTimeout(_convSearchTimer);
  const q = document.getElementById('convBggSearch')?.value.trim();
  if (!q || q.length < 2) {
    const results = document.getElementById('convBggResults');
    if (results) results.innerHTML = '';
    return;
  }
  _convSearchTimer = setTimeout(convSearchBGG, 400);
}

async function convSearchBGG() {
  const q = document.getElementById('convBggSearch')?.value.trim();
  const status = document.getElementById('convBggStatus');
  const results = document.getElementById('convBggResults');
  if (!q || !status || !results) return;

  status.textContent = '⏳ Recherche…';
  results.innerHTML = '';

  const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (res.error) { status.textContent = '⚠ ' + res.error; return; }
  if (!res.games?.length) { status.textContent = 'Aucun résultat — essayez en anglais'; return; }

  status.textContent = `${res.games.length} résultat(s)`;
  results.innerHTML = res.games.slice(0, 12).map((g, i) => {
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`) : '';
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}–${g.max_time}min`) : '';
    return `<div class="coll-item" style="cursor:pointer"
         data-name="${esc(g.name)}"
         data-thumb="${esc(g.thumbnail||'')}"
         data-bggid="${esc(g.bgg_id||'')}"
         data-minp="${esc(String(g.min_players||''))}"
         data-maxp="${esc(String(g.max_players||''))}"
         onclick="convPickFromResult(this)">
      ${g.thumbnail ? `<img class="coll-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'">` : '<div class="coll-thumb-ph">🎲</div>'}
      <div class="coll-info">
        <div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div>
        <div class="coll-meta">${[players && `👥 ${players}`, time && `⏱ ${time}`, g.bgg_rating && `⭐ ${g.bgg_rating}`].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="coll-add">Choisir</button>
    </div>`;
  }).join('');
}

function convPickFromResult(el) {
  const wrap = el.closest('[data-name]');
  if (!wrap) return;
  convPickGame(wrap.dataset.name, wrap.dataset.thumb, wrap.dataset.bggid, wrap.dataset.minp, wrap.dataset.maxp);
}

function convPickGame(name, thumb, bggId, minPlayers, maxPlayers) {
  const nameInput = document.getElementById('convGameName');
  const thumbInput = document.getElementById('convGameThumb');
  const bggIdInput = document.getElementById('convGameBggId');
  if (nameInput) nameInput.value = name;
  if (thumbInput) thumbInput.value = thumb || '';
  if (bggIdInput) bggIdInput.value = bggId || '';
  const minEl = document.getElementById('convMinP');
  const maxEl = document.getElementById('convMaxP');
  if (minEl && minPlayers && !minEl.value) minEl.value = minPlayers;
  if (maxEl && maxPlayers && !maxEl.value) maxEl.value = maxPlayers;
  const results = document.getElementById('convBggResults');
  if (results) results.innerHTML = `<div style="font-size:.78rem;color:var(--accent);padding:4px 0">✅ ${esc(name)} sélectionné</div>`;
}

async function addConventionGame() {
  const name = document.getElementById('convGameName')?.value.trim();
  const thumb = document.getElementById('convGameThumb')?.value || '';
  const bggId = document.getElementById('convGameBggId')?.value || '';
  const myLudo = document.getElementById('convMyLudo')?.value.trim() || '';
  const nbTables = parseInt(document.getElementById('convNbTables')?.value) || 1;
  const nbSlots = parseInt(document.getElementById('convNbSlots')?.value) || 1;
  const minP = parseInt(document.getElementById('convMinP')?.value) || null;
  const maxP = parseInt(document.getElementById('convMaxP')?.value) || null;

  if (!name) { showToast('Renseigne le nom du jeu'); return; }

  for (let s = 0; s < nbSlots; s++) {
    const tables = [];
    for (let t = 1; t <= nbTables; t++) {
      tables.push({
        table_number: t,
        game_name: name,
        players: '',
        teacher: '',
        duration_est: null,
        thumbnail: thumb,
        bgg_id: bggId,
        myludo_url: myLudo,
        min_players: minP,
        max_players: maxP
      });
    }
    await api('POST', '/api/programme/slots', {
      sessionId: currentSession.session.id,
      start_time: '',
      note: '',
      is_break: 0,
      sort_order: 999,
      tables
    });
  }

  showToast(`✅ ${nbSlots} créneau${nbSlots > 1 ? 'x' : ''} créé${nbSlots > 1 ? 's' : ''} pour "${name}"`);
  document.getElementById('convGameForm').style.display = 'none';
  await loadConventionGames();
}

async function removeConventionSlot(slotId) {
  if (!confirm('Supprimer ce créneau et ses réservations ?')) return;
  await api('DELETE', `/api/programme/slots/${slotId}`);
  showToast('Créneau supprimé');
  await loadConventionGames();
}

async function removeConventionGame(gameName) {
  if (!confirm(`Supprimer tous les créneaux de "${gameName}" ?`)) return;
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = r.slots || [];
  const toDelete = slots.filter(s => (s.tables || []).some(t => t.game_name === gameName));
  await Promise.all(toDelete.map(s => api('DELETE', `/api/programme/slots/${s.id}`)));
  showToast(`"${gameName}" supprimé`);
  await loadConventionGames();
}

// ═══════════════════════════════════════════════════
// PANNEAU RÉSERVATIONS (vue participant)

async function renderReservationsPanel() {
  const el = document.getElementById('panel-reservations');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700;margin-bottom:16px">🎫 Réservations</div>
    <div id="resvContent"><div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Chargement…</div></div>
  </div>`;

  await _loadReservationsContent();
}

async function _loadReservationsContent() {
  const content = document.getElementById('resvContent');
  if (!content) return;

  const [progRes, bookRes] = await Promise.all([
    api('GET', `/api/sessions/${currentSession.session.id}/programme`),
    api('GET', `/api/sessions/${currentSession.session.id}/bookings`)
  ]);

  const slots = progRes.slots || [];
  const bookings = bookRes.bookings || [];

  if (!slots.length) {
    content.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu programmé pour l\'instant</div></div>';
    return;
  }

  // Grouper par jeu → tables → créneaux
  const byGame = {};
  for (const slot of slots) {
    if (slot.is_break) continue;
    for (const t of (slot.tables || [])) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) {
        byGame[t.game_name] = { game_name: t.game_name, thumbnail: t.thumbnail, min_players: t.min_players, max_players: t.max_players, byTable: {} };
      }
      const key = t.table_number;
      if (!byGame[t.game_name].byTable[key]) byGame[t.game_name].byTable[key] = [];
      const tableBookings = bookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
      const myBooking = tableBookings.find(b => b.user_id === currentUser.id);
      const mySlotBooking = bookings.find(b => b.slot_id === slot.id && b.user_id === currentUser.id);
      const isFull = t.max_players && tableBookings.length >= t.max_players;
      byGame[t.game_name].byTable[key].push({ slot, table: t, tableBookings, myBooking, mySlotBooking, isFull });
    }
  }

  content.innerHTML = Object.values(byGame).map(g => {
    const allEntries = Object.values(g.byTable).flat();
    const totalDispo = allEntries.filter(e => !e.isFull && !e.mySlotBooking).length;
    const hasMyBooking = allEntries.some(e => e.myBooking);
    const allFull = allEntries.every(e => e.isFull);
    const statusDot = hasMyBooking ? '🟡' : allFull ? '🔴' : '🟢';
    const statusText = hasMyBooking ? 'Inscrit' : allFull ? 'Complet' : `${totalDispo} place${totalDispo !== 1 ? 's' : ''} dispo`;
    const capacity = g.max_players ? `👥 ${g.min_players||1}–${g.max_players}` : '';
    const gameId = `game_${esc(g.game_name).replace(/\s+/g,'_')}`;

    const tablesHtml = Object.entries(g.byTable).map(([tableNum, entries]) => {
      const tableDispo = entries.filter(e => !e.isFull).length;
      const tableMyBooking = entries.find(e => e.myBooking);
      const tableFull = entries.every(e => e.isFull);
      const tableDot = tableMyBooking ? '🟡' : tableFull ? '🔴' : '🟢';
      const tableStatus = tableMyBooking ? 'Inscrit' : tableFull ? 'Complet' : `${tableDispo} créneau${tableDispo !== 1 ? 'x' : ''} dispo`;
      const tableId = `${gameId}_t${tableNum}`;

      const slotsHtml = entries.map(e => {
        const count = `${e.tableBookings.length}${e.table.max_players ? '/'+e.table.max_players : ''} joueur${e.tableBookings.length !== 1 ? 's' : ''}`;
        let actionHtml;
        if (e.myBooking) {
          actionHtml = `<span style="color:#4caf50;font-size:.75rem">✅ Inscrit</span>
            <button class="btn-sm ghost" style="font-size:.68rem" onclick="cancelBookingAndRefresh(${e.slot.id})">Annuler</button>`;
        } else if (e.mySlotBooking) {
          actionHtml = `<span style="font-size:.72rem;color:var(--text-muted)">⛔ Déjà inscrit ce créneau</span>`;
        } else if (e.isFull) {
          actionHtml = `<span style="font-size:.72rem;color:var(--text-muted)">🔒 Complet</span>`;
        } else {
          actionHtml = `<button class="btn-sm accent" style="font-size:.75rem" onclick="bookTableAndRefresh(${e.slot.id},${e.table.id})">Réserver</button>`;
        }
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px 8px 32px;border-top:1px solid var(--border);gap:8px;flex-wrap:wrap;background:var(--surface)">
          <div>
            ${e.slot.start_time ? `<span style="color:var(--accent);font-weight:600;font-size:.8rem">${esc(e.slot.start_time)} · </span>` : ''}
            <span style="font-size:.8rem;color:var(--text-muted)">${count}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">${actionHtml}</div>
        </div>`;
      }).join('');

      return `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer;background:var(--surface2)"
             onclick="document.getElementById('${tableId}').style.display=document.getElementById('${tableId}').style.display==='none'?'block':'none';this.querySelector('.resv-chevron').textContent=document.getElementById('${tableId}').style.display==='none'?'▶':'▼'">
          <div style="display:flex;align-items:center;gap:8px">
            <span>${tableDot}</span>
            <span style="font-size:.82rem;font-weight:600">Table ${tableNum}</span>
            <span style="font-size:.72rem;color:var(--text-muted)">${tableStatus}</span>
          </div>
          <span class="resv-chevron" style="color:var(--text-muted);font-size:.75rem">▶</span>
        </div>
        <div id="${tableId}" style="display:none">${slotsHtml}</div>
      </div>`;
    }).join('');

    return `<div class="prog-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer"
           onclick="document.getElementById('${gameId}').style.display=document.getElementById('${gameId}').style.display==='none'?'block':'none';this.querySelector('.resv-chevron').textContent=document.getElementById('${gameId}').style.display==='none'?'▶':'▼'">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:44px;height:44px;background:var(--surface2);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${[capacity, statusDot+' '+statusText].filter(Boolean).join(' · ')}</div>
        </div>
        <span class="resv-chevron" style="color:var(--text-muted)">▶</span>
      </div>
      <div id="${gameId}" style="display:none">${tablesHtml}</div>
    </div>`;
  }).join('');
}

async function bookTableAndRefresh(slotId, tableId) {
  const res = await api('POST', '/api/convention/book', { slotId, tableId });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Réservation enregistrée !');
  await _loadReservationsContent();
}

async function cancelBookingAndRefresh(slotId) {
  if (!confirm('Annuler ta réservation ?')) return;
  await api('DELETE', '/api/convention/book', { slotId });
  showToast('Réservation annulée');
  await _loadReservationsContent();
}
// ─────────────────────────────────────────────────────────────
// archive.js — Panel "Archive" : compte-rendu, médias, scores, stats
//
// Contient :
//   - renderArchivePanel()      Affiche le panel archive d'une séance
//   - renderArchiveGames()      Liste les parties jouées avec leurs scores
//   - openArchiveGameForm()     Formulaire d'ajout/édition d'une partie
//   - saveArchiveGame()         Sauvegarde une partie via API
//   - renderSessionMedia()      Affiche les photos et vidéos de la séance
//   - handlePhotoFiles()        Upload de photos/vidéos
//   - saveArchiveCR()           Sauvegarde le compte-rendu texte
//   - loadStats(year)           Charge et affiche les statistiques annuelles
// ─────────────────────────────────────────────────────────────

// ARCHIVE
// ═══════════════════════════════════════════════════

let archiveData = null;

async function renderArchivePanel() {
  const el = document.getElementById('panel-archive');
  el.innerHTML = '<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Chargement…</span></div>';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  el.innerHTML = `
    <div class="prog-card">
      <div class="prog-card-header">
        <div class="prog-card-title">📚 Archive de la séance</div>
        <a class="btn-sm accent" href="/archive/${currentSession.session.id}" target="_blank" style="font-weight:600;margin-left:32px">🌐 Page publique</a>
      </div>
      <div class="prog-card-body">

        <!-- CR général + Médias séance — accordéon unique -->
        <div class="arch-accordion" id="archAccCR">
          <div class="arch-accordion-header" onclick="toggleArchAccordion('archAccCR')">
            <span>📝 Compte-rendu général</span>
            <span class="arch-acc-chevron">▸</span>
          </div>
          <div class="arch-accordion-body" style="display:none">
            <div id="archUserCRs"></div>
            <div class="arch-accordion" id="archAccMedia" style="margin-top:12px">
              <div class="arch-accordion-header" onclick="event.stopPropagation();toggleArchAccordion('archAccMedia')">
                <span>📸 Photos & vidéos de la séance</span>
                <span class="arch-acc-chevron">▸</span>
              </div>
              <div class="arch-accordion-body" style="display:none">
                <div id="archSessionMedia"></div>
                <button class="btn-sm ghost" style="margin-top:8px" onclick="openArchivePhotoForm(null)">+ Ajouter des médias</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Jeux joués -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px">
          <div class="section-label" style="margin:0">🎲 Jeux joués</div>
          <button class="btn-sm ghost" onclick="openArchiveGameForm(null)">+ Ajouter un jeu</button>
        </div>
        <div id="archGames"></div>
        <div id="archGameForm" style="display:none;margin-top:8px"></div>
      </div>
    </div>
  `;
  // prefillArchiveFromProgramme désactivé — l'archive se remplit manuellement
  renderUserCRs();
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function prefillArchiveFromProgramme() {
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/programme');
  const slots = (r.slots || []).filter(function(s) { return !s.is_break && s.game_name; });
  if (!slots.length) return;
  const existingNames = (archiveData.games || []).map(function(g) { return g.game_name.toLowerCase(); });
  for (const s of slots) {
    const games = [
      { name: s.game_name, players: s.players },
      s.game_name_b ? { name: s.game_name_b, players: s.players_b } : null
    ].filter(Boolean);
    for (const g of games) {
      if (existingNames.includes(g.name.toLowerCase())) continue;
      const res = await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/games', {
        game_name: g.name,
        joueurs: g.players && g.players !== 'tous' ? g.players : '',
        thumbnail: '', vainqueur: '', scores: '', compte_rendu: ''
      });
      if (res.id) {
        archiveData.games = archiveData.games || [];
        archiveData.games.push({ id: res.id, game_name: g.name, joueurs: g.players||'', thumbnail:'', vainqueur:'', scores:'', compte_rendu:'', photos:[] });
        existingNames.push(g.name.toLowerCase());
      }
    }
  }
}

function renderArchiveGames() {
  const el = document.getElementById('archGames');
  if (!el) return;
  const games = archiveData?.games || [];
  if (!games.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic;padding:8px 0">Aucun jeu enregistré</div>';
    return;
  }
  el.innerHTML = games.map((g, i) => `
    <div class="arch-accordion arch-game-card" id="archGame-${g.id}">
      <div class="arch-accordion-header arch-game-header" onclick="toggleArchAccordion('archGame-${g.id}')">
        ${g.thumbnail ? `<img class="ag-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'">` : '<div class="ag-thumb-ph">🎲</div>'}
        <div class="ag-info" style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="ag-name">${esc(g.game_name)}</div>
            <button class="arch-del-btn" title="Supprimer" onclick="event.stopPropagation();if(confirm('Supprimer ce jeu ?'))deleteArchiveGame(${g.id})">🗑</button>
          </div>
          ${g.vainqueur ? `<div class="ag-win">🏆 ${esc(g.vainqueur)}</div>` : ''}
          ${g.scores ? `<div class="ag-scores">📊 ${esc(sortScoresDesc(g.scores))}</div>` : ''}
        </div>
        <span class="arch-acc-chevron">▸</span>
      </div>
      <div class="arch-accordion-body" style="display:none">
        <!-- Formulaire d'édition du jeu intégré -->
        <div id="archGameForm-${g.id}"></div>
      </div>
    </div>
  `).join('');

  // Après rendu, ouvrir les formulaires d'édition dans chaque accordéon jeu
  games.forEach((g, i) => {
    const formEl = document.getElementById('archGameForm-' + g.id);
    if (formEl) renderGameEditInline(formEl, i, g);
  });
}

function toggleGameBody(id) { // compat
  toggleArchAccordion(id.replace('agbody-', 'archGame-'));
}

function toggleArchAccordion(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const body = el.querySelector('.arch-accordion-body');
  const chevron = el.querySelector('.arch-acc-chevron');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}

// ── Chips de sélection de joueurs ───────────────────────────
function initPlayerChips(containerId, hiddenId, selectedStr) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const participants = currentSession?.participants || [];
  const selected = new Set(
    (selectedStr || '').split(',').map(s => s.trim()).filter(Boolean)
  );

  container.innerHTML = participants.map(p => {
    const isSelected = selected.has(p.username);
    return `<button type="button"
      class="player-chip ${isSelected ? 'selected' : ''}"
      onclick="togglePlayerChip(this, '${esc(p.username)}', '${hiddenId}')">
      ${esc(p.username)}
    </button>`;
  }).join('');
}

function togglePlayerChip(btn, username, hiddenId) {
  btn.classList.toggle('selected');
  const container = btn.parentNode;
  const selected = [...container.querySelectorAll('.player-chip.selected')]
    .map(b => b.textContent.trim());
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = selected.join(', ');
  // Synchroniser le vainqueur
  const gameId = hiddenId.replace('agJoueurs_', '');
  const vainqueurInput = document.getElementById('agVainqueur_' + gameId);
  if (vainqueurInput && !selected.includes(vainqueurInput.value)) {
    vainqueurInput.value = '';
  }
  // Mettre à jour les champs de scores
  const scoresHiddenId = 'agScores_' + gameId;
  const scoresGridId = 'agScoresGrid_' + gameId;
  const currentScores = document.getElementById(scoresHiddenId)?.value || '';
  initScoreFields(scoresGridId, scoresHiddenId, selected.join(', '), currentScores);
}

function initScoreFields(gridId, hiddenId, joueursStr, scoresStr) {
  const grid = document.getElementById(gridId);
  const hidden = document.getElementById(hiddenId);
  if (!grid || !hidden) return;

  // Parser les joueurs
  const joueurs = (joueursStr || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!joueurs.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Sélectionne les joueurs d\'abord</div>';
    return;
  }

  // Parser les scores existants "Nom: score, Nom: score"
  const parsed = {};
  (scoresStr || '').split(',').forEach(part => {
    const m = part.trim().match(/^(.+?):\s*(.+)$/);
    if (m) parsed[m[1].trim()] = m[2].trim();
  });

  grid.innerHTML = joueurs.map(j => `
    <div class="score-field-row">
      <label class="score-field-label">${esc(j)}</label>
      <input type="text" class="form-input score-field-input" inputmode="numeric"
        placeholder="0" value="${esc(parsed[j] || '')}"
        data-player="${esc(j)}"
        oninput="updateScoresHidden('${hiddenId}', '${gridId}')">
    </div>`).join('');
}

function updateScoresHidden(hiddenId, gridId) {
  const grid = document.getElementById(gridId);
  const hidden = document.getElementById(hiddenId);
  if (!grid || !hidden) return;
  const parts = [...grid.querySelectorAll('.score-field-input')]
    .filter(input => input.value.trim())
    .map(input => `${input.dataset.player}: ${input.value.trim()}`);
  hidden.value = parts.join(', ');
}

// Rendu inline du contenu d'un jeu dans l'accordéon (sans modal)
function renderGameEditInline(container, idx, g) {
  if (!g || !container) return;
  const myId = currentUser.id;
  const myGameCR = (archiveData.gameCRs || []).find(c => c.game_id === g.id && c.user_id === myId);
  const otherCRs = (archiveData.gameCRs || []).filter(c => c.game_id === g.id && c.user_id !== myId);

  container.innerHTML = `
    <div class="arch-form-box" style="border:none;padding:12px 0 0">
      <input type="hidden" id="agEditId_${g.id}" value="${g.id}">
      <div class="slot-edit-row">
        <div class="form-group" style="flex:2;position:relative">
          <label class="form-label">Nom du jeu *</label>
          <input class="form-input" id="agName_${g.id}" value="${esc(g.game_name||'')}" placeholder="Wingspan" autocomplete="off">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Miniature (URL)</label>
          <input class="form-input" id="agThumb_${g.id}" value="${esc(g.thumbnail||'')}" placeholder="https://…">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Joueurs présents</label>
        <div class="player-chips" id="agJoueursChips_${g.id}"></div>
        <input type="hidden" id="agJoueurs_${g.id}" value="${esc(g.joueurs||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">🏆 Vainqueur</label>
        <input class="form-input" id="agVainqueur_${g.id}" value="${esc(g.vainqueur||'')}" placeholder="Nom du vainqueur">
      </div>
      <div class="form-group">
        <label class="form-label">📊 Scores</label>
        <div class="scores-grid-fields" id="agScoresGrid_${g.id}"></div>
        <input type="hidden" id="agScores_${g.id}" value="${esc(g.scores||'')}">
      </div>

      <div class="form-group">
        <label class="form-label">📝 Mon avis</label>
        <textarea class="form-input" id="agUserCR_${g.id}" rows="5"
          placeholder="Ton ressenti, anecdotes…"
          style="resize:vertical;min-height:110px;font-size:16px">${esc(myGameCR?.content||'')}</textarea>
        ${crToolbarHtml('agUserCR_'+g.id)}
      </div>

      <div style="display:flex;gap:6px;margin-bottom:12px">
        <button class="btn-sm accent" onclick="saveArchiveGameInline(${idx}, ${g.id})">💾 Enregistrer</button>
      </div>

      <!-- Médias du jeu — accordéon -->
      <div class="arch-accordion" id="archGameMedia-${g.id}">
        <div class="arch-accordion-header" onclick="toggleArchAccordion('archGameMedia-${g.id}')">
          <span>📷 Photos & vidéos du jeu</span>
          <span class="arch-acc-chevron">▸</span>
        </div>
        <div class="arch-accordion-body" style="display:none;padding:10px 0">
          <div id="gamePhotosGrid_${g.id}" class="arch-photos-row"></div>
          <button type="button" class="btn-sm ghost" onclick="openGamePhotoForm(${g.id})" style="margin-top:8px">📷 Ajouter des médias</button>
          <div id="gamePhotoForm_${g.id}" style="display:none"></div>
        </div>
      </div>

      ${otherCRs.length ? `
      <div class="user-cr-others" style="margin-top:8px">
        <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
          <span>💬 Avis des autres joueurs (${otherCRs.length})</span>
          <span class="user-cr-chevron">▸</span>
        </div>
        <div class="user-cr-others-body" style="display:none">
          ${otherCRs.map(cr => `
            <div class="game-cr-user-edit" style="margin-bottom:8px">
              <span class="user-cr-author">👤 ${esc(cr.username)}</span>
              <div style="margin-top:4px;font-size:.82rem;line-height:1.5;white-space:pre-wrap">${renderCRContent(cr.content)}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
  `;
  // Charger les photos existantes
  refreshGamePhotos(g.id);
  // Initialiser les chips joueurs
  initPlayerChips('agJoueursChips_' + g.id, 'agJoueurs_' + g.id, g.joueurs || '');
  // Initialiser les champs de scores
  initScoreFields('agScoresGrid_' + g.id, 'agScores_' + g.id, g.joueurs || '', g.scores || '');
}

async function saveArchiveGameInline(idx, gameId) {
  const name = document.getElementById('agName_' + gameId)?.value.trim();
  if (!name) { showToast('Nom du jeu requis'); return; }
  const payload = {
    game_name: name,
    thumbnail: document.getElementById('agThumb_' + gameId)?.value.trim() || '',
    joueurs: document.getElementById('agJoueurs_' + gameId)?.value.trim() || '',
    vainqueur: document.getElementById('agVainqueur_' + gameId)?.value.trim() || '',
    scores: document.getElementById('agScores_' + gameId)?.value.trim() || '',
    compte_rendu: '',
  };
  await api('PATCH', `/api/archive/games/${gameId}`, payload);
  // Sauvegarder le CR utilisateur
  const crField = document.getElementById('agUserCR_' + gameId);
  if (crField) await api('POST', `/api/archive/games/${gameId}/cr`, { content: crField.value });
  // Mettre à jour archiveData localement
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  showToast('✅ Jeu enregistré');
  // Re-render uniquement la carte de ce jeu
  const gameIdx = archiveData.games.findIndex(g => g.id === gameId);
  if (gameIdx >= 0) {
    const formEl = document.getElementById('archGameForm-' + gameId);
    if (formEl) renderGameEditInline(formEl, gameIdx, archiveData.games[gameIdx]);
  }
}

function openArchiveGameForm(idx) {
  const g = idx !== null ? archiveData.games[idx] : null;
  const form = document.getElementById('archGameForm');
  form.style.display = 'block';
  // Jeux de la séance pour suggestion rapide
  const sessionGames = currentSession.proposals || [];

  form.innerHTML = `
    <div class="arch-form-box">
      <div class="section-label" style="margin-bottom:10px">${g ? 'Modifier le jeu' : 'Nouveau jeu'}</div>
      ${g ? `<input type="hidden" id="agEditId" value="${g.id}">` : ''}
      ${!g && sessionGames.length ? `
        <div class="form-group">
          <label class="form-label">Jeux de la séance</label>
          <div class="arch-game-pills">
            ${sessionGames.map(p => `<button class="arch-game-pill" onclick="prefillArchiveGame('${esc(p.name).replace(/'/g,"\\'")}','${esc(p.thumbnail||'').replace(/'/g,"\\'")}','${esc(p.bgg_id||'')}');event.preventDefault()">${esc(p.name)}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Ou rechercher sur BGG</label>
          <div style="display:flex;gap:6px">
            <input class="form-input" id="agBggSearch" placeholder="Nom du jeu…" onkeydown="if(event.key==='Enter'){searchBGGForArchive();event.preventDefault()}">
            <button class="btn-sm ghost" onclick="searchBGGForArchive()">🔍</button>
          </div>
          <div id="agBggResults" style="display:none;margin-top:6px"></div>
        </div>
        <div style="border-top:1px solid var(--border);margin:10px 0"></div>
      ` : ''}
      <div class="slot-edit-row">
        <div class="form-group" style="flex:2;position:relative"><label class="form-label">Nom du jeu *</label><input class="form-input" id="agName" value="${esc(g?.game_name||'')}" placeholder="Wingspan" autocomplete="off" oninput="archiveGameAC(this)" onblur="setTimeout(()=>{const s=document.getElementById('agNameSugg');if(s)s.style.display='none'},150)"><div class="tag-suggestions" id="agNameSugg" style="display:none"></div></div>
        <div class="form-group" style="flex:1"><label class="form-label">URL miniature</label><input class="form-input" id="agThumb" value="${esc(g?.thumbnail||'')}" placeholder="https://…"></div>
      </div>
      <div class="form-group"><label class="form-label">Joueurs</label>
        <div class="tag-input-wrap" id="agJoueursWrap">
          <div class="tag-list" id="agJoueursTags"></div>
          <input class="tag-input-field" id="agJoueursInput" placeholder="Ajouter un joueur…" autocomplete="off">
          <div class="tag-suggestions" id="agJoueursSugg" style="display:none"></div>
        </div>
        <input type="hidden" id="agJoueurs" value="${esc(g?.joueurs||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">🏆 Vainqueur</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="form-input" id="agVainqueurSel" onchange="onVainqueurSelChange()" style="flex:1">
            <option value="">— Sélectionner —</option>
            ${buildVainqueurOptions(g?.joueurs||'', g?.vainqueur||'')}
          </select>
          <div style="position:relative;max-width:140px">
            <input class="form-input" id="agVainqueurFree" value="${esc(g?.vainqueur||'')}" placeholder="Saisie libre…"
              oninput="onVainqueurFreeInput(this)" onblur="setTimeout(()=>{const s=document.getElementById('agVainqueurFreeSugg');if(s)s.style.display='none'},150)">
            <div class="tag-suggestions" id="agVainqueurFreeSugg" style="display:none"></div>
          </div>
        </div>
        <input type="hidden" id="agVainqueur" value="${esc(g?.vainqueur||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Scores <span style="font-size:.65rem;color:var(--text-muted)">(ajoutez les joueurs d'abord)</span></label>
        <div id="agScoresGrid" class="scores-grid"></div>
        <input type="hidden" id="agScores" value="${esc(g?.scores||'')}">
      </div>
      ${g ? (() => {
        const myId = currentUser.id;
        const myGameCR = (archiveData.gameCRs || []).find(c => c.game_id === g.id && c.user_id === myId);
        const otherCRs = (archiveData.gameCRs || []).filter(c => c.game_id === g.id && c.user_id !== myId);
        return `
          <div class="form-group">
            <label class="form-label">📷 Photos & vidéos du jeu</label>
            <div id="gamePhotosGrid_${g.id}" class="arch-photos-row" style="margin-top:6px"></div>
            <button type="button" class="btn-sm ghost" onclick="openGamePhotoForm(${g.id})" style="margin-top:6px">📷 Ajouter des photos</button>
            <div id="gamePhotoForm_${g.id}" style="display:none"></div>
          </div>
          <div class="form-group">
            <label class="form-label">📝 Mon avis</label>
            <textarea class="form-input" id="agUserCR" rows="6"
              placeholder="Ton ressenti, anecdotes, moments mémorables…"
              style="resize:vertical;min-height:130px;margin-top:4px;font-size:16px">${esc(myGameCR?.content||'')}</textarea>
            ${crToolbarHtml('agUserCR')}
          </div>
          ${otherCRs.length ? `
          <div class="user-cr-others" style="margin-top:4px">
            <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
              <span>💬 Avis des autres joueurs (${otherCRs.length})</span>
              <span class="user-cr-chevron">▸</span>
            </div>
            <div class="user-cr-others-body" style="display:none">
              ${otherCRs.map(cr => `
                <div class="game-cr-user-edit" style="margin-bottom:8px">
                  <span class="user-cr-author">👤 ${esc(cr.username)}</span>
                  <div style="margin-top:4px;font-size:.82rem;line-height:1.5;white-space:pre-wrap">${renderCRContent(cr.content)}</div>
                </div>`).join('')}
            </div>
          </div>` : ''}`;
      })() : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-sm ghost" onclick="document.getElementById('archGameForm').style.display='none'">Annuler</button>
        <button class="btn-sm accent" onclick="saveArchiveGame(${g ? 'true' : 'false'})">${g ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </div>
  `;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Initialiser le tag input joueurs
  const sessionPlayerNames = currentSession.participants.map(p => p.username);
  const initialJoueurs = g?.joueurs ? g.joueurs.split(',').map(s => s.trim()).filter(Boolean) : [];
  initTagInput('agJoueursInput', 'agJoueursTags', 'agJoueurs', 'agJoueursSugg',
    sessionPlayerNames, initialJoueurs,
    () => { refreshScoresGrid(g); refreshVainqueurSelect(); }  // callback quand joueurs changent
  );
  // Vainqueur: géré par select + saisie libre
  // Scores grid initial
  refreshScoresGrid(g);
  // Charger les photos existantes du jeu (mode édition)
  if (g) refreshGamePhotos(g.id);
}

// Affiche/rafraîchit les photos d'un jeu dans le formulaire d'édition
function refreshGamePhotos(gameId) {
  const grid = document.getElementById('gamePhotosGrid_' + gameId);
  if (!grid) return;
  const game = (archiveData.games || []).find(x => x.id === gameId);
  const photos = game?.photos || [];
  if (!photos.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Aucune photo pour ce jeu</div>';
    return;
  }
  grid.innerHTML = photos.map(p => renderMediaThumb(p, gameId)).join('');
}

// Ouvre le formulaire d'ajout de photo dans la carte de jeu (édition)
function openGamePhotoForm(gameId) {
  const formId = 'gamePhotoForm_' + gameId;
  const form = document.getElementById(formId);
  if (!form) return;
  const isVisible = form.style.display !== 'none';
  if (isVisible) { form.style.display = 'none'; return; }
  form.style.display = 'block';
  form.innerHTML = `
    <div class="arch-form-box" style="margin-top:8px">
      <div class="arch-photo-tabs">
        <button type="button" class="arch-photo-tab active" id="gpTabUpload_${gameId}" onclick="switchGamePhotoTab('upload',${gameId})">⬆️ Upload</button>
        <button type="button" class="arch-photo-tab" id="gpTabUrl_${gameId}" onclick="switchGamePhotoTab('url',${gameId})">🔗 URL / Vidéo</button>
      </div>
      <div id="gpUpload_${gameId}">
        <div class="arch-drop-zone" onclick="document.getElementById('gpFile_${gameId}').click()"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="handleGamePhotoDrop(event,${gameId})">
          <input type="file" id="gpFile_${gameId}" accept="image/*,video/*" multiple style="display:none"
            onchange="handleGamePhotoFiles(this.files,${gameId})">
          <div class="arch-drop-icon">📷</div>
          <div class="arch-drop-label">Cliquer ou glisser ici</div>
          <div class="arch-drop-sub">Images · max 8MB</div>
        </div>
        <div id="gpProgress_${gameId}" style="margin-top:8px"></div>
      </div>
      <div id="gpUrl_${gameId}" style="display:none">
        <div class="form-group" style="margin-top:8px">
          <label class="form-label">URL photo ou vidéo</label>
          <input class="form-input" id="gpUrlInput_${gameId}" placeholder="https://imgur.com/… ou https://youtube.com/…">
        </div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Légende (optionnel)</label>
        <input class="form-input" id="gpCaption_${gameId}" placeholder="Description…">
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button type="button" class="btn-sm ghost" onclick="document.getElementById('${formId}').style.display='none'">Fermer</button>
        <button type="button" class="btn-sm accent" id="gpUrlBtn_${gameId}" onclick="saveGamePhotoUrl(${gameId})" style="display:none">Ajouter</button>
      </div>
    </div>
  `;
}

function switchGamePhotoTab(tab, gameId) {
  document.getElementById('gpUpload_' + gameId).style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('gpUrl_' + gameId).style.display = tab === 'url' ? 'block' : 'none';
  document.getElementById('gpUrlBtn_' + gameId).style.display = tab === 'url' ? '' : 'none';
  document.getElementById('gpTabUpload_' + gameId).classList.toggle('active', tab === 'upload');
  document.getElementById('gpTabUrl_' + gameId).classList.toggle('active', tab === 'url');
}

function handleGamePhotoDrop(event, gameId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  handleGamePhotoFiles(event.dataTransfer.files, gameId);
}

async function handleGamePhotoFiles(files, gameId) {
  const caption = document.getElementById('gpCaption_' + gameId)?.value.trim() || '';
  const progress = document.getElementById('gpProgress_' + gameId);
  for (const file of Array.from(files)) {
    const bar = document.createElement('div');
    bar.className = 'arch-upload-item';
    bar.innerHTML = '<span class="arch-upload-name">' + esc(file.name) + '</span><span class="arch-upload-status">⏳</span>';
    progress.appendChild(bar);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('sessionId', currentSession.session.id);
      const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (data.url) {
        let thumbnail = null;
        if (data.type === 'video') {
          bar.querySelector('.arch-upload-status').textContent = '🎬';
          const frame = await extractVideoFrame(file);
          thumbnail = await uploadThumbnailBlob(frame);
        }
        await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', { url: data.url, caption, game_id: gameId, thumbnail, type: data.type });
        bar.querySelector('.arch-upload-status').textContent = '✅';
      } else {
        bar.querySelector('.arch-upload-status').textContent = '❌ ' + (data.error || 'Erreur');
      }
    } catch(e) {
      bar.querySelector('.arch-upload-status').textContent = '❌ Erreur';
    }
  }
  // Recharger archiveData et rafraîchir uniquement la grille
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/archive');
  archiveData = r;
  refreshGamePhotos(gameId);
}

async function saveGamePhotoUrl(gameId) {
  const url = document.getElementById('gpUrlInput_' + gameId)?.value.trim();
  if (!url) { showToast('URL requise'); return; }
  const caption = document.getElementById('gpCaption_' + gameId)?.value.trim() || '';
  // Détecter type
  const isVideo = /youtube\.com|youtu\.be|vimeo\.com|\.mp4$|\.mov$|\.webm$/i.test(url);
  await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', {
    url, caption, game_id: gameId, type: isVideo ? 'video' : 'photo'
  });
  document.getElementById('gpUrlInput_' + gameId).value = '';
  document.getElementById('gpCaption_' + gameId).value = '';
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/archive');
  archiveData = r;
  refreshGamePhotos(gameId);
}

async function saveArchiveGame(isEdit) {
  const name = document.getElementById('agName').value.trim();
  if (!name) { showToast('Nom requis'); return; }
  // Le champ "Compte-rendu" global a été remplacé par "Mon avis" — on garde compte_rendu vide pour compatibilité
  const payload = {
    game_name: name,
    thumbnail: document.getElementById('agThumb').value.trim(),
    joueurs: document.getElementById('agJoueurs').value.trim(),
    vainqueur: document.getElementById('agVainqueur').value.trim(),
    scores: document.getElementById('agScores').value.trim(),
    compte_rendu: '',
  };
  let gameId;
  if (isEdit) {
    gameId = parseInt(document.getElementById('agEditId').value);
    await api('PATCH', `/api/archive/games/${gameId}`, payload);
  } else {
    const res = await api('POST', `/api/sessions/${currentSession.session.id}/archive/games`, { ...payload, sort_order: archiveData.games.length });
    gameId = res.id;
  }
  // Sauvegarder l'avis personnel sur ce jeu (CR utilisateur)
  const userCRField = document.getElementById('agUserCR');
  if (gameId && userCRField) {
    await api('POST', `/api/archive/games/${gameId}/cr`, { content: userCRField.value });
  }
  document.getElementById('archGameForm').style.display = 'none';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  initPhotoDnd();
  showToast(isEdit ? 'Jeu mis à jour !' : 'Jeu ajouté !');
}

async function deleteArchiveGame(id) {
  if (!confirm('Supprimer ce jeu de l\'archive ?')) return;
  await api('DELETE', `/api/archive/games/${id}`);
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  initPhotoDnd();
}

function openArchivePhotoForm(gameId) {
  // Si gameId est null, c'est pour la séance globale — formulaire dans archGameForm ou zone dédiée
  const formId = gameId !== null ? 'archGameForm' : 'archSessionMediaForm';
  let form = document.getElementById(formId);
  if (!form) {
    // créer un div temporaire sous archSessionMedia
    form = document.createElement('div');
    form.id = formId;
    document.getElementById('archSessionMedia').after(form);
  }
  form.style.display = 'block';
  form.innerHTML = `
    <div class="arch-form-box" style="margin-top:8px">
      <div class="section-label" style="margin-bottom:10px">📷 Ajouter photos / vidéos</div>
      <div class="arch-photo-tabs">
        <button class="arch-photo-tab active" id="tabUpload" onclick="switchPhotoTab('upload',${gameId})">⬆️ Upload</button>
        <button class="arch-photo-tab" id="tabUrl" onclick="switchPhotoTab('url',${gameId})">🔗 URL / Vidéo</button>
      </div>
      <div id="photoTabUpload">
        <div class="arch-drop-zone" id="archDropZone" onclick="document.getElementById('phFileInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handlePhotoDrop(event,${gameId})">
          <input type="file" id="phFileInput" accept="image/*,video/*" multiple style="display:none" onchange="handlePhotoFiles(this.files,${gameId})">
          <div class="arch-drop-icon">📷</div>
          <div class="arch-drop-label">Cliquer ou glisser ici</div>
          <div class="arch-drop-sub">Images · max 8MB</div>
        </div>
        <div id="archUploadProgress" style="margin-top:8px"></div>
      </div>
      <div id="photoTabUrl" style="display:none">
        <div class="form-group" style="margin-top:8px">
          <label class="form-label">URL photo ou vidéo</label>
          <input class="form-input" id="phUrl" placeholder="https://imgur.com/… ou https://youtube.com/watch?v=…">
          <div style="font-size:.68rem;color:var(--text-muted);margin-top:3px">YouTube, Vimeo, lien direct image</div>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Légende (optionnel)</label><input class="form-input" id="phCaption" placeholder="Description…"></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-sm ghost" onclick="document.getElementById('${formId}').style.display='none'">Fermer</button>
        <button class="btn-sm accent" id="phSaveUrlBtn" onclick="saveArchivePhotoUrl(${gameId},'${formId}')" style="display:none">Ajouter</button>
      </div>
    </div>
  `;
}

function switchPhotoTab(tab, gameId) {
  document.getElementById('photoTabUpload').style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('photoTabUrl').style.display = tab === 'url' ? 'block' : 'none';
  document.getElementById('phSaveUrlBtn').style.display = tab === 'url' ? '' : 'none';
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabUrl').classList.toggle('active', tab === 'url');
}

function renderSessionMedia() {
  const el = document.getElementById('archSessionMedia');
  if (!el) return;
  const media = archiveData?.photos || [];
  if (!media.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic;padding:4px 0">Aucun média — ajoutez photos ou vidéos de la journée</div>';
    return;
  }
  el.innerHTML = `<div class="arch-photos-row">${media.map(m => renderMediaThumb(m, null)).join('')}</div>`;
}

function renderMediaThumb(m, gameId) {
  const isDirectVideo = m.url.match(/\.mp4|\.webm|\.mov/i);
  const isEmbedVideo = m.url.match(/youtube|youtu\.be|vimeo/);
  const mid = m.id;
  const gid = gameId || '';
  const cap = m.caption || '';

  function makeWrap(innerEl) {
    const div = document.createElement('div');
    div.className = 'arch-photo-wrap';
    div.draggable = true;
    div.dataset.mid = String(mid);
    div.dataset.gid = String(gid);
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.appendChild(innerEl);

    const capEl = document.createElement('div');
    capEl.className = 'arch-caption-edit';
    capEl.contentEditable = 'true';
    capEl.dataset.mid = String(mid);
    capEl.title = 'Cliquer pour ajouter un titre';
    capEl.textContent = cap;
    capEl.onblur = function() { savePhotoCaption(this); };
    capEl.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
    const delLink = document.createElement('button');
    delLink.type = 'button';
    delLink.className = 'arch-del-btn';
    delLink.title = 'Supprimer';
    delLink.innerHTML = '🗑';
    delLink.setAttribute('onclick', `event.preventDefault();event.stopPropagation();if(confirm('Supprimer ce média ?'))deleteArchivePhoto(${mid},${gid===null?'null':gid})`);
    // Case "Ne pas publier"
    const pubWrap = document.createElement('label');
    pubWrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:.65rem;color:var(--text-muted);cursor:pointer;margin-top:3px';
    const pubCb = document.createElement('input');
    pubCb.type = 'checkbox';
    if (m.is_public === 0) pubCb.setAttribute('checked', 'checked');
    pubCb.setAttribute('onchange', `togglePhotoPublic(${mid}, this.checked ? 0 : 1)`);
    pubWrap.appendChild(pubCb);
    pubWrap.appendChild(document.createTextNode('Ne pas publier'));
    div.appendChild(inner);
    div.appendChild(capEl);
    div.appendChild(pubWrap);
    div.appendChild(delLink);
    return div;
  }

  function makeVideoPreview(imgSrc, clickUrl, isEmbed) {
    const wrap = document.createElement('div');
    wrap.className = 'arch-video-preview';
    const safeClick = clickUrl.replace(/'/g, "\\'");
    const safeCapV = (cap||'').replace(/'/g, "\\'");
    wrap.setAttribute('onclick', "openLightbox('" + safeClick + "','" + safeCapV + "'," + (isEmbed ? 'true' : 'false') + ")");
    function makeThumbIcon() {
      const ph = document.createElement('div');
      ph.className = 'arch-video-native-thumb';
      ph.style.cssText = 'background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:2rem';
      ph.textContent = '\u25B6';
      return ph;
    }
    if (imgSrc) {
      const img = document.createElement('img');
      img.src = imgSrc;
      img.className = 'arch-video-native-thumb';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onerror = function() { wrap.replaceChild(makeThumbIcon(), img); };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(makeThumbIcon());
    }
    const play = document.createElement('div');
    play.className = 'arch-video-play-btn';
    play.textContent = '\u25B6';
    wrap.appendChild(play);
    return wrap;
  }

  if (isEmbedVideo) {
    const ytMatch = m.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([-\w]+)/);
    const ytThumb = ytMatch ? 'https://img.youtube.com/vi/' + ytMatch[1] + '/hqdefault.jpg' : null;
    const embedUrl = getVideoEmbed(m.url);
    let innerEl;
    if (ytThumb) {
      innerEl = makeVideoPreview(ytThumb, embedUrl || m.url, true);
    } else {
      const a = document.createElement('a');
      a.href = m.url;
      a.target = '_blank';
      a.className = 'arch-video-link';
      a.textContent = '\u25B6 Vid\u00e9o';
      innerEl = a;
    }
    return makeWrap(innerEl).outerHTML;
  }

  if (isDirectVideo) {
    const innerEl = makeVideoPreview(m.thumbnail || null, m.url, false);
    return makeWrap(innerEl).outerHTML;
  }

  const img = document.createElement('img');
  img.src = m.url;
  img.className = 'arch-photo-thumb';
  img.loading = 'lazy';
  img.style.cursor = 'zoom-in';
  // Utiliser setAttribute pour que onclick survive à outerHTML
  const safeUrl = m.url.replace(/'/g, "\\'");
  const safeCap = (cap||'').replace(/'/g, "\\'");
  img.setAttribute('onclick', "openLightbox('" + safeUrl + "','" + safeCap + "',false)");
  img.setAttribute('onerror', "this.closest('.arch-photo-wrap').style.display='none'");
  return makeWrap(img).outerHTML;
}

function getVideoEmbed(url) {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

function handlePhotoDrop(event, gameId) {
  event.preventDefault();
  document.getElementById('archDropZone').classList.remove('drag-over');
  handlePhotoFiles(event.dataTransfer.files, gameId);
}

async function extractVideoFrame(file) {
  return new Promise(function(resolve) {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(file);
    video.src = url;
    let done = false;
    function capture() {
      if (done) return;
      done = true;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = video.videoWidth ? Math.round(320 * video.videoHeight / video.videoWidth) : 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(blob) { resolve(blob && blob.size > 1000 ? blob : null); }, 'image/jpeg', 0.75);
    }
    video.addEventListener('seeked', capture);
    video.addEventListener('canplay', function() {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.05);
    });
    video.addEventListener('loadedmetadata', function() {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.05);
    });
    video.addEventListener('error', function() { URL.revokeObjectURL(url); resolve(null); });
    setTimeout(function() { if (!done) { capture(); } }, 3000);
    video.load();
  });
}

async function uploadThumbnailBlob(blob) {
  if (!blob) return null;
  const formData = new FormData();
  formData.append('photo', blob, 'thumb.jpg');
  const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
  const data = await res.json();
  return data.url || null;
}

async function handlePhotoFiles(files, gameId) {
  const caption = document.getElementById('phCaption')?.value.trim() || '';
  const progress = document.getElementById('archUploadProgress');
  const arr = Array.from(files);
  for (const file of arr) {
    const bar = document.createElement('div');
    bar.className = 'arch-upload-item';
    bar.innerHTML = '<span class="arch-upload-name">' + esc(file.name) + '</span><span class="arch-upload-status">⏳</span>';
    progress.appendChild(bar);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      if (currentSession && currentSession.session) formData.append('sessionId', currentSession.session.id);
      const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (data.url) {
        let thumbnail = null;
        if (data.type === 'video') {
          bar.querySelector('.arch-upload-status').textContent = '🎬';
          const frame = await extractVideoFrame(file);
          thumbnail = await uploadThumbnailBlob(frame);
        }
        await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', { url: data.url, caption, game_id: gameId, thumbnail, type: data.type });
        bar.querySelector('.arch-upload-status').textContent = '✅';
      } else {
        bar.querySelector('.arch-upload-status').textContent = '❌ ' + (data.error || 'Erreur');
      }
    } catch(e) {
      bar.querySelector('.arch-upload-status').textContent = '❌ Erreur';
    }
  }
  // Rafraîchir la galerie
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function saveArchivePhotoUrl(gameId, formId) {
  const url = document.getElementById('phUrl')?.value.trim();
  if (!url) { showToast('URL requise'); return; }
  const caption = document.getElementById('phCaption')?.value.trim() || '';
  await api('POST', `/api/sessions/${currentSession.session.id}/archive/photos`, { url, caption, game_id: gameId });
  const formEl = document.getElementById(formId || 'archGameForm');
  if (formEl) formEl.style.display = 'none';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  showToast('Média ajouté !');
}

let _dndDragSrc = null;

function initPhotoDnd() {
  let dragSrc = null;
  document.querySelectorAll('.arch-photos-row').forEach(function(row) {
    row.addEventListener('dragstart', function(e) {
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (!wrap) return;
      dragSrc = wrap;
      setTimeout(function() { wrap.classList.add('dragging'); }, 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', function(e) {
      document.querySelectorAll('.arch-photo-wrap').forEach(function(x) { x.classList.remove('dragging','drag-over'); });
      dragSrc = null;
    });
    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (wrap && dragSrc && wrap !== dragSrc) {
        document.querySelectorAll('.arch-photo-wrap').forEach(function(x) { x.classList.remove('drag-over'); });
        wrap.classList.add('drag-over');
      }
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (!wrap || !dragSrc || wrap === dragSrc) return;
      wrap.classList.remove('drag-over');
      if (dragSrc.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING) {
        row.insertBefore(dragSrc, wrap.nextSibling);
      } else {
        row.insertBefore(dragSrc, wrap);
      }
      const newOrder = Array.from(row.querySelectorAll('.arch-photo-wrap[data-mid]')).map(function(x, i) {
        return { id: parseInt(x.dataset.mid), sort_order: i };
      });
      api('PATCH', '/api/archive/photos/reorder', { items: newOrder });
    });

    row.addEventListener('blur', function(e) {
      if (e.target.classList.contains('arch-caption-edit')) {
        savePhotoCaption(e.target);
      }
    }, true);
    row.addEventListener('keydown', function(e) {
      if (e.target.classList.contains('arch-caption-edit') && e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });
  });
}

async function togglePhotoPublic(photoId, isPublic) {
  await api('PATCH', `/api/archive/photos/${photoId}`, { is_public: isPublic ? 1 : 0 });
  // Mettre à jour en mémoire
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(x => x.id === photoId);
    if (p) { p.is_public = isPublic ? 1 : 0; return; }
  }
  const p2 = (archiveData.photos || []).find(x => x.id === photoId);
  if (p2) p2.is_public = isPublic ? 1 : 0;
}

async function savePhotoCaption(el) {
  const mid = parseInt(el.dataset.mid);
  const caption = el.textContent.trim();
  let currentSortOrder = 0;
  let currentIsPublic = 1;
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(function(x) { return x.id === mid; });
    if (p) { currentSortOrder = p.sort_order || 0; currentIsPublic = p.is_public !== 0 ? 1 : 0; break; }
  }
  const p2 = (archiveData.photos || []).find(function(x) { return x.id === mid; });
  if (p2) { currentSortOrder = p2.sort_order || 0; currentIsPublic = p2.is_public !== 0 ? 1 : 0; }
  await api('PATCH', '/api/archive/photos/' + mid, { caption, sort_order: currentSortOrder, is_public: currentIsPublic });
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(function(x) { return x.id === mid; });
    if (p) { p.caption = caption; return; }
  }
  if (p2) p2.caption = caption;
}

async function deleteArchivePhoto(photoId, gameId) {
  await api('DELETE', `/api/archive/photos/${photoId}`);
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function saveArchiveCR() {
  // Compatibilité ancienne — sauvegarde le CR général via la nouvelle API user CR
  return saveArchiveUserCR(currentUser.id);
}

// ─────────────────────────────────────────────────────────────
// CR PAR UTILISATEUR (séance)
// ─────────────────────────────────────────────────────────────

function renderUserCRs() {
  const container = document.getElementById('archUserCRs');
  if (!container) return;
  const userCRs = archiveData.userCRs || [];
  const myId = currentUser.id;
  const myCR = userCRs.find(c => c.user_id === myId);
  const others = userCRs.filter(c => c.user_id !== myId);
  const myContent = myCR?.content || '';

  // Mon CR — textarea grand par défaut, affiché en mode lecture si déjà écrit
  const myBlock = `
    <div class="user-cr-block" id="userCR_${myId}">
      <div class="user-cr-header">
        <span class="user-cr-author">👤 ${esc(currentUser.username)} (toi)</span>
        ${myContent ? `<button class="btn-sm ghost" onclick="editArchiveCR(${myId})">✏️ Modifier</button>` : ''}
      </div>
      <div class="user-cr-body" id="userCRBody_${myId}">
        ${myContent
          ? `<div class="user-cr-content">${renderCRContent(myContent)}</div>`
          : `<textarea class="form-input" id="archCR_${myId}" rows="8"
               placeholder="Ton compte-rendu : ressenti, anecdotes, moments mémorables…"
               style="resize:vertical;min-height:160px;font-size:16px">${esc(myContent)}</textarea>
             ${crToolbarHtml('archCR_'+myId)}
             <div style="display:flex;gap:6px;margin-top:8px">
               <button class="btn-sm accent" onclick="saveArchiveUserCR(${myId})">💾 Sauvegarder</button>
             </div>`}
      </div>
    </div>`;

  // Avis des autres — accordéon replié par défaut
  const othersBlock = others.length ? `
    <div class="user-cr-others">
      <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
        <span>💬 Avis des autres joueurs (${others.length})</span>
        <span class="user-cr-chevron">▸</span>
      </div>
      <div class="user-cr-others-body" style="display:none">
        ${others.map(cr => `
          <div class="user-cr-block" style="margin-bottom:8px">
            <div class="user-cr-header"><span class="user-cr-author">👤 ${esc(cr.username)}</span></div>
            <div class="user-cr-content">${renderCRContent(cr.content)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  container.innerHTML = myBlock + othersBlock;
}

function toggleOtherCRs(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector('.user-cr-chevron');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}

// Convertit ![gif](url) en <img> et préserve les sauts de ligne
function renderCRContent(text) {
  if (!text) return '';
  let html = esc(text);
  html = html.replace(/!\[gif\]\((https?:\/\/[^)]+)\)/g,
    '<img src="$1" alt="gif" style="max-width:200px;max-height:150px;border-radius:6px;display:block;margin:4px 0">');
  return html.replace(/\n/g, '<br>');
}

// Passe d'affichage à édition pour SON CR
function editArchiveCR(userId) {
  if (userId !== currentUser.id) return;
  const userCR = (archiveData.userCRs || []).find(c => c.user_id === userId);
  const content = userCR?.content || '';
  const body = document.getElementById('userCRBody_' + userId);
  if (!body) return;
  body.innerHTML = `
    <textarea class="form-input" id="archCR_${userId}" rows="10"
      placeholder="Ton compte-rendu : ressenti, anecdotes, moments mémorables…"
      style="resize:vertical;min-height:200px;font-size:16px">${esc(content)}</textarea>
    ${crToolbarHtml('archCR_'+userId)}
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn-sm accent" onclick="saveArchiveUserCR(${userId})">💾 Sauvegarder</button>
      <button class="btn-sm ghost" onclick="renderUserCRs()">Annuler</button>
    </div>
  `;
  document.getElementById('archCR_' + userId).focus();
}

async function saveArchiveUserCR(userId) {
  if (userId !== currentUser.id) return;
  const textarea = document.getElementById('archCR_' + userId);
  if (!textarea) return;
  const content = textarea.value;
  const res = await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/cr', { content });
  if (res.error) { showToast(res.error); return; }
  // Mettre à jour archiveData localement
  if (!archiveData.userCRs) archiveData.userCRs = [];
  const existing = archiveData.userCRs.find(c => c.user_id === userId);
  if (existing) existing.content = content;
  else archiveData.userCRs.push({
    session_id: currentSession.session.id,
    user_id: userId,
    content,
    username: currentUser.username,
    updated_at: new Date().toISOString()
  });
  showToast('✓ Compte-rendu enregistré');
  renderUserCRs();
}

// ─────────────────────────────────────────────────────────────
// BARRE EMOJI + GIF pour les textareas CR
// ─────────────────────────────────────────────────────────────

function crToolbarHtml(textareaId) {
  return `
    <div class="cr-toolbar" id="crtb_${textareaId}">
      <div class="cr-emoji-row">
        <button class="cr-emoji-btn" title="Emojis" onclick="openEmojiPicker('${textareaId}', this)">😊</button>
        <button class="cr-gif-btn" onclick="toggleGifSearch('${textareaId}')">GIF</button>
      </div>
      <div class="cr-gif-panel" id="gifpanel_${textareaId}" style="display:none">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input class="form-input" id="gifsearch_${textareaId}" placeholder="Rechercher un GIF…"
            onkeydown="if(event.key==='Enter'){searchGiphy('${textareaId}');event.preventDefault()}">
          <button class="btn-sm ghost" onclick="searchGiphy('${textareaId}')">🔍</button>
          <button class="btn-sm ghost" onclick="document.getElementById('gifpanel_${textareaId}').style.display='none'">✕</button>
        </div>
        <div class="cr-gif-results" id="gifresults_${textareaId}"></div>
      </div>
    </div>`;
}

function insertCREmoji(textareaId, emoji) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + emoji.length;
  ta.focus();
}

let _emojiPickerEl = null;
let _emojiPickerTarget = null;

function openEmojiPicker(textareaId, btn) {
  if (!customElements.get('emoji-picker')) {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js';
    document.head.appendChild(script);
    script.onload = () => _showEmojiPicker(textareaId, btn);
    return;
  }
  _showEmojiPicker(textareaId, btn);
}

function _showEmojiPicker(textareaId, btn) {
  if (_emojiPickerEl && _emojiPickerTarget === textareaId) {
    _emojiPickerEl.remove();
    _emojiPickerEl = null;
    _emojiPickerTarget = null;
    return;
  }
  if (_emojiPickerEl) _emojiPickerEl.remove();

  const picker = document.createElement('emoji-picker');
  picker.style.cssText = 'position:absolute;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.3);border-radius:10px;';

  const rect = btn.getBoundingClientRect();
  picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  picker.style.left = Math.max(0, rect.left + window.scrollX) + 'px';

  picker.addEventListener('emoji-click', e => {
    insertCREmoji(textareaId, e.detail.unicode);
  });

  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target) && ev.target !== btn) {
        picker.remove();
        _emojiPickerEl = null;
        _emojiPickerTarget = null;
        document.removeEventListener('click', close);
      }
    });
  }, 50);

  document.body.appendChild(picker);
  _emojiPickerEl = picker;
  _emojiPickerTarget = textareaId;
}

function toggleGifSearch(textareaId) {
  const panel = document.getElementById('gifpanel_' + textareaId);
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) document.getElementById('gifsearch_' + textareaId)?.focus();
}

async function searchGiphy(textareaId) {
  const q = document.getElementById('gifsearch_' + textareaId)?.value.trim();
  if (!q) return;
  const results = document.getElementById('gifresults_' + textareaId);
  results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Recherche…</span>';
  try {
    const r = await api('GET', '/api/giphy?q=' + encodeURIComponent(q));
    if (!r.gifs?.length) { results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Aucun résultat</span>'; return; }
    results.innerHTML = '';
    r.gifs.forEach(gif => {
      const img = document.createElement('img');
      img.src = gif.preview;
      img.title = 'Cliquer pour insérer';
      img.className = 'cr-gif-thumb';
      img.onclick = () => insertGif(textareaId, gif.url);
      results.appendChild(img);
    });
  } catch(e) { results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Erreur Giphy</span>'; }
}

function insertGif(textareaId, gifUrl) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  const md = '![gif](' + gifUrl + ')';
  ta.value = ta.value.slice(0, start) + md + ta.value.slice(start);
  ta.selectionStart = ta.selectionEnd = start + md.length;
  ta.focus();
  const panel = document.getElementById('gifpanel_' + textareaId);
  if (panel) panel.style.display = 'none';
}

function sortScoresDesc(scoresStr) {
  if (!scoresStr) return scoresStr;
  const parts = scoresStr.split(',').map(function(p) {
    const m = p.trim().match(/^(.+?):\s*(.+)$/);
    if (!m) return { raw: p.trim(), name: p.trim(), num: NaN };
    return { raw: p.trim(), name: m[1].trim(), val: m[2].trim(), num: parseFloat(m[2]) };
  });
  // Trier seulement si tous numériques
  if (parts.every(function(p) { return !isNaN(p.num); })) {
    parts.sort(function(a, b) { return b.num - a.num; });
  }
  return parts.map(function(p, i) {
    const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
    return p.val !== undefined ? (medal + p.name + ': ' + p.val) : p.raw;
  }).join(', ');
}

function refreshScoresGrid(g) {
  const grid = document.getElementById('agScoresGrid');
  const hidden = document.getElementById('agScores');
  if (!grid) return;

  // Récupérer les joueurs actuellement sélectionnés
  const joueursInput = document.getElementById('agJoueurs');
  const joueurs = joueursInput?.value ? joueursInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];

  // Parser les scores existants: "Alice: 87, Bob: 72"
  const existingScores = {};
  (g?.scores || hidden?.value || '').split(',').forEach(part => {
    const m = part.trim().match(/^(.+?):\s*(.+)$/);
    if (m) existingScores[m[1].trim()] = m[2].trim();
  });

  if (!joueurs.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Ajoutez des joueurs pour saisir les scores</div>';
    return;
  }

  grid.innerHTML = joueurs.map(j => `
    <div class="score-row">
      <span class="score-name">${esc(j)}</span>
      <input class="form-input score-input" id="score_${esc(j).replace(/\s/g,'_')}" value="${esc(existingScores[j]||'')}" placeholder="0" oninput="updateScoresHidden()">
    </div>
  `).join('');
}

function updateScoresHidden() {
  const hidden = document.getElementById('agScores');
  const grid = document.getElementById('agScoresGrid');
  if (!hidden) return;
  const joueursInput = document.getElementById('agJoueurs');
  const joueurs = joueursInput?.value ? joueursInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  // Collecter scores actuels
  const rows = joueurs.map(j => {
    const input = document.getElementById('score_' + j.replace(/\s/g,'_'));
    const val = input?.value.trim() || '';
    return { j, val, num: parseFloat(val) };
  });
  // Sauvegarder
  hidden.value = rows.filter(r => r.val).map(r => r.j + ': ' + r.val).join(', ');
  // Réordonner visuellement si tous les scores sont numériques
  if (grid && rows.every(r => !r.val || !isNaN(r.num))) {
    const sorted = [...rows].sort((a, b) => {
      if (!a.val && !b.val) return 0;
      if (!a.val) return 1;
      if (!b.val) return -1;
      return b.num - a.num;
    });
    sorted.forEach(function(r, i) {
      const row = grid.querySelector('.score-row:nth-child(' + (i+1) + ')');
    });
    // Reconstruire les rows dans le bon ordre en préservant les valeurs
    const vals = {};
    rows.forEach(r => { vals[r.j] = r.val; });
    grid.innerHTML = sorted.map(function(r, i) {
      const medal = i === 0 && r.val ? '🥇 ' : i === 1 && r.val ? '🥈 ' : i === 2 && r.val ? '🥉 ' : '';
      return '<div class="score-row">'
        + '<span class="score-name">' + medal + esc(r.j) + '</span>'
        + '<input class="form-input score-input" id="score_' + esc(r.j).replace(/\s/g,'_') + '" value="' + esc(r.val) + '" placeholder="0" oninput="updateScoresHidden()">'
        + '</div>';
    }).join('');
  }
}

// ═══════════════════════════════════════════════════
// ARCHIVE GAME HELPERS
// ═══════════════════════════════════════════════════
function prefillArchiveGame(name, thumb, bggId) {
  const n = document.getElementById('agName');
  const t = document.getElementById('agThumb');
  if (n) n.value = name;
  if (t && thumb) t.value = thumb;
  // Highlight
  if (n) { n.focus(); n.select(); }
}

function buildVainqueurOptions(joueurs, current) {
  // Joueurs du jeu en priorité, sinon participants de la séance
  let list = joueurs ? joueurs.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  if (!list.length) {
    (currentSession.participants || []).forEach(function(p) { list.push(p.username); });
  }
  return list.map(function(name) {
    const sel = current === name ? ' selected' : '';
    return '<option value="' + esc(name) + '"' + sel + '>' + esc(name) + '</option>';
  }).join('');
}

function selectVainqueur(name) {
  const f = document.getElementById('agVainqueurFree');
  const h = document.getElementById('agVainqueur');
  const s = document.getElementById('agVainqueurFreeSugg');
  const sel = document.getElementById('agVainqueurSel');
  if (f) f.value = name;
  if (h) h.value = name;
  if (s) s.style.display = 'none';
  if (sel) sel.value = '';
}

function onVainqueurSelChange() {
  const sel = document.getElementById('agVainqueurSel');
  const free = document.getElementById('agVainqueurFree');
  const hidden = document.getElementById('agVainqueur');
  if (free && sel.value) free.value = '';
  if (hidden) hidden.value = sel.value;
}

function onVainqueurFreeInput(input) {
  const q = input.value.trim().toLowerCase();
  const hidden = document.getElementById('agVainqueur');
  const sel = document.getElementById('agVainqueurSel');
  const sugg = document.getElementById('agVainqueurFreeSugg');
  if (sel) sel.value = '';
  if (hidden) hidden.value = input.value.trim();
  if (!sugg) return;
  if (!q) { sugg.style.display = 'none'; return; }
  let list = (window._allUsers || currentSession.participants || []).map(function(u) { return u.username; });
  const matches = list.filter(function(n) { return n.toLowerCase().includes(q); });
  if (!matches.length) { sugg.style.display = 'none'; return; }
  sugg.innerHTML = matches.map(function(n) {
    const enc = encodeURIComponent(n);
    return '<div class="tag-sugg-item" onmousedown="event.preventDefault();selectVainqueur(decodeURIComponent(\'' + enc + '\'))">' + esc(n) + '</div>';
  }).join('');
  sugg.style.display = 'block';
}

// Mettre à jour le select vainqueur quand les joueurs changent
function refreshVainqueurSelect() {
  const sel = document.getElementById('agVainqueurSel');
  if (!sel) return;
  const joueurs = document.getElementById('agJoueurs')?.value || '';
  const current = document.getElementById('agVainqueur')?.value || '';
  sel.innerHTML = '<option value="">— Sélectionner —</option>' + buildVainqueurOptions(joueurs, current);
}

function archiveGameAC(input) {
  const q = input.value.trim();
  const sugg = document.getElementById('agNameSugg');
  if (!sugg) return;
  if (q.length < 2) { sugg.style.display = 'none'; return; }
  const local = (currentSession.proposals || []).filter(function(p) { return p.name.toLowerCase().includes(q.toLowerCase()); });
  let html = local.map(function(p) {
    const n = esc(p.name);
    const t = p.thumbnail ? '<img src="' + esc(p.thumbnail) + '" style="width:20px;height:20px;border-radius:3px;object-fit:cover">' : '<span>🎲</span>';
    return '<div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px" onmousedown="event.preventDefault();document.getElementById(' + "'agName'" + ').value=' + "'" + n.replace("'", "\\'") + "'" + ';document.getElementById(' + "'agNameSugg'" + ').style.display=' + "'none'" + '">' + t + '<span>' + n + '</span></div>';
  }).join('');
  if (html) { sugg.innerHTML = html; sugg.style.display = 'block'; }
  clearTimeout(window._agACTimer);
  window._agACTimer = setTimeout(async function() {
    const res = await api('GET', '/api/bgg/search?q=' + encodeURIComponent(q));
    const bggGames = (res.games || []).slice(0, 5);
    if (!bggGames.length) return;
    const bggHtml = bggGames.map(function(g) {
      const n = esc(g.name);
      const t = g.thumbnail ? '<img src="' + esc(g.thumbnail) + '" style="width:20px;height:20px;border-radius:3px;object-fit:cover">' : '<span>🎲</span>';
      return '<div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px" onmousedown="event.preventDefault();document.getElementById(' + "'agName'" + ').value=decodeURIComponent(' + "'" + encodeURIComponent(g.name) + "'" + ');if(document.getElementById(' + "'agThumb'" + '))document.getElementById(' + "'agThumb'" + ').value=' + "'" + esc(g.thumbnail||'').replace("'","\\'") + "'" + ';document.getElementById(' + "'agNameSugg'" + ').style.display=' + "'none'" + '">' + t + '<span>' + n + '</span><span style="font-size:.6rem;color:var(--accent2);margin-left:auto">BGG</span></div>';
    }).join('');
    sugg.innerHTML = (html || '') + bggHtml;
    sugg.style.display = 'block';
  }, 600);
}

async function searchBGGForArchive() {
  const q = document.getElementById('agBggSearch')?.value.trim();
  if (!q) return;
  const res = document.getElementById('agBggResults');
  res.style.display = 'block';
  res.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Recherche…</span>';
  const r = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (!r.results?.length) { res.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Aucun résultat</span>'; return; }
  res.innerHTML = r.results.slice(0, 6).map(g => `
    <div class="bgg-result-item" onclick="prefillArchiveGame('${esc(g.name).replace(/'/g,"\\'")}','${esc(g.thumbnail||'').replace(/'/g,"\\'")}','${g.id}')">
      ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<div style="width:28px;height:28px;border-radius:4px;background:var(--surface3);flex-shrink:0"></div>'}
      <span style="font-size:.78rem">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted)">(${g.year})</span>` : ''}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════
// TAG INPUT (joueurs autocomplete)
// ═══════════════════════════════════════════════════
function initTagInput(inputId, tagsId, hiddenId, suggId, suggestions, initialValues, onChange) {
  const input = document.getElementById(inputId);
  const tagsEl = document.getElementById(tagsId);
  const hidden = document.getElementById(hiddenId);
  const sugg = document.getElementById(suggId);
  if (!input) return;

  let selected = [...initialValues];

  function render() {
    tagsEl.innerHTML = selected.map(v => `
      <span class="tag-chip">${esc(v)}<button onclick="removeTag('${inputId}','${tagsId}','${hiddenId}','${suggId}',this)" data-val="${esc(v)}">×</button></span>
    `).join('');
    hidden.value = selected.join(', ');
    if (onChange) onChange(selected);
  }

  function showSugg(val) {
    const q = val.toLowerCase();
    const matches = suggestions.filter(s => s.toLowerCase().includes(q) && !selected.includes(s));
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.style.display = 'block';
    sugg.innerHTML = matches.map(s => `<div class="tag-sugg-item" onmousedown="addTag('${inputId}','${tagsId}','${hiddenId}','${suggId}','${s.replace(/'/g,"\\'")}');event.preventDefault()">${esc(s)}</div>`).join('');
  }

  input.oninput = () => showSugg(input.value);
  input.onfocus = () => showSugg(input.value);
  input.onblur = () => setTimeout(() => { sugg.style.display = 'none'; }, 150);
  input.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !selected.includes(val)) { selected.push(val); render(); }
      input.value = '';
      sugg.style.display = 'none';
    } else if (e.key === 'Backspace' && !input.value && selected.length) {
      selected.pop(); render();
    }
  };

  // stocker selected sur l'élément pour y accéder depuis addTag/removeTag
  input._selected = selected;
  input._render = render;
  render();
}

function addTag(inputId, tagsId, hiddenId, suggId, val) {
  const input = document.getElementById(inputId);
  if (!input._selected.includes(val)) { input._selected.push(val); input._render(); }
  input.value = '';
  document.getElementById(suggId).style.display = 'none';
}

function removeTag(inputId, tagsId, hiddenId, suggId, btn) {
  const input = document.getElementById(inputId);
  const val = btn.dataset.val;
  input._selected = input._selected.filter(s => s !== val);
  input._render();
}

// ═══════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════
async function loadStats(year) {
  const el = document.getElementById('statsContent');
  el.innerHTML = '<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Chargement…</span></div>';
  const url = year ? `/api/stats?year=${year}` : '/api/stats';
  const r = await api('GET', url);
  window._gameRankings = r.gameRankings || [];

  const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', {month:'long', year:'numeric'}) : '—';

  el.innerHTML = `
    <!-- Sélecteur d'année -->
    <div class="stats-year-tabs">
      <button class="stats-year-tab ${!r.currentYear ? 'active' : ''}" onclick="loadStats()">All-time</button>
      ${(r.years||[]).map(y => `<button class="stats-year-tab ${r.currentYear===y?'active':''}" onclick="loadStats('${y}')">${y}</button>`).join('')}
    </div>

    <!-- Chiffres clés -->
    <div class="stats-kpis">
      <div class="stats-kpi"><div class="stats-kpi-val">${r.seancesInfo?.total || 0}</div><div class="stats-kpi-label">Séances jouées</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.mostPlayed?.reduce((s,g) => s + Number(g.nb_parties), 0) || 0}</div><div class="stats-kpi-label">Parties jouées</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.mostPlayed?.length || 0}</div><div class="stats-kpi-label">Jeux différents</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.playerStats?.length || 0}</div><div class="stats-kpi-label">Joueurs</div></div>
    </div>

    <!-- Classement joueurs -->
    <div class="stats-section">
      <div class="stats-section-title">🏆 Classement joueurs</div>
      <div class="stats-table-wrap">
        <table class="stats-table">
          <thead><tr><th>#</th><th>Joueur</th><th>Parties</th><th>Victoires</th><th>% Victoires</th><th>Séances</th></tr></thead>
          <tbody>
            ${(r.playerStats||[]).map((p,i) => `
              <tr class="${i===0?'stats-row-gold':i===1?'stats-row-silver':i===2?'stats-row-bronze':''}">
                <td class="stats-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
                <td class="stats-name">${esc(p.name)}</td>
                <td>${p.parties}</td>
                <td><strong>${p.victoires}</strong></td>
                <td>
                  <div class="stats-bar-wrap">
                    <div class="stats-bar" style="width:${p.pct_victoires}%"></div>
                    <span>${p.pct_victoires}%</span>
                  </div>
                </td>
                <td>${p.seances}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Jeux les plus joués -->
    <div class="stats-section">
      <div class="stats-section-title">🎲 Jeux les plus joués</div>
      <div class="stats-games-grid">
        ${(r.mostPlayed||[]).map((g,i) => `
          <div class="stats-game-card">
            ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" class="stats-game-thumb" onerror="this.style.display='none'">` : '<div class="stats-game-thumb-ph">🎲</div>'}
            <div class="stats-game-info">
              <div class="stats-game-name">${esc(g.game_name)}</div>
              <div class="stats-game-meta">${g.nb_parties} partie${g.nb_parties>1?'s':''}</div>
              ${g.champion ? `<div class="stats-game-champ">🏆 ${esc(g.champion)}</div>` : ''}
            </div>
            <div class="stats-game-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Champions par jeu -->
    <div class="stats-section">
      <div class="stats-section-title">👑 Champions par jeu</div>
      ${(r.champions||[]).filter(g=>g.champion||g.vainqueur).length ? `
      <div style="position:relative;margin-bottom:10px">
        <input class="form-input" id="champSearch" placeholder="Rechercher un jeu…" autocomplete="off"
          oninput="filterChampions(this.value)">
      </div>
      <div id="champsGrid" class="stats-champs-grid">
        ${(r.champions||[]).filter(g=>g.champion||g.vainqueur).map(g => `
          <div class="stats-champ-card" data-game="${esc((g.game_name||'').toLowerCase())}">
            ${g.thumbnail ? '<img src="' + esc(g.thumbnail) + '" class="stats-champ-thumb" onerror="this.style.display=\'none\'">' : ''}
            <div class="stats-champ-info">
              <div class="stats-champ-game">${esc(g.game_name)}</div>
              <div class="stats-champ-name">👑 ${esc(g.vainqueur||g.champion)}</div>
              <div class="stats-champ-nb">${g.nb_victoires} victoire${g.nb_victoires>1?'s':''}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div style="font-size:.78rem;color:var(--text-muted);font-style:italic">Pas encore de données</div>'}
    </div>

    ${r.neverPlayed?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">😴 Votés mais jamais joués</div>
      <div class="stats-never-list">
        ${r.neverPlayed.map(g => `<div class="stats-never-item">
          ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<div style="width:32px;height:32px;border-radius:4px;background:var(--surface2);flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
          <span style="flex:1">${esc(g.name)}</span>
          <span style="color:var(--text-muted);font-size:.7rem">${g.nb_votes} vote${g.nb_votes>1?'s':''}</span>
        </div>`).join('')}
      </div>
    </div>` : '<div class="stats-section"><div class="stats-section-title">😴 Votés mais jamais joués</div><div style="font-size:.78rem;color:var(--text-muted);font-style:italic">Tous les jeux votés ont été joués 🎉</div></div>'}

    ${r.gameRankings?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">🏅 Records par jeu</div>
      <div style="position:relative;margin-bottom:10px">
        <input class="form-input" id="gameRankingSearch" placeholder="Rechercher un jeu…" autocomplete="off"
          oninput="filterGameRankings(this.value)"
          onfocus="filterGameRankings(this.value)"
          onblur="setTimeout(()=>document.getElementById('gameRankingSugg').style.display='none',150)">
        <div id="gameRankingSugg" class="tag-suggestions" style="display:none"></div>
      </div>
      <div id="gameRankingResult"></div>
    </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════
// GAME RANKINGS SEARCH
// ═══════════════════════════════════════════════════
function filterChampions(q) {
  const grid = document.getElementById('champsGrid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.stats-champ-card');
  const search = q.toLowerCase().trim();
  cards.forEach(function(card) {
    const game = card.dataset.game || '';
    card.style.display = (!search || game.includes(search)) ? '' : 'none';
  });
}

function filterGameRankings(q) {
  const rankings = window._gameRankings || [];
  const sugg = document.getElementById('gameRankingSugg');
  if (!sugg) return;
  const matches = rankings.filter(g => g.game_name.toLowerCase().includes(q.toLowerCase()));
  if (!matches.length) { sugg.style.display = 'none'; return; }
  sugg.style.display = 'block';
  sugg.innerHTML = matches.slice(0, 8).map(g => `
    <div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px"
      onmousedown="showGameRanking('${g.game_name.replace(/'/g,"\\'").replace(/"/g,'\\"')}');event.preventDefault()">
      ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<span>🎲</span>'}
      <span>${esc(g.game_name)}</span>
      <span style="color:var(--text-muted);font-size:.68rem;margin-left:auto">${g.players.length} joueur${g.players.length>1?'s':''}</span>
    </div>`).join('');
}

function showGameRanking(gameName) {
  const rankings = window._gameRankings || [];
  const g = rankings.find(r => r.game_name === gameName);
  const input = document.getElementById('gameRankingSearch');
  const sugg = document.getElementById('gameRankingSugg');
  const result = document.getElementById('gameRankingResult');
  if (!g || !result) return;
  if (input) input.value = g.game_name;
  if (sugg) sugg.style.display = 'none';
  result.innerHTML = `
    <div class="stats-game-ranking">
      <div class="stats-game-ranking-header">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0">` : '<div style="width:36px;height:36px;border-radius:6px;background:var(--surface2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🎲</div>'}
        <span class="stats-game-name" style="font-size:1rem">${esc(g.game_name)}</span>
      </div>
      <table class="stats-table" style="margin-top:8px">
        <thead><tr><th>#</th><th>Joueur</th><th>Meilleur</th><th>Moyenne</th><th>Parties</th><th>Victoires</th></tr></thead>
        <tbody>
          ${g.players.map((p,i) => `<tr class="${i===0?'stats-row-gold':i===1?'stats-row-silver':i===2?'stats-row-bronze':''}">
            <td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
            <td><strong>${esc(p.name)}</strong></td>
            <td>${p.best}</td>
            <td>${p.avg}</td>
            <td>${p.nb_parties}</td>
            <td>${p.wins > 0 ? '🏆×'+p.wins : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
// EDIT SESSION
// ═══════════════════════════════════════════════════
function openEditSession() {
  // Formulaire inline sous la barre de gestion — évite les bugs de modal sur Android
  const existing = document.getElementById('inlineEditForm');
  if (existing) { existing.remove(); return; } // toggle

  const form = document.createElement('div');
  form.id = 'inlineEditForm';
  form.style.cssText = 'background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:14px;margin:8px 0 12px;display:flex;flex-direction:column;gap:8px;';
  form.innerHTML = `
    <div style="font-size:.72rem;font-weight:600;color:var(--accent);margin-bottom:2px">✏️ Modifier la séance</div>
    <textarea class="form-input" id="inlineEditName" rows="2"
      placeholder="Nom de la séance"
      style="font-size:16px;resize:none;overflow:auto;white-space:pre-wrap;word-break:break-word;"
    >${esc(currentSession.session.name)}</textarea>
    <input type="date" class="form-input" id="inlineEditDate" value="${currentSession.session.date}" style="font-size:16px">
    <div style="display:flex;gap:8px">
      <button class="btn-sm ghost" onclick="document.getElementById('inlineEditForm').remove()">Annuler</button>
      <button class="btn-sm accent" onclick="saveEditSession()">Enregistrer</button>
    </div>
  `;

  // Insérer sous la barre de gestion
  const mgmt = document.getElementById('sessMgmt');
  mgmt.parentNode.insertBefore(form, mgmt.nextSibling);

  // Focus immédiat
  setTimeout(() => {
    const input = document.getElementById('inlineEditName');
    if (input) { input.focus(); input.select(); }
  }, 50);
}

async function saveEditSession() {
  const name = document.getElementById('inlineEditName')?.value.trim();
  const date = document.getElementById('inlineEditDate')?.value;
  if (!name || !date) { showToast('Nom et date requis'); return; }
  const res = await api('PATCH', `/api/sessions/${currentSession.session.id}`, { name, date });
  if (res.error) { showToast(res.error); return; }
  document.getElementById('inlineEditForm')?.remove();
  await reloadSession();
  showToast('Séance mise à jour !');
}

// ═══════════════════════════════════════════════════
// PRIVATE SESSION MEMBERS
// ═══════════════════════════════════════════════════
async function openPrivateMembersModal() {
  // Charger tous les users et les membres actuels
  const [usersRes, members] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', `/api/sessions/${currentSession.session.id}/private-members`)
  ]);
  const users = usersRes.users || usersRes;
  const memberIds = new Set(members.map(m => m.id));
  const creatorId = currentSession.session.created_by;
  const container = document.getElementById('privateMembersList');
  container.innerHTML = users.filter(u => u.id !== creatorId).map(u =>
    `<label class="priv-member-item">
      <input type="checkbox" value="${u.id}" class="priv-edit-cb" ${memberIds.has(u.id) ? 'checked' : ''}>
      ${esc(u.username)}
    </label>`
  ).join('');
  openModal('privateMembersModal');
}

async function savePrivateMembers() {
  const ids = [...document.querySelectorAll('.priv-edit-cb:checked')].map(cb => parseInt(cb.value));
  // Toujours inclure le créateur
  ids.push(currentSession.session.created_by);
  await api('PUT', `/api/sessions/${currentSession.session.id}/private-members`, { user_ids: ids });
  closeModal('privateMembersModal');
  showToast('Membres mis à jour !');
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// profile.js — Page profil utilisateur
//
// Contient :
//   - loadProfile()          Affiche les infos du profil et le formulaire d'édition
//   - saveBGG()              Sauvegarde le pseudo BGG et déclenche la sync collection
//   - changeUsername()       Change le pseudo de l'utilisateur
//   - changePassword()       Change le mot de passe
// ─────────────────────────────────────────────────────────────

// PROFILE
// ═══════════════════════════════════════════════════
function loadProfile() {
  document.getElementById('profUsername').value = currentUser.username;
  document.getElementById('profBGG').value = currentUser.bgg_username || '';
  const syncedAt = currentUser.bgg_synced_at;
  document.getElementById('syncStatus').textContent = syncedAt ? `Dernière sync: ${new Date(syncedAt).toLocaleDateString('fr-FR')}` : '';
  // Afficher le champ email si reset par email activé
  if (sitePermissions['email_reset_enabled']) {
    const emailGroup = document.getElementById('emailFieldGroup');
    if (emailGroup) {
      emailGroup.style.display = '';
      document.getElementById('profEmail').value = currentUser.email || '';
    }
  }
}

async function saveProfileEmail() {
  const email = document.getElementById('profEmail').value.trim();
  const errEl = document.getElementById('emailErr');
  errEl.style.display = 'none';
  const res = await api('PATCH', '/api/profile/email', { email });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = ''; return; }
  currentUser.email = email;
  showToast('Email enregistré');
}

async function doForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  const btn = document.getElementById('forgotBtn');
  btn.disabled = true;
  msg.innerHTML = '';
  const res = await fetch('/api/auth/forgot-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
  const data = await res.json();
  btn.disabled = false;
  if (data.error) {
    msg.innerHTML = `<div class="auth-err" style="display:block">${esc(data.error)}</div>`;
  } else {
    msg.innerHTML = `<div style="padding:10px;background:rgba(58,122,80,.15);border:1px solid rgba(58,122,80,.3);border-radius:8px;font-size:.8rem;color:#70c090;margin-bottom:12px">✅ Si cet email est associé à un compte, vous recevrez un lien dans quelques minutes.</div>`;
  }
}

async function saveEmailResetSetting(enabled) {
  await api('PATCH', '/api/settings', { key: 'email_reset_enabled', value: enabled });
  document.getElementById('emailSettingsPanel').style.display = enabled ? '' : 'none';
  sitePermissions['email_reset_enabled'] = enabled;
  showToast(enabled ? 'Reset par email activé' : 'Reset par email désactivé');
}

async function saveSiteName(name) {
  await api('PATCH', '/api/settings', { key: 'site_name', value: name });
  showToast('Nom du site enregistré');
}

async function testEmailSMTP() {
  const resultEl = document.getElementById('smtpTestResult');
  resultEl.textContent = '⏳ Test en cours…';
  const res = await api('POST', '/api/settings/test-smtp');
  if (res.ok) resultEl.innerHTML = '<span style="color:var(--green-text)">✅ SMTP OK — email de test envoyé</span>';
  else resultEl.innerHTML = `<span style="color:var(--red-text)">❌ ${esc(res.error || 'Erreur inconnue')}</span>`;
}

async function saveBGG() {
  const bggUsername = document.getElementById('profBGG').value.trim();
  document.getElementById('syncStatus').textContent = 'Synchronisation…';
  const res = await api('PATCH', '/api/me', { bggUsername });
  if (res.error) { showToast(res.error); return; }
  currentUser.bgg_username = bggUsername;
  if (res.synced !== undefined) {
    showToast(`Collection synchronisée — ${res.synced} jeux !`);
    document.getElementById('syncStatus').textContent = `${res.synced} jeux synchronisés`;
  } else if (res.syncError) {
    showToast('BGG: ' + res.syncError);
    document.getElementById('syncStatus').textContent = 'Erreur: ' + res.syncError;
  }
}

async function enrichSessionProposals() {
  const sessionId = currentSession.session.id;
  showToast('Enrichissement BGG en cours…');
  const res = await api('POST', `/api/sessions/${sessionId}/bgg/enrich`);
  if (res.ok) {
    showToast(`✓ ${res.count} jeu(x) enrichis (note + weight BGG)`);
    await reloadSession();
  } else {
    showToast('Erreur lors de l\'enrichissement');
  }
}

async function manualSync() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true; btn.textContent = '⏳ Sync…';
  document.getElementById('syncStatus').textContent = 'Synchronisation en cours…';
  const res = await api('POST', '/api/bgg/sync');
  btn.disabled = false; btn.textContent = '🔄 Sync maintenant';
  if (res.error) { showToast(res.error); document.getElementById('syncStatus').textContent = 'Erreur: ' + res.error; return; }
  showToast(`${res.count} jeux synchronisés !`);
  document.getElementById('syncStatus').textContent = `${res.count} jeux — synchronisé à l'instant`;
}

async function changeUsername() {
  const val = document.getElementById('profUsername').value.trim();
  const errEl = document.getElementById('usernameErr');
  errEl.style.display = 'none';
  if (!val || val.length < 2) { errEl.textContent = 'Pseudo trop court (2 min)'; errEl.style.display = ''; return; }
  if (val === currentUser.username) { showToast('Pseudo inchangé'); return; }
  const r = await api('PATCH', '/api/me', { username: val, bggUsername: currentUser.bgg_username || '' });
  if (r.error) { errEl.textContent = r.error; errEl.style.display = ''; return; }
  currentUser.username = val;
  document.getElementById('homeUsername') && (document.getElementById('homeUsername').textContent = val);
  showToast('Pseudo mis à jour !');
}

async function changePassword() {
  const newPass = document.getElementById('profNewPass').value;
  if (newPass.length < 6) { showToast('6 caractères minimum'); return; }
  const res = await api('PATCH', '/api/me', { password: newPass });
  if (res.error) { showToast(res.error); return; }
  showToast('Mot de passe changé !');
  document.getElementById('profNewPass').value = '';
}

// ═══════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// admin.js — Page d'administration
//
// Contient :
//   - loadAdmin()               Charge la page admin (permissions, users, invites, etc.)
//   - renderPermissionsTable()  Affiche le tableau des permissions par action
//   - savePermissions()         Sauvegarde les permissions via API
//   - renderAdminUsers()        Liste les utilisateurs avec actions (delete, reset)
//   - generateInviteLink()      Crée un lien d'invitation
//   - toggleAdminSection()      Ouvre/ferme une section collapsible
// ─────────────────────────────────────────────────────────────

// ADMIN
// ═══════════════════════════════════════════════════
function copyAdminResetUrl() {
  const url = document.getElementById('adminResetUrl')?.textContent;
  if (url) { navigator.clipboard.writeText(url); showToast('URL copiée !'); }
}

function toggleSimVotes(enabled) {
  sessionStorage.setItem('simVotesEnabled', enabled ? '1' : '0');
  showToast(enabled ? '🤖 Simulation activée' : 'Simulation désactivée');
}

const PERM_LABELS = {
  session_create:     '📅 Créer une séance',
  session_edit:       '✏️ Modifier une séance',
  session_delete:     '🗑 Supprimer une séance',
  proposal_add:       '➕ Ajouter un jeu',
  proposal_edit:      '✏️ Modifier un jeu',
  proposal_delete:    '✕ Supprimer un jeu',
  vote:               '🗳 Voter',
  vote_lock:          '🔒 Verrouiller les votes',
  programme_generate: '✨ Générer un programme (IA)',
  programme_edit:     '🔧 Modifier les créneaux',
  programme_publish:  '✅ Publier le programme',
  report_media:       '📷 Ajouter des médias (CR)',
  report_scores:      '🏆 Ajouter des scores (CR)',
  report_notes:       '📝 Ajouter des notes (CR)',
};

const PERM_LEVEL_LABELS = ['Tous les membres', 'Créateur / Proposant', 'Admin uniquement'];

function renderPermissionsPanel(permissions) {
  const panel = document.getElementById('permissionsPanel');
  if (!panel) return;
  const permsMap = {};
  permissions.forEach(p => permsMap[p.action] = p.level);

  panel.innerHTML = `
    <table style="width:100%;font-size:.78rem;border-collapse:collapse">
      <thead>
        <tr style="color:var(--text-muted);text-align:left">
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Action</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Qui peut faire ça ?</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(PERM_LABELS).map(([action, label]) => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid var(--border2)">${label}</td>
            <td style="padding:8px;border-bottom:1px solid var(--border2)">
              <select class="form-input" style="font-size:.75rem;padding:4px 8px" onchange="savePermission('${action}', parseInt(this.value))">
                ${PERM_LEVEL_LABELS.map((l, i) => `<option value="${i}" ${(permsMap[action]??0) === i ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

async function savePermission(action, level) {
  await api('PATCH', '/api/permissions', { permissions: [{ action, level }] });
  sitePermissions[action] = level;
}

function isSimVotesEnabled() {
  return sessionStorage.getItem('simVotesEnabled') === '1';
}

async function savePlayersScopeSetting(val) {
  await api('PATCH', '/api/permissions', { permissions: [{ action: 'players_scope', level: val }] });
  sitePermissions['players_scope'] = val;
}

function openRankingsPopup() {
  const participants = currentSession.participants;
  const proposals = currentSession.proposals;
  const rankings = currentSession.rankings;
  const content = participants.map(p => {
    const catBlocks = currentSession.categories.map(cat => {
      const catRankings = rankings.filter(r => r.user_id === p.id && r.category_id === cat.id).sort((a,b) => a.rank - b.rank);
      if (!catRankings.length) return '';
      const games = catRankings.map(r => {
        const prop = proposals.find(x => x.id === r.proposal_id);
        return prop ? `<div style="font-size:.78rem;padding:2px 0"><span style="color:var(--text-muted);min-width:18px;display:inline-block">${r.rank}.</span> ${esc(prop.name)}</div>` : '';
      }).filter(Boolean).join('');
      return `<div style="margin-bottom:8px">
        <div style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">${esc(cat.icon)} ${esc(cat.name)}</div>
        ${games}
      </div>`;
    }).filter(Boolean).join('');
    if (!catBlocks) return '';
    return `<div style="border-top:1px solid var(--border);padding:12px 0">
      <div style="font-size:.85rem;font-weight:700;margin-bottom:8px">👤 ${esc(p.username)}</div>
      ${catBlocks}
    </div>`;
  }).join('');
  document.getElementById('rankingsPopupContent').innerHTML = content || '<div style="color:var(--text-muted);font-size:.8rem">Aucun vote enregistré.</div>';
  const popup = document.getElementById('rankingsPopup');
  const title = popup.querySelector('.modal-title');
  if (title) title.textContent = '📊 Classements individuels';
  popup.classList.add('open');
  popup.onclick = e => { if (e.target === popup) popup.classList.remove('open'); };
}

// ── Thème CSS ────────────────────────────────────────────────

async function loadAdmin() {
  // Sync checkbox état
  const toggle = document.getElementById('simVotesToggle');
  if (toggle) toggle.checked = isSimVotesEnabled();

  // Init email reset toggle
  const emailToggle = document.getElementById('emailResetToggle');
  const emailEnabled = !!sitePermissions['email_reset_enabled'];
  if (emailToggle) emailToggle.checked = emailEnabled;
  const emailPanel = document.getElementById('emailSettingsPanel');
  if (emailPanel) emailPanel.style.display = emailEnabled ? '' : 'none';
  // Pré-remplir nom du site
  const siteNameInput = document.getElementById('siteNameInput');
  if (siteNameInput) {
    const r = await api('GET', '/api/settings');
    if (r.settings?.site_name) siteNameInput.value = r.settings.site_name;
    // Clé Google Maps
    const mapsKeyInput = document.getElementById('googleMapsKeyInput');
    if (mapsKeyInput && r.settings?.google_maps_key) mapsKeyInput.value = r.settings.google_maps_key;
  }

  // Afficher l'URL de récupération admin
  const resetUrlEl = document.getElementById('adminResetUrl');
  if (resetUrlEl) resetUrlEl.textContent = `${location.origin}/admin-reset?token=VOTRE_ADMIN_RESET_TOKEN`;

  // Charger et afficher les permissions
  const permRes = await api('GET', '/api/permissions');
  if (permRes.permissions) {
    sitePermissions = {};
    permRes.permissions.forEach(p => sitePermissions[p.action] = p.level);
    renderPermissionsPanel(permRes.permissions);
    // Sync radio players scope
    const scope = sitePermissions['players_scope'] ?? 0;
    const radios = document.querySelectorAll('input[name="playersScope"]');
    radios.forEach(r => r.checked = parseInt(r.value) === scope);
  }
  renderThemeEditor();

  const res = await api('GET', '/api/invites');
  const list = document.getElementById('invitesList');
  list.innerHTML = '';
  if (res.invites?.length) {
    res.invites.forEach(inv => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.7rem;';
      d.innerHTML = `
        <span style="color:${inv.used_by_name ? 'var(--text-muted)' : 'var(--accent)'}">
          ${inv.used_by_name ? `✓ Utilisé par ${esc(inv.used_by_name)}` : `🔗 Actif`}
        </span>
        <span style="color:var(--text-muted)">${new Date(inv.created_at).toLocaleDateString('fr-FR')}</span>
        ${!inv.used_by_name && inv.is_active ? `<button class="btn-sm ghost" onclick="copyInvite('${inv.token}')">Copier le lien</button>` : ''}
      `;
      list.appendChild(d);
    });
  }

  const usersRes = await api('GET', '/api/admin/users');
  const tbody = document.getElementById('adminUsersList');
  tbody.innerHTML = `<table class="users-table">
    <thead><tr><th>Pseudo</th><th>BGG</th><th>Jeux</th><th>Inscrit le</th><th></th></tr></thead>
    <tbody>${(usersRes.users || []).map(u => `
      <tr>
        <td>${esc(u.username)} ${u.is_admin ? '<span style="color:var(--accent)">★</span>' : ''}</td>
        <td style="color:var(--text-muted)">${esc(u.bgg_username || '—')}</td>
        <td style="color:var(--text-muted)">${u.game_count || 0}</td>
        <td style="color:var(--text-muted)">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
        <td style="display:flex;gap:4px">
          <button class="btn-sm ghost" onclick="generateResetLink(${u.id},'${esc(u.username)}')">🔑 Reset</button>
          ${u.is_admin ? '' : `<button class="btn-sm danger" onclick="deleteUser(${u.id},'${esc(u.username)}')">Supprimer</button>`}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Section backup
  const backupSection = document.getElementById('backupSection');
  if (backupSection) {
    backupSection.style.display = 'block';
    loadBackups();
  }
}

async function createInvite() {
  const res = await api('POST', '/api/invites');
  const el = document.getElementById('inviteResult');
  el.innerHTML = `<div class="invite-link" onclick="copyInviteLink('${res.link}')">🔗 ${res.link}<br><small style="color:var(--text-muted)">Cliquez pour copier</small></div>`;
  loadAdmin();
}

function copyInviteLink(link) { navigator.clipboard.writeText(link); showToast('Lien copié !'); }
function copyInvite(token) { navigator.clipboard.writeText(`${location.origin}/register?invite=${token}`); showToast('Lien copié !'); }

async function generateResetLink(id, name) {
  const res = await api('POST', `/api/admin/reset-link/${id}`);
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  // Afficher le lien dans une modale simple
  const msg = `Lien de réinitialisation pour ${name} :\n\n${res.link}\n\nValable 24h. Copiez et envoyez-le à l'utilisateur.`;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(res.link);
    showToast(`🔑 Lien copié pour ${name} !`);
  } else {
    prompt('Lien de reset (copiez-le) :', res.link);
  }
}

async function deleteUser(id, name) {
  if (!confirm(`Supprimer l'utilisateur "${name}" ?`)) return;
  await api('DELETE', `/api/admin/users/${id}`);
  loadAdmin();
}

async function loadBackups() {
  const r = await api('GET', '/api/admin/backup/list');
  const el = document.getElementById('backupList');
  if (!el) return;
  const files = r.files || [];
  if (!files.length) { el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted)">Aucun backup disponible</div>'; return; }
  el.innerHTML = files.map(f => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.75rem;color:var(--text)">${esc(f.name)}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:.7rem;color:var(--text-muted)">${(f.size/1024).toFixed(1)} KB</span>
        <a class="btn-sm ghost" href="/api/admin/backup/download/${esc(f.name)}" download>⬇️</a>
      </div>
    </div>
  `).join('');
}

async function triggerBackup() {
  const r = await api('POST', '/api/admin/backup/now');
  showToast('Backup lancé !');
  setTimeout(loadBackups, 1500);
}

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formatDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }

// ═══════════════════════════════════════════════════


// ── Création d'utilisateur (admin) ──────────────────────────
function toggleCreateUserForm() {
  const form = document.getElementById('createUserForm');
  if (!form) return;
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    document.getElementById('cuUsername').value = '';
    document.getElementById('cuPassword').value = '';
    document.getElementById('cuBgg').value = '';
    setTimeout(() => document.getElementById('cuUsername').focus(), 50);
  }
}

async function createUserAdmin() {
  const username = document.getElementById('cuUsername').value.trim();
  const password = document.getElementById('cuPassword').value;
  const bggUsername = document.getElementById('cuBgg').value.trim();
  if (!username) { showToast('Pseudo requis'); return; }
  if (!password || password.length < 6) { showToast('Mot de passe : 6 caractères minimum'); return; }

  const r = await api('POST', '/api/admin/users', { username, password, bggUsername });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  showToast(`✅ Utilisateur "${username}" créé`);
  toggleCreateUserForm();
  loadAdmin();
}

// ── Classements par jeu ──────────────────────────────────────
function openRankingsByGame() {
  const proposals = currentSession.proposals;
  const rankings = currentSession.rankings;
  const participants = currentSession.participants;

  // Pour chaque jeu, collecter les rangs de chaque joueur (toutes catégories)
  // On prend le meilleur rang par joueur si plusieurs catégories
  const content = proposals.map(prop => {
    // Tous les votes pour ce jeu
    const votes = rankings.filter(r => r.proposal_id === prop.id);
    if (!votes.length) return '';

    // Regrouper par user_id, prendre le meilleur rang
    const bestByUser = {};
    votes.forEach(r => {
      if (!bestByUser[r.user_id] || r.rank < bestByUser[r.user_id].rank) {
        bestByUser[r.user_id] = r;
      }
    });

    // Trier du meilleur rang (1) au moins bon
    const sorted = Object.values(bestByUser).sort((a, b) => a.rank - b.rank);

    const rows = sorted.map(r => {
      const user = participants.find(p => p.id === r.user_id);
      if (!user) return '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.78rem">
        <span style="color:var(--accent);font-weight:700;min-width:24px;text-align:right">${r.rank}.</span>
        <span>${esc(user.username)}</span>
      </div>`;
    }).filter(Boolean).join('');

    if (!rows) return '';

    return `<div style="border-top:1px solid var(--border);padding:12px 0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${prop.thumbnail ? `<img src="${esc(prop.thumbnail)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<span style="font-size:1.2rem">🎲</span>'}
        <div style="font-size:.88rem;font-weight:700">${esc(prop.name)}</div>
      </div>
      ${rows}
    </div>`;
  }).filter(Boolean).join('');

  document.getElementById('rankingsPopupContent').innerHTML = content ||
    '<div style="color:var(--text-muted);font-size:.8rem">Aucun vote enregistré.</div>';
  const popup = document.getElementById('rankingsPopup');
  // Mettre à jour le titre
  const title = popup.querySelector('.modal-title');
  if (title) title.textContent = '🎲 Classements par jeu';
  popup.classList.add('open');
  popup.onclick = e => { if (e.target === popup) popup.classList.remove('open'); };
}

async function saveSiteName(name) {
  await api('PATCH', '/api/settings', { key: 'site_name', value: name });
}

async function saveGoogleMapsKey(key) {
  await api('PATCH', '/api/settings', { key: 'google_maps_key', value: key });
  showToast('Clé Google Maps sauvegardée');
}
// ─────────────────────────────────────────────────────────────
// admin_media.js — Navigateur de fichiers admin (arborescence)
//
// Contient :
//   - scanMedia()             Charge l'arborescence et l'affiche
//   - renderMediaTree()       Affiche la vue arbre avec dossiers dépliables
//   - toggleFolder(name)      Ouvre/ferme un dossier
//   - renameFolder(name)      Prompt et envoi route rename-folder
//   - deleteFolder(name)      Confirmation et envoi route DELETE folder
//   - renameFile(folder,name) Prompt et envoi route rename-file
//   - moveFile(folder,name)   Menu de choix puis envoi route move-file
//   - deleteFile(folder,name) Confirmation et envoi route DELETE file
// ─────────────────────────────────────────────────────────────

let _mediaTree = null;
let _openFolders = new Set();

async function scanMedia() {
  const btn = document.getElementById('mediaScanBtn');
  const results = document.getElementById('mediaScanResults');
  if (!results) return;
  btn.disabled = true;
  btn.textContent = '⏳ Chargement…';
  results.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);padding:8px">Analyse de l\'arborescence…</div>';

  const tree = await api('GET', '/api/admin/media/tree');
  btn.disabled = false;
  btn.textContent = '🔄 Rafraîchir';

  if (tree.error) { results.innerHTML = `<div style="color:var(--red-text)">${esc(tree.error)}</div>`; return; }

  _mediaTree = tree;
  // Par défaut, tous les dossiers fermés
  if (_openFolders.size === 0 && tree.folders.length === 1) {
    _openFolders.add(tree.folders[0].name); // si 1 seul, l'ouvrir
  }
  renderMediaTree();
}

function renderMediaTree() {
  const results = document.getElementById('mediaScanResults');
  if (!results || !_mediaTree) return;

  const t = _mediaTree;
  const fmt = b => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : (b/1024).toFixed(0) + ' KB';

  // Stats globales
  let totalFiles = t.files.length;
  let totalSize = t.files.reduce((s,f) => s+f.size, 0);
  let totalUsed = t.files.filter(f => f.inUse).length;
  for (const folder of t.folders) {
    totalFiles += folder.fileCount;
    totalSize += folder.totalSize;
    totalUsed += folder.usedCount;
  }
  const orphanCount = totalFiles - totalUsed;

  let html = `
    <div class="media-stats-row">
      <div class="media-stat-box">
        <div class="media-stat-num">${t.folders.length}</div>
        <div class="media-stat-label">Dossiers</div>
      </div>
      <div class="media-stat-box">
        <div class="media-stat-num">${totalFiles}</div>
        <div class="media-stat-label">Fichiers</div>
        <div class="media-stat-size">${fmt(totalSize)}</div>
      </div>
      <div class="media-stat-box ${orphanCount ? 'media-stat-warn' : ''}">
        <div class="media-stat-num">${orphanCount}</div>
        <div class="media-stat-label">Orphelins</div>
      </div>
    </div>
  `;

  // Tree
  html += '<div class="media-tree">';

  // Dossiers
  for (const folder of t.folders) {
    const isOpen = _openFolders.has(folder.name);
    html += `
      <div class="media-folder ${isOpen ? 'open' : ''}">
        <div class="media-folder-header" onclick="toggleFolder('${esc(folder.name)}')">
          <span class="media-folder-chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="media-folder-icon">📁</span>
          <span class="media-folder-name">${esc(folder.name)}</span>
          <span class="media-folder-meta">${folder.fileCount} fichier${folder.fileCount>1?'s':''} · ${fmt(folder.totalSize)}${folder.usedCount < folder.fileCount ? ` · <span style="color:var(--accent)">${folder.fileCount - folder.usedCount} orphelin${folder.fileCount - folder.usedCount > 1 ? 's' : ''}</span>` : ''}</span>
          <div class="media-folder-actions" onclick="event.stopPropagation()">
            <button class="btn-icon" title="Renommer le dossier" onclick="renameFolder('${esc(folder.name)}')">✏️</button>
            <button class="btn-icon btn-icon-danger" title="Supprimer le dossier" onclick="deleteFolder('${esc(folder.name)}')">🗑</button>
          </div>
        </div>
        ${isOpen ? renderFolderContent(folder) : ''}
      </div>
    `;
  }

  // Fichiers à la racine
  if (t.files.length) {
    html += '<div class="media-root-files"><div class="media-folder-header"><span style="margin-left:14px">📄 Fichiers à la racine (' + t.files.length + ')</span></div>';
    html += '<div class="media-folder-body">';
    for (const file of t.files) {
      html += renderFileRow(file, '');
    }
    html += '</div></div>';
  }

  html += '</div>';

  if (!t.folders.length && !t.files.length) {
    html += '<div style="font-size:.78rem;color:var(--text-muted);font-style:italic;padding:20px;text-align:center">Aucun fichier dans /uploads</div>';
  }

  results.innerHTML = html;
}

function renderFolderContent(folder) {
  if (!folder.files.length) {
    return '<div class="media-folder-body"><div style="font-size:.72rem;color:var(--text-muted);font-style:italic;padding:8px">Dossier vide</div></div>';
  }
  let html = '<div class="media-folder-body">';
  for (const file of folder.files) {
    html += renderFileRow(file, folder.name);
  }
  html += '</div>';
  return html;
}

function renderFileRow(file, folderName) {
  const fmt = b => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : (b/1024).toFixed(0) + ' KB';
  const isVideo = /\.(mp4|mov|webm|avi)$/i.test(file.url);
  const folderJsParam = JSON.stringify(folderName);
  const nameJsParam = JSON.stringify(file.name);

  let badges = '';
  if (file.inUse) {
    if (file.session_name) badges += `<span class="media-badge">${esc(file.session_name)}</span>`;
    if (file.game_name) badges += `<span class="media-badge media-badge-game">${esc(file.game_name)}</span>`;
    if (file.caption) badges += `<span class="media-badge" style="font-style:italic">"${esc(file.caption.substring(0, 30))}${file.caption.length > 30 ? '…' : ''}"</span>`;
  } else {
    badges += '<span class="media-badge media-badge-warn">orphelin</span>';
  }

  return `
    <div class="media-file-row">
      <div class="media-file-thumb" onclick="openLightbox('${esc(file.url)}','',false)">
        ${isVideo
          ? `<video src="${esc(file.url)}" preload="metadata"></video><div class="media-play-icon">▶</div>`
          : `<img src="${esc(file.url)}" loading="lazy">`}
      </div>
      <div class="media-file-info">
        <div class="media-file-name">${esc(file.name)}</div>
        <div class="media-badges">${badges}</div>
        <div class="media-file-meta">${fmt(file.size)}</div>
      </div>
      <div class="media-file-actions">
        <button class="btn-icon" title="Renommer" onclick='renameFile(${folderJsParam}, ${nameJsParam})'>✏️</button>
        <button class="btn-icon" title="Déplacer" onclick='moveFile(${folderJsParam}, ${nameJsParam})'>📂</button>
        <button class="btn-icon btn-icon-danger" title="Supprimer" onclick='deleteFile(${folderJsParam}, ${nameJsParam})'>🗑</button>
      </div>
    </div>
  `;
}

function toggleFolder(name) {
  if (_openFolders.has(name)) _openFolders.delete(name);
  else _openFolders.add(name);
  renderMediaTree();
}

async function renameFolder(oldName) {
  const newName = prompt('Nouveau nom du dossier :', oldName);
  if (!newName || newName === oldName) return;
  const r = await api('POST', '/api/admin/media/rename-folder', { oldName, newName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  // Mettre à jour l'état des dossiers ouverts
  if (_openFolders.has(oldName)) {
    _openFolders.delete(oldName);
    _openFolders.add(newName);
  }
  showToast(`✅ Dossier renommé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function deleteFolder(name) {
  const folder = _mediaTree.folders.find(f => f.name === name);
  if (!folder) return;
  const msg = `Supprimer le dossier "${name}" et ses ${folder.fileCount} fichier${folder.fileCount>1?'s':''} ?\n\nLes références en base de données seront aussi supprimées.\n\nCette action est irréversible.`;
  if (!confirm(msg)) return;
  const r = await api('DELETE', '/api/admin/media/folder', { name });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  _openFolders.delete(name);
  showToast(`✅ Dossier supprimé (${r.fileCount} fichiers, ${r.dbDeleted} réf BDD)`);
  scanMedia();
}

async function renameFile(folder, oldName) {
  const newName = prompt('Nouveau nom du fichier :', oldName);
  if (!newName || newName === oldName) return;
  const r = await api('POST', '/api/admin/media/rename-file', { folder, oldName, newName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  showToast(`✅ Fichier renommé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function moveFile(fromFolder, fileName) {
  // Construire la liste des dossiers possibles
  const folders = _mediaTree.folders.map(f => f.name).filter(n => n !== fromFolder);
  if (!folders.length && fromFolder === '') { showToast('Aucun autre dossier disponible'); return; }

  const options = [];
  if (fromFolder !== '') options.push({ value: '', label: '(racine)' });
  folders.forEach(f => options.push({ value: f, label: f }));

  // Prompt simple avec liste numérotée
  const msg = 'Choisis le dossier de destination :\n\n' +
    options.map((o, i) => `${i + 1}. ${o.label}`).join('\n') +
    '\n\nEntre le numéro :';
  const choice = prompt(msg);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) { showToast('Choix invalide'); return; }
  const toFolder = options[idx].value;

  const r = await api('POST', '/api/admin/media/move-file', { fromFolder, toFolder, fileName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  // Garder le dossier de destination ouvert
  if (toFolder) _openFolders.add(toFolder);
  showToast(`✅ Fichier déplacé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function deleteFile(folder, name) {
  if (!confirm(`Supprimer le fichier "${name}" ?\n\nLes références en base seront aussi supprimées.`)) return;
  const r = await api('DELETE', '/api/admin/media/file', { folder, name });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  showToast(`✅ Fichier supprimé${r.dbDeleted ? ` (${r.dbDeleted} réf BDD)` : ''}`);
  scanMedia();
}
// ─────────────────────────────────────────────────────────────
// lightbox.js — Galerie photos plein écran
//
// Contient :
//   - openLightbox(url, caption, isEmbed)  Ouvre la lightbox sur une image/vidéo
//   - closeLightbox()                      Ferme la lightbox
//   - lbPrev() / lbNext()                 Navigation entre les médias
// ─────────────────────────────────────────────────────────────

// LIGHTBOX
// ═══════════════════════════════════════════════════
// ── Lightbox avec navigation ─────────────────────────────────────────────────
let _lbItems = [];
let _lbIdx = 0;

function openLightbox(url, caption, isEmbed) {
  // Collecter tous les médias visibles dans le même contexte (même row ou même page)
  _lbItems = [];
  document.querySelectorAll('.arch-photo-wrap[data-mid]').forEach(function(wrap) {
    const img = wrap.querySelector('img.arch-photo-thumb');
    const vidWrap = wrap.querySelector('.arch-video-preview');
    const cap = wrap.querySelector('.arch-caption-edit');
    const capText = cap ? cap.textContent.trim() : '';
    if (img) {
      _lbItems.push({ url: img.src, caption: capText, isEmbed: false });
    } else if (vidWrap) {
      const oc = vidWrap.getAttribute('onclick') || '';
      const m = oc.match(/openLightbox\('([^']+)','[^']*',(\w+)\)/);
      if (m) _lbItems.push({ url: m[1], caption: capText, isEmbed: m[2] === 'true' });
    }
  });
  // Si aucun item collecté, afficher juste l'image courante
  if (_lbItems.length === 0) _lbItems = [{ url, caption: caption||'', isEmbed: !!isEmbed }];
  // Trouver l'index courant
  _lbIdx = _lbItems.findIndex(function(it) { return it.url === url; });
  if (_lbIdx < 0) _lbIdx = 0;
  _lbShow();
  document.getElementById('lightboxOverlay').style.display = 'flex';
  document.addEventListener('keydown', lightboxKeyHandler);
}

function _lbShow() {
  const item = _lbItems[_lbIdx];
  if (!item) return;
  const img = document.getElementById('lightboxImg');
  const vid = document.getElementById('lightboxVideo');
  vid.pause(); vid.src = '';
  if (item.isEmbed) {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = item.url;
  } else if (item.url.match(/\.mp4|\.webm|\.mov/i)) {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = item.url;
    vid.play().catch(function(){});
  } else {
    vid.style.display = 'none';
    img.style.display = 'block';
    img.src = item.url;
  }
  document.getElementById('lightboxCaption').textContent = item.caption || '';
  // Afficher/cacher flèches
  document.getElementById('lbPrev').style.display = _lbIdx > 0 ? 'flex' : 'none';
  document.getElementById('lbNext').style.display = _lbIdx < _lbItems.length - 1 ? 'flex' : 'none';
  document.getElementById('lbCounter').textContent = _lbItems.length > 1 ? (_lbIdx + 1) + ' / ' + _lbItems.length : '';
}

function lbPrev(e) { e.stopPropagation(); if (_lbIdx > 0) { _lbIdx--; _lbShow(); } }
function lbNext(e) { e.stopPropagation(); if (_lbIdx < _lbItems.length - 1) { _lbIdx++; _lbShow(); } }

function closeLightbox() {
  const vid = document.getElementById('lightboxVideo');
  vid.pause(); vid.src = '';
  document.getElementById('lightboxOverlay').style.display = 'none';
  document.removeEventListener('keydown', lightboxKeyHandler);
}
function lightboxKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') { if (_lbIdx > 0) { _lbIdx--; _lbShow(); } }
  if (e.key === 'ArrowRight') { if (_lbIdx < _lbItems.length - 1) { _lbIdx++; _lbShow(); } }
}

// ═══════════════════════════════════════════════════
