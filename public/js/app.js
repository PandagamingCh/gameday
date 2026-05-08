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
