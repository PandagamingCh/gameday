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
  document.getElementById('navUsername') && (document.getElementById('navUsername').textContent = currentUser.username);
  if (currentUser.is_admin) {
    const el = document.getElementById('adminNavBtn');
    if (el) el.style.display = '';
  }
  const res = await api('GET', '/api/sessions');

  // Afficher/cacher le bouton créer séance
  const nsBtn = document.getElementById('newSessionBtn');
  if (nsBtn) nsBtn.style.display = canDoAction('session_create') ? '' : 'none';

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
  const res = await api('POST', '/api/sessions', { name, date, is_private: isPrivate, member_ids: memberIds, no_join: noJoin });
  if (res.error) { showToast(res.error); return; }
  closeModal('newSessionModal');
  document.getElementById('nsName').value = '';
  await loadHome(); // rafraîchir la liste des séances sur l'accueil
  await loadSession(res.sessionId);
}

// ═══════════════════════════════════════════════════
