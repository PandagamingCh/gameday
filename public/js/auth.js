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
