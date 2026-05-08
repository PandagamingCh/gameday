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
