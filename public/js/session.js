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

  // Reset to propose tab
  document.querySelectorAll('.tab').forEach((t,i) => { t.classList.toggle('active', i===0); });
  document.querySelectorAll('.panel').forEach((p,i) => { p.classList.toggle('active', i===0); });
  renderProposePanel();
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
