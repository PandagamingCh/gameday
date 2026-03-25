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

  body.innerHTML = `<div class="rank-hint">☰ Glissez les jeux dans votre ordre de préférence (1 = favori)</div>`;
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
    ${!locked ? '<span class="rank-handle">⋮⋮</span>' : ''}
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
  // Touch
  let ti = null;
  list.addEventListener('touchstart', e => { ti = e.target.closest('.rank-item'); if (ti) ti.style.opacity = '.5'; }, { passive: true });
  list.addEventListener('touchmove', e => {
    if (!ti) return; e.preventDefault();
    const y = e.touches[0].clientY;
    const items = [...list.querySelectorAll('.rank-item')];
    let target = null;
    items.forEach(item => { if (item === ti) return; const ir = item.getBoundingClientRect(); if (y > ir.top + ir.height / 2) target = item; });
    items.forEach(i => i.classList.remove('drag-over'));
    if (target) target.classList.add('drag-over');
  }, { passive: false });
  list.addEventListener('touchend', () => {
    if (!ti) return; ti.style.opacity = '';
    const over = list.querySelector('.rank-item.drag-over');
    if (over && over !== ti) { const items = [...list.querySelectorAll('.rank-item')]; if (items.indexOf(ti) < items.indexOf(over)) list.insertBefore(ti, over.nextSibling); else list.insertBefore(ti, over); }
    list.querySelectorAll('.rank-item').forEach(i => i.classList.remove('drag-over'));
    updateRankNums(list); ti = null;
  });
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
}

async function retractRanking(catId) {
  // Mémoriser l'ordre actuel avant de supprimer
  const list = document.getElementById(`rl_${catId}`);
  if (!window._prevRankOrder) window._prevRankOrder = {};
  window._prevRankOrder[catId] = list ? [...list.querySelectorAll('.rank-item')].map(i => parseInt(i.dataset.proposalid)) : [];
  await api('DELETE', `/api/sessions/${currentSession.session.id}/rankings/${catId}`);
  await reloadSession();
}

// ═══════════════════════════════════════════════════
