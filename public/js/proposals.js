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
  const filtered = games.filter(g => !filterVal || g.name.toLowerCase().includes(filterVal)).slice(0, 80);

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
    }).slice(0, 80);
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
    minTime: g.min_time, maxTime: g.max_time, bggRating: g.bgg_rating || null, bggWeight: g.bgg_weight || null
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
  document.getElementById('epMyludo').value = p.myludo_url || '';
  document.getElementById('epTeachDur').value = p.teach_duration || '';
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
    bggRating: document.getElementById('epRatingVal').value || null,
    bggWeight: document.getElementById('epWeightVal')?.value || null
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
