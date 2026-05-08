// ─────────────────────────────────────────────────────────────
// convention.js — Panneau de gestion des jeux en mode convention
//
// Contient :
//   - renderConventionPanel()   Affiche le panneau convention
//   - addConventionGame()       Ajoute un jeu avec ses tables/créneaux
//   - removeConventionSlot()    Supprime un créneau/table
// ─────────────────────────────────────────────────────────────

// CONVENTION PANEL
// ═══════════════════════════════════════════════════

async function renderConventionPanel() {
  const el = document.getElementById('panel-convention');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700">🎪 Jeux de la convention</div>
      <button class="btn-sm accent" onclick="openAddConventionGame()">+ Ajouter un jeu</button>
    </div>
    <div id="convGameForm" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px"></div>
    <div id="convGamesList"></div>
  </div>`;

  await loadConventionGames();
}

async function loadConventionGames() {
  const el = document.getElementById('convGamesList');
  if (!el) return;

  // Récupérer les slots du programme avec leurs tables
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = r.slots || [];

  if (!slots.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu ajouté — commence par ajouter un jeu</div></div>';
    return;
  }

  // Grouper les slots par jeu (nom du jeu de la table 1)
  const byGame = {};
  for (const slot of slots) {
    const tables = slot.tables || [];
    for (const t of tables) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) byGame[t.game_name] = { tables: [], game_name: t.game_name, thumbnail: t.thumbnail, min_players: t.min_players, max_players: t.max_players, bgg_id: t.bgg_id || '', myludo_url: t.myludo_url || '' };
      byGame[t.game_name].tables.push({ slot, table: t });
    }
  }

  if (!Object.keys(byGame).length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu configuré</div></div>';
    return;
  }

  el.innerHTML = Object.values(byGame).map(g => {
    const nbTables = new Set(g.tables.map(x => x.slot.id + '-' + x.table.table_number)).size;
    const slots = g.tables.map(x => x.slot);
    const uniqueSlots = [...new Map(slots.map(s => [s.id, s])).values()];
    const capacity = g.max_players ? `${g.min_players || 1}–${g.max_players} joueurs` : '';

    return `<div class="prog-card" style="margin-bottom:12px">
      <div class="prog-card-header" style="display:flex;align-items:center;gap:10px">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">` : ''}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${nbTables} table${nbTables > 1 ? 's' : ''} · ${uniqueSlots.length} créneau${uniqueSlots.length > 1 ? 'x' : ''}${capacity ? ' · ' + capacity : ''}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
            ${g.bgg_id ? `<a class="ext-btn" href="https://boardgamegeek.com/boardgame/${esc(g.bgg_id)}" target="_blank" rel="noopener">🌐 BGG</a>` : ''}
            ${g.myludo_url ? `<a class="ext-btn" href="${esc(g.myludo_url)}" target="_blank" rel="noopener">🎲 MyLudo</a>` : ''}
          </div>
        </div>
        <button class="btn-sm ghost" style="font-size:.72rem" onclick="removeConventionGame('${esc(g.game_name)}')">✕ Retirer</button>
      </div>
      <div class="prog-card-body" style="padding:10px 14px">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${uniqueSlots.map(s => `
            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:.75rem">
              ${s.start_time ? `<span style="color:var(--accent);font-weight:600">${esc(s.start_time)} · </span>` : ''}Créneau ${uniqueSlots.indexOf(s) + 1}
              <button class="btn-icon" style="margin-left:6px;font-size:.65rem" onclick="removeConventionSlot(${s.id})">✕</button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAddConventionGame() {
  const form = document.getElementById('convGameForm');
  if (!form) return;
  form.style.display = 'block';
  form.innerHTML = `
    <div class="section-label" style="margin-bottom:12px">➕ Nouveau jeu</div>
    <div class="form-group">
      <label class="form-label">Rechercher sur BGG</label>
      <input class="form-input" id="convBggSearch" placeholder="Tapez le nom du jeu…" oninput="convSearchDebounce()" onkeydown="if(event.key==='Enter')convSearchBGG()" style="flex:1">
      <div id="convBggStatus" style="font-size:.72rem;color:var(--text-muted);margin-top:4px"></div>
      <div id="convBggResults" style="margin-top:6px;max-height:220px;overflow-y:auto"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Jeu sélectionné</label>
      <input class="form-input" id="convGameName" placeholder="Ou saisie libre…">
      <input type="hidden" id="convGameThumb">
      <input type="hidden" id="convGameBggId">
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Nb tables</label>
        <input class="form-input" type="number" id="convNbTables" value="1" min="1" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Nb créneaux</label>
        <input class="form-input" type="number" id="convNbSlots" value="1" min="1" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Min joueurs</label>
        <input class="form-input" type="number" id="convMinP" placeholder="—" style="max-width:80px">
      </div>
      <div class="form-group" style="flex:1;min-width:80px">
        <label class="form-label">Max joueurs</label>
        <input class="form-input" type="number" id="convMaxP" placeholder="—" style="max-width:80px">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">🔗 Lien MyLudo (optionnel)</label>
      <input class="form-input" id="convMyLudo" placeholder="myludo.fr/#!/game/…">
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-sm ghost" onclick="document.getElementById('convGameForm').style.display='none'">Annuler</button>
      <button class="btn-sm accent" onclick="addConventionGame()">✅ Créer les tables</button>
    </div>
  `;
}

let _convSearchTimer = null;
function convSearchDebounce() {
  clearTimeout(_convSearchTimer);
  const q = document.getElementById('convBggSearch')?.value.trim();
  if (!q || q.length < 2) {
    const results = document.getElementById('convBggResults');
    if (results) results.innerHTML = '';
    return;
  }
  _convSearchTimer = setTimeout(convSearchBGG, 400);
}

async function convSearchBGG() {
  const q = document.getElementById('convBggSearch')?.value.trim();
  const status = document.getElementById('convBggStatus');
  const results = document.getElementById('convBggResults');
  if (!q || !status || !results) return;

  status.textContent = '⏳ Recherche…';
  results.innerHTML = '';

  const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (res.error) { status.textContent = '⚠ ' + res.error; return; }
  if (!res.games?.length) { status.textContent = 'Aucun résultat — essayez en anglais'; return; }

  status.textContent = `${res.games.length} résultat(s)`;
  results.innerHTML = res.games.slice(0, 12).map((g, i) => {
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`) : '';
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}–${g.max_time}min`) : '';
    return `<div class="coll-item" style="cursor:pointer"
         data-name="${esc(g.name)}"
         data-thumb="${esc(g.thumbnail||'')}"
         data-bggid="${esc(g.bgg_id||'')}"
         data-minp="${esc(String(g.min_players||''))}"
         data-maxp="${esc(String(g.max_players||''))}"
         onclick="convPickFromResult(this)">
      ${g.thumbnail ? `<img class="coll-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'">` : '<div class="coll-thumb-ph">🎲</div>'}
      <div class="coll-info">
        <div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div>
        <div class="coll-meta">${[players && `👥 ${players}`, time && `⏱ ${time}`, g.bgg_rating && `⭐ ${g.bgg_rating}`].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="coll-add">Choisir</button>
    </div>`;
  }).join('');
}

function convPickFromResult(el) {
  const wrap = el.closest('[data-name]');
  if (!wrap) return;
  convPickGame(wrap.dataset.name, wrap.dataset.thumb, wrap.dataset.bggid, wrap.dataset.minp, wrap.dataset.maxp);
}

function convPickGame(name, thumb, bggId, minPlayers, maxPlayers) {
  const nameInput = document.getElementById('convGameName');
  const thumbInput = document.getElementById('convGameThumb');
  const bggIdInput = document.getElementById('convGameBggId');
  if (nameInput) nameInput.value = name;
  if (thumbInput) thumbInput.value = thumb || '';
  if (bggIdInput) bggIdInput.value = bggId || '';
  const minEl = document.getElementById('convMinP');
  const maxEl = document.getElementById('convMaxP');
  if (minEl && minPlayers && !minEl.value) minEl.value = minPlayers;
  if (maxEl && maxPlayers && !maxEl.value) maxEl.value = maxPlayers;
  const results = document.getElementById('convBggResults');
  if (results) results.innerHTML = `<div style="font-size:.78rem;color:var(--accent);padding:4px 0">✅ ${esc(name)} sélectionné</div>`;
}

async function addConventionGame() {
  const name = document.getElementById('convGameName')?.value.trim();
  const thumb = document.getElementById('convGameThumb')?.value || '';
  const bggId = document.getElementById('convGameBggId')?.value || '';
  const myLudo = document.getElementById('convMyLudo')?.value.trim() || '';
  const nbTables = parseInt(document.getElementById('convNbTables')?.value) || 1;
  const nbSlots = parseInt(document.getElementById('convNbSlots')?.value) || 1;
  const minP = parseInt(document.getElementById('convMinP')?.value) || null;
  const maxP = parseInt(document.getElementById('convMaxP')?.value) || null;

  if (!name) { showToast('Renseigne le nom du jeu'); return; }

  for (let s = 0; s < nbSlots; s++) {
    const tables = [];
    for (let t = 1; t <= nbTables; t++) {
      tables.push({
        table_number: t,
        game_name: name,
        players: '',
        teacher: '',
        duration_est: null,
        thumbnail: thumb,
        bgg_id: bggId,
        myludo_url: myLudo,
        min_players: minP,
        max_players: maxP
      });
    }
    await api('POST', '/api/programme/slots', {
      sessionId: currentSession.session.id,
      start_time: '',
      note: '',
      is_break: 0,
      sort_order: 999,
      tables
    });
  }

  showToast(`✅ ${nbSlots} créneau${nbSlots > 1 ? 'x' : ''} créé${nbSlots > 1 ? 's' : ''} pour "${name}"`);
  document.getElementById('convGameForm').style.display = 'none';
  await loadConventionGames();
}

async function removeConventionSlot(slotId) {
  if (!confirm('Supprimer ce créneau et ses réservations ?')) return;
  await api('DELETE', `/api/programme/slots/${slotId}`);
  showToast('Créneau supprimé');
  await loadConventionGames();
}

async function removeConventionGame(gameName) {
  if (!confirm(`Supprimer tous les créneaux de "${gameName}" ?`)) return;
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = r.slots || [];
  const toDelete = slots.filter(s => (s.tables || []).some(t => t.game_name === gameName));
  await Promise.all(toDelete.map(s => api('DELETE', `/api/programme/slots/${s.id}`)));
  showToast(`"${gameName}" supprimé`);
  await loadConventionGames();
}

// ═══════════════════════════════════════════════════
// PANNEAU RÉSERVATIONS (vue participant)

async function renderReservationsPanel() {
  const el = document.getElementById('panel-reservations');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700;margin-bottom:16px">🎫 Réservations</div>
    <div id="resvContent"><div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Chargement…</div></div>
  </div>`;

  await _loadReservationsContent();
}

async function _loadReservationsContent() {
  const content = document.getElementById('resvContent');
  if (!content) return;

  const [progRes, bookRes] = await Promise.all([
    api('GET', `/api/sessions/${currentSession.session.id}/programme`),
    api('GET', `/api/sessions/${currentSession.session.id}/bookings`)
  ]);

  const slots = progRes.slots || [];
  const bookings = bookRes.bookings || [];

  if (!slots.length) {
    content.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu programmé pour l\'instant</div></div>';
    return;
  }

  // Grouper par jeu → tables → créneaux
  const byGame = {};
  for (const slot of slots) {
    if (slot.is_break) continue;
    for (const t of (slot.tables || [])) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) {
        byGame[t.game_name] = { game_name: t.game_name, thumbnail: t.thumbnail, min_players: t.min_players, max_players: t.max_players, byTable: {} };
      }
      const key = t.table_number;
      if (!byGame[t.game_name].byTable[key]) byGame[t.game_name].byTable[key] = [];
      const tableBookings = bookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
      const myBooking = tableBookings.find(b => b.user_id === currentUser.id);
      const mySlotBooking = bookings.find(b => b.slot_id === slot.id && b.user_id === currentUser.id);
      const isFull = t.max_players && tableBookings.length >= t.max_players;
      byGame[t.game_name].byTable[key].push({ slot, table: t, tableBookings, myBooking, mySlotBooking, isFull });
    }
  }

  content.innerHTML = Object.values(byGame).map(g => {
    const allEntries = Object.values(g.byTable).flat();
    const totalDispo = allEntries.filter(e => !e.isFull && !e.mySlotBooking).length;
    const hasMyBooking = allEntries.some(e => e.myBooking);
    const allFull = allEntries.every(e => e.isFull);
    const statusDot = hasMyBooking ? '🟡' : allFull ? '🔴' : '🟢';
    const statusText = hasMyBooking ? 'Inscrit' : allFull ? 'Complet' : `${totalDispo} place${totalDispo !== 1 ? 's' : ''} dispo`;
    const capacity = g.max_players ? `👥 ${g.min_players||1}–${g.max_players}` : '';
    const gameId = `game_${esc(g.game_name).replace(/\s+/g,'_')}`;

    const tablesHtml = Object.entries(g.byTable).map(([tableNum, entries]) => {
      const tableDispo = entries.filter(e => !e.isFull).length;
      const tableMyBooking = entries.find(e => e.myBooking);
      const tableFull = entries.every(e => e.isFull);
      const tableDot = tableMyBooking ? '🟡' : tableFull ? '🔴' : '🟢';
      const tableStatus = tableMyBooking ? 'Inscrit' : tableFull ? 'Complet' : `${tableDispo} créneau${tableDispo !== 1 ? 'x' : ''} dispo`;
      const tableId = `${gameId}_t${tableNum}`;

      const slotsHtml = entries.map(e => {
        const count = `${e.tableBookings.length}${e.table.max_players ? '/'+e.table.max_players : ''} joueur${e.tableBookings.length !== 1 ? 's' : ''}`;
        let actionHtml;
        if (e.myBooking) {
          actionHtml = `<span style="color:#4caf50;font-size:.75rem">✅ Inscrit</span>
            <button class="btn-sm ghost" style="font-size:.68rem" onclick="cancelBookingAndRefresh(${e.slot.id})">Annuler</button>`;
        } else if (e.mySlotBooking) {
          actionHtml = `<span style="font-size:.72rem;color:var(--text-muted)">⛔ Déjà inscrit ce créneau</span>`;
        } else if (e.isFull) {
          actionHtml = `<span style="font-size:.72rem;color:var(--text-muted)">🔒 Complet</span>`;
        } else {
          actionHtml = `<button class="btn-sm accent" style="font-size:.75rem" onclick="bookTableAndRefresh(${e.slot.id},${e.table.id})">Réserver</button>`;
        }
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px 8px 32px;border-top:1px solid var(--border);gap:8px;flex-wrap:wrap;background:var(--surface)">
          <div>
            ${e.slot.start_time ? `<span style="color:var(--accent);font-weight:600;font-size:.8rem">${esc(e.slot.start_time)} · </span>` : ''}
            <span style="font-size:.8rem;color:var(--text-muted)">${count}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">${actionHtml}</div>
        </div>`;
      }).join('');

      return `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer;background:var(--surface2)"
             onclick="document.getElementById('${tableId}').style.display=document.getElementById('${tableId}').style.display==='none'?'block':'none';this.querySelector('.resv-chevron').textContent=document.getElementById('${tableId}').style.display==='none'?'▶':'▼'">
          <div style="display:flex;align-items:center;gap:8px">
            <span>${tableDot}</span>
            <span style="font-size:.82rem;font-weight:600">Table ${tableNum}</span>
            <span style="font-size:.72rem;color:var(--text-muted)">${tableStatus}</span>
          </div>
          <span class="resv-chevron" style="color:var(--text-muted);font-size:.75rem">▶</span>
        </div>
        <div id="${tableId}" style="display:none">${slotsHtml}</div>
      </div>`;
    }).join('');

    return `<div class="prog-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer"
           onclick="document.getElementById('${gameId}').style.display=document.getElementById('${gameId}').style.display==='none'?'block':'none';this.querySelector('.resv-chevron').textContent=document.getElementById('${gameId}').style.display==='none'?'▶':'▼'">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:44px;height:44px;background:var(--surface2);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${[capacity, statusDot+' '+statusText].filter(Boolean).join(' · ')}</div>
        </div>
        <span class="resv-chevron" style="color:var(--text-muted)">▶</span>
      </div>
      <div id="${gameId}" style="display:none">${tablesHtml}</div>
    </div>`;
  }).join('');
}

async function bookTableAndRefresh(slotId, tableId) {
  const res = await api('POST', '/api/convention/book', { slotId, tableId });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Réservation enregistrée !');
  await _loadReservationsContent();
}

async function cancelBookingAndRefresh(slotId) {
  if (!confirm('Annuler ta réservation ?')) return;
  await api('DELETE', '/api/convention/book', { slotId });
  showToast('Réservation annulée');
  await _loadReservationsContent();
}
