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
  document.querySelectorAll('.theme-toggle, #themeBtn').forEach(btn => {
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
  if (currentUser?.is_admin) {
    api('PATCH', '/api/settings', { key: 'theme_active', value: theme }).catch(() => {});
  }
  document.querySelectorAll('.theme-toggle, #themeBtn').forEach(btn => {
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
