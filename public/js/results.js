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
