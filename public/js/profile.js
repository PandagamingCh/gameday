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
