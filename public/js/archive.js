// ─────────────────────────────────────────────────────────────
// archive.js — Panel "Archive" : compte-rendu, médias, scores, stats
//
// Contient :
//   - renderArchivePanel()      Affiche le panel archive d'une séance
//   - renderArchiveGames()      Liste les parties jouées avec leurs scores
//   - openArchiveGameForm()     Formulaire d'ajout/édition d'une partie
//   - saveArchiveGame()         Sauvegarde une partie via API
//   - renderSessionMedia()      Affiche les photos et vidéos de la séance
//   - handlePhotoFiles()        Upload de photos/vidéos
//   - saveArchiveCR()           Sauvegarde le compte-rendu texte
//   - loadStats(year)           Charge et affiche les statistiques annuelles
// ─────────────────────────────────────────────────────────────

// ARCHIVE
// ═══════════════════════════════════════════════════

let archiveData = null;

async function renderArchivePanel() {
  const el = document.getElementById('panel-archive');
  el.innerHTML = '<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Chargement…</span></div>';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  el.innerHTML = `
    <div class="prog-card">
      <div class="prog-card-header">
        <div class="prog-card-title">📚 Archive de la séance</div>
        <a class="btn-sm accent" href="/archive/${currentSession.session.id}" target="_blank" style="font-weight:600;margin-left:32px">🌐 Page publique</a>
      </div>
      <div class="prog-card-body">

        <!-- CR général + Médias séance — accordéon unique -->
        <div class="arch-accordion" id="archAccCR">
          <div class="arch-accordion-header" onclick="toggleArchAccordion('archAccCR')">
            <span>📝 Compte-rendu général</span>
            <span class="arch-acc-chevron">▸</span>
          </div>
          <div class="arch-accordion-body" style="display:none">
            <div id="archUserCRs"></div>
            <div class="arch-accordion" id="archAccMedia" style="margin-top:12px">
              <div class="arch-accordion-header" onclick="event.stopPropagation();toggleArchAccordion('archAccMedia')">
                <span>📸 Photos & vidéos de la séance</span>
                <span class="arch-acc-chevron">▸</span>
              </div>
              <div class="arch-accordion-body" style="display:none">
                <div id="archSessionMedia"></div>
                <button class="btn-sm ghost" style="margin-top:8px" onclick="openArchivePhotoForm(null)">+ Ajouter des médias</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Jeux joués -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px">
          <div class="section-label" style="margin:0">🎲 Jeux joués</div>
          <button class="btn-sm ghost" onclick="openArchiveGameForm(null)">+ Ajouter un jeu</button>
        </div>
        <div id="archGames"></div>
        <div id="archGameForm" style="display:none;margin-top:8px"></div>
      </div>
    </div>
  `;
  // prefillArchiveFromProgramme désactivé — l'archive se remplit manuellement
  renderUserCRs();
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function prefillArchiveFromProgramme() {
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/programme');
  const slots = (r.slots || []).filter(function(s) { return !s.is_break && s.game_name; });
  if (!slots.length) return;
  const existingNames = (archiveData.games || []).map(function(g) { return g.game_name.toLowerCase(); });
  for (const s of slots) {
    const games = [
      { name: s.game_name, players: s.players },
      s.game_name_b ? { name: s.game_name_b, players: s.players_b } : null
    ].filter(Boolean);
    for (const g of games) {
      if (existingNames.includes(g.name.toLowerCase())) continue;
      const res = await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/games', {
        game_name: g.name,
        joueurs: g.players && g.players !== 'tous' ? g.players : '',
        thumbnail: '', vainqueur: '', scores: '', compte_rendu: ''
      });
      if (res.id) {
        archiveData.games = archiveData.games || [];
        archiveData.games.push({ id: res.id, game_name: g.name, joueurs: g.players||'', thumbnail:'', vainqueur:'', scores:'', compte_rendu:'', photos:[] });
        existingNames.push(g.name.toLowerCase());
      }
    }
  }
}

function renderArchiveGames() {
  const el = document.getElementById('archGames');
  if (!el) return;
  const games = archiveData?.games || [];
  if (!games.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic;padding:8px 0">Aucun jeu enregistré</div>';
    return;
  }
  el.innerHTML = games.map((g, i) => `
    <div class="arch-accordion arch-game-card" id="archGame-${g.id}">
      <div class="arch-accordion-header arch-game-header" onclick="toggleArchAccordion('archGame-${g.id}')">
        ${g.thumbnail ? `<img class="ag-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'">` : '<div class="ag-thumb-ph">🎲</div>'}
        <div class="ag-info" style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="ag-name">${esc(g.game_name)}</div>
            <button class="arch-del-btn" title="Supprimer" onclick="event.stopPropagation();if(confirm('Supprimer ce jeu ?'))deleteArchiveGame(${g.id})">🗑</button>
          </div>
          ${g.vainqueur ? `<div class="ag-win">🏆 ${esc(g.vainqueur)}</div>` : ''}
          ${g.scores ? `<div class="ag-scores">📊 ${esc(sortScoresDesc(g.scores))}</div>` : ''}
        </div>
        <span class="arch-acc-chevron">▸</span>
      </div>
      <div class="arch-accordion-body" style="display:none">
        <!-- Formulaire d'édition du jeu intégré -->
        <div id="archGameForm-${g.id}"></div>
      </div>
    </div>
  `).join('');

  // Après rendu, ouvrir les formulaires d'édition dans chaque accordéon jeu
  games.forEach((g, i) => {
    const formEl = document.getElementById('archGameForm-' + g.id);
    if (formEl) renderGameEditInline(formEl, i, g);
  });
}

function toggleGameBody(id) { // compat
  toggleArchAccordion(id.replace('agbody-', 'archGame-'));
}

function toggleArchAccordion(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const body = el.querySelector('.arch-accordion-body');
  const chevron = el.querySelector('.arch-acc-chevron');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}

// ── Chips de sélection de joueurs ───────────────────────────
function initPlayerChips(containerId, hiddenId, selectedStr) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const participants = currentSession?.participants || [];
  const selected = new Set(
    (selectedStr || '').split(',').map(s => s.trim()).filter(Boolean)
  );

  container.innerHTML = participants.map(p => {
    const isSelected = selected.has(p.username);
    return `<button type="button"
      class="player-chip ${isSelected ? 'selected' : ''}"
      onclick="togglePlayerChip(this, '${esc(p.username)}', '${hiddenId}')">
      ${esc(p.username)}
    </button>`;
  }).join('');
}

function togglePlayerChip(btn, username, hiddenId) {
  btn.classList.toggle('selected');
  const container = btn.parentNode;
  const selected = [...container.querySelectorAll('.player-chip.selected')]
    .map(b => b.textContent.trim());
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = selected.join(', ');
  // Synchroniser le vainqueur
  const gameId = hiddenId.replace('agJoueurs_', '');
  const vainqueurInput = document.getElementById('agVainqueur_' + gameId);
  if (vainqueurInput && !selected.includes(vainqueurInput.value)) {
    vainqueurInput.value = '';
  }
  // Mettre à jour les champs de scores
  const scoresHiddenId = 'agScores_' + gameId;
  const scoresGridId = 'agScoresGrid_' + gameId;
  const currentScores = document.getElementById(scoresHiddenId)?.value || '';
  initScoreFields(scoresGridId, scoresHiddenId, selected.join(', '), currentScores);
}

function initScoreFields(gridId, hiddenId, joueursStr, scoresStr) {
  const grid = document.getElementById(gridId);
  const hidden = document.getElementById(hiddenId);
  if (!grid || !hidden) return;

  // Parser les joueurs
  const joueurs = (joueursStr || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!joueurs.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Sélectionne les joueurs d\'abord</div>';
    return;
  }

  // Parser les scores existants "Nom: score, Nom: score"
  const parsed = {};
  (scoresStr || '').split(',').forEach(part => {
    const m = part.trim().match(/^(.+?):\s*(.+)$/);
    if (m) parsed[m[1].trim()] = m[2].trim();
  });

  grid.innerHTML = joueurs.map(j => `
    <div class="score-field-row">
      <label class="score-field-label">${esc(j)}</label>
      <input type="text" class="form-input score-field-input" inputmode="numeric"
        placeholder="0" value="${esc(parsed[j] || '')}"
        data-player="${esc(j)}"
        oninput="updateScoresHidden('${hiddenId}', '${gridId}')">
    </div>`).join('');
}

function updateScoresHidden(hiddenId, gridId) {
  const grid = document.getElementById(gridId);
  const hidden = document.getElementById(hiddenId);
  if (!grid || !hidden) return;
  const parts = [...grid.querySelectorAll('.score-field-input')]
    .filter(input => input.value.trim())
    .map(input => `${input.dataset.player}: ${input.value.trim()}`);
  hidden.value = parts.join(', ');
}

// Rendu inline du contenu d'un jeu dans l'accordéon (sans modal)
function renderGameEditInline(container, idx, g) {
  if (!g || !container) return;
  const myId = currentUser.id;
  const myGameCR = (archiveData.gameCRs || []).find(c => c.game_id === g.id && c.user_id === myId);
  const otherCRs = (archiveData.gameCRs || []).filter(c => c.game_id === g.id && c.user_id !== myId);

  container.innerHTML = `
    <div class="arch-form-box" style="border:none;padding:12px 0 0">
      <input type="hidden" id="agEditId_${g.id}" value="${g.id}">
      <div class="slot-edit-row">
        <div class="form-group" style="flex:2;position:relative">
          <label class="form-label">Nom du jeu *</label>
          <input class="form-input" id="agName_${g.id}" value="${esc(g.game_name||'')}" placeholder="Wingspan" autocomplete="off">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Miniature (URL)</label>
          <input class="form-input" id="agThumb_${g.id}" value="${esc(g.thumbnail||'')}" placeholder="https://…">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Joueurs présents</label>
        <div class="player-chips" id="agJoueursChips_${g.id}"></div>
        <input type="hidden" id="agJoueurs_${g.id}" value="${esc(g.joueurs||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">🏆 Vainqueur</label>
        <input class="form-input" id="agVainqueur_${g.id}" value="${esc(g.vainqueur||'')}" placeholder="Nom du vainqueur">
      </div>
      <div class="form-group">
        <label class="form-label">📊 Scores</label>
        <div class="scores-grid-fields" id="agScoresGrid_${g.id}"></div>
        <input type="hidden" id="agScores_${g.id}" value="${esc(g.scores||'')}">
      </div>

      <div class="form-group">
        <label class="form-label">📝 Mon avis</label>
        <textarea class="form-input" id="agUserCR_${g.id}" rows="5"
          placeholder="Ton ressenti, anecdotes…"
          style="resize:vertical;min-height:110px;font-size:16px">${esc(myGameCR?.content||'')}</textarea>
        ${crToolbarHtml('agUserCR_'+g.id)}
      </div>

      <div style="display:flex;gap:6px;margin-bottom:12px">
        <button class="btn-sm accent" onclick="saveArchiveGameInline(${idx}, ${g.id})">💾 Enregistrer</button>
      </div>

      <!-- Médias du jeu — accordéon -->
      <div class="arch-accordion" id="archGameMedia-${g.id}">
        <div class="arch-accordion-header" onclick="toggleArchAccordion('archGameMedia-${g.id}')">
          <span>📷 Photos & vidéos du jeu</span>
          <span class="arch-acc-chevron">▸</span>
        </div>
        <div class="arch-accordion-body" style="display:none;padding:10px 0">
          <div id="gamePhotosGrid_${g.id}" class="arch-photos-row"></div>
          <button type="button" class="btn-sm ghost" onclick="openGamePhotoForm(${g.id})" style="margin-top:8px">📷 Ajouter des médias</button>
          <div id="gamePhotoForm_${g.id}" style="display:none"></div>
        </div>
      </div>

      ${otherCRs.length ? `
      <div class="user-cr-others" style="margin-top:8px">
        <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
          <span>💬 Avis des autres joueurs (${otherCRs.length})</span>
          <span class="user-cr-chevron">▸</span>
        </div>
        <div class="user-cr-others-body" style="display:none">
          ${otherCRs.map(cr => `
            <div class="game-cr-user-edit" style="margin-bottom:8px">
              <span class="user-cr-author">👤 ${esc(cr.username)}</span>
              <div style="margin-top:4px;font-size:.82rem;line-height:1.5;white-space:pre-wrap">${renderCRContent(cr.content)}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
  `;
  // Charger les photos existantes
  refreshGamePhotos(g.id);
  // Initialiser les chips joueurs
  initPlayerChips('agJoueursChips_' + g.id, 'agJoueurs_' + g.id, g.joueurs || '');
  // Initialiser les champs de scores
  initScoreFields('agScoresGrid_' + g.id, 'agScores_' + g.id, g.joueurs || '', g.scores || '');
}

async function saveArchiveGameInline(idx, gameId) {
  const name = document.getElementById('agName_' + gameId)?.value.trim();
  if (!name) { showToast('Nom du jeu requis'); return; }
  const payload = {
    game_name: name,
    thumbnail: document.getElementById('agThumb_' + gameId)?.value.trim() || '',
    joueurs: document.getElementById('agJoueurs_' + gameId)?.value.trim() || '',
    vainqueur: document.getElementById('agVainqueur_' + gameId)?.value.trim() || '',
    scores: document.getElementById('agScores_' + gameId)?.value.trim() || '',
    compte_rendu: '',
  };
  await api('PATCH', `/api/archive/games/${gameId}`, payload);
  // Sauvegarder le CR utilisateur
  const crField = document.getElementById('agUserCR_' + gameId);
  if (crField) await api('POST', `/api/archive/games/${gameId}/cr`, { content: crField.value });
  // Mettre à jour archiveData localement
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  showToast('✅ Jeu enregistré');
  // Re-render uniquement la carte de ce jeu
  const gameIdx = archiveData.games.findIndex(g => g.id === gameId);
  if (gameIdx >= 0) {
    const formEl = document.getElementById('archGameForm-' + gameId);
    if (formEl) renderGameEditInline(formEl, gameIdx, archiveData.games[gameIdx]);
  }
}

function openArchiveGameForm(idx) {
  const g = idx !== null ? archiveData.games[idx] : null;
  const form = document.getElementById('archGameForm');
  form.style.display = 'block';
  // Jeux de la séance pour suggestion rapide
  const sessionGames = currentSession.proposals || [];

  form.innerHTML = `
    <div class="arch-form-box">
      <div class="section-label" style="margin-bottom:10px">${g ? 'Modifier le jeu' : 'Nouveau jeu'}</div>
      ${g ? `<input type="hidden" id="agEditId" value="${g.id}">` : ''}
      ${!g && sessionGames.length ? `
        <div class="form-group">
          <label class="form-label">Jeux de la séance</label>
          <div class="arch-game-pills">
            ${sessionGames.map(p => `<button class="arch-game-pill" onclick="prefillArchiveGame('${esc(p.name).replace(/'/g,"\\'")}','${esc(p.thumbnail||'').replace(/'/g,"\\'")}','${esc(p.bgg_id||'')}');event.preventDefault()">${esc(p.name)}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Ou rechercher sur BGG</label>
          <div style="display:flex;gap:6px">
            <input class="form-input" id="agBggSearch" placeholder="Nom du jeu…" onkeydown="if(event.key==='Enter'){searchBGGForArchive();event.preventDefault()}">
            <button class="btn-sm ghost" onclick="searchBGGForArchive()">🔍</button>
          </div>
          <div id="agBggResults" style="display:none;margin-top:6px"></div>
        </div>
        <div style="border-top:1px solid var(--border);margin:10px 0"></div>
      ` : ''}
      <div class="slot-edit-row">
        <div class="form-group" style="flex:2;position:relative"><label class="form-label">Nom du jeu *</label><input class="form-input" id="agName" value="${esc(g?.game_name||'')}" placeholder="Wingspan" autocomplete="off" oninput="archiveGameAC(this)" onblur="setTimeout(()=>{const s=document.getElementById('agNameSugg');if(s)s.style.display='none'},150)"><div class="tag-suggestions" id="agNameSugg" style="display:none"></div></div>
        <div class="form-group" style="flex:1"><label class="form-label">URL miniature</label><input class="form-input" id="agThumb" value="${esc(g?.thumbnail||'')}" placeholder="https://…"></div>
      </div>
      <div class="form-group"><label class="form-label">Joueurs</label>
        <div class="tag-input-wrap" id="agJoueursWrap">
          <div class="tag-list" id="agJoueursTags"></div>
          <input class="tag-input-field" id="agJoueursInput" placeholder="Ajouter un joueur…" autocomplete="off">
          <div class="tag-suggestions" id="agJoueursSugg" style="display:none"></div>
        </div>
        <input type="hidden" id="agJoueurs" value="${esc(g?.joueurs||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">🏆 Vainqueur</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="form-input" id="agVainqueurSel" onchange="onVainqueurSelChange()" style="flex:1">
            <option value="">— Sélectionner —</option>
            ${buildVainqueurOptions(g?.joueurs||'', g?.vainqueur||'')}
          </select>
          <div style="position:relative;max-width:140px">
            <input class="form-input" id="agVainqueurFree" value="${esc(g?.vainqueur||'')}" placeholder="Saisie libre…"
              oninput="onVainqueurFreeInput(this)" onblur="setTimeout(()=>{const s=document.getElementById('agVainqueurFreeSugg');if(s)s.style.display='none'},150)">
            <div class="tag-suggestions" id="agVainqueurFreeSugg" style="display:none"></div>
          </div>
        </div>
        <input type="hidden" id="agVainqueur" value="${esc(g?.vainqueur||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Scores <span style="font-size:.65rem;color:var(--text-muted)">(ajoutez les joueurs d'abord)</span></label>
        <div id="agScoresGrid" class="scores-grid"></div>
        <input type="hidden" id="agScores" value="${esc(g?.scores||'')}">
      </div>
      ${g ? (() => {
        const myId = currentUser.id;
        const myGameCR = (archiveData.gameCRs || []).find(c => c.game_id === g.id && c.user_id === myId);
        const otherCRs = (archiveData.gameCRs || []).filter(c => c.game_id === g.id && c.user_id !== myId);
        return `
          <div class="form-group">
            <label class="form-label">📷 Photos & vidéos du jeu</label>
            <div id="gamePhotosGrid_${g.id}" class="arch-photos-row" style="margin-top:6px"></div>
            <button type="button" class="btn-sm ghost" onclick="openGamePhotoForm(${g.id})" style="margin-top:6px">📷 Ajouter des photos</button>
            <div id="gamePhotoForm_${g.id}" style="display:none"></div>
          </div>
          <div class="form-group">
            <label class="form-label">📝 Mon avis</label>
            <textarea class="form-input" id="agUserCR" rows="6"
              placeholder="Ton ressenti, anecdotes, moments mémorables…"
              style="resize:vertical;min-height:130px;margin-top:4px;font-size:16px">${esc(myGameCR?.content||'')}</textarea>
            ${crToolbarHtml('agUserCR')}
          </div>
          ${otherCRs.length ? `
          <div class="user-cr-others" style="margin-top:4px">
            <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
              <span>💬 Avis des autres joueurs (${otherCRs.length})</span>
              <span class="user-cr-chevron">▸</span>
            </div>
            <div class="user-cr-others-body" style="display:none">
              ${otherCRs.map(cr => `
                <div class="game-cr-user-edit" style="margin-bottom:8px">
                  <span class="user-cr-author">👤 ${esc(cr.username)}</span>
                  <div style="margin-top:4px;font-size:.82rem;line-height:1.5;white-space:pre-wrap">${renderCRContent(cr.content)}</div>
                </div>`).join('')}
            </div>
          </div>` : ''}`;
      })() : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-sm ghost" onclick="document.getElementById('archGameForm').style.display='none'">Annuler</button>
        <button class="btn-sm accent" onclick="saveArchiveGame(${g ? 'true' : 'false'})">${g ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </div>
  `;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Initialiser le tag input joueurs
  const sessionPlayerNames = currentSession.participants.map(p => p.username);
  const initialJoueurs = g?.joueurs ? g.joueurs.split(',').map(s => s.trim()).filter(Boolean) : [];
  initTagInput('agJoueursInput', 'agJoueursTags', 'agJoueurs', 'agJoueursSugg',
    sessionPlayerNames, initialJoueurs,
    () => { refreshScoresGrid(g); refreshVainqueurSelect(); }  // callback quand joueurs changent
  );
  // Vainqueur: géré par select + saisie libre
  // Scores grid initial
  refreshScoresGrid(g);
  // Charger les photos existantes du jeu (mode édition)
  if (g) refreshGamePhotos(g.id);
}

// Affiche/rafraîchit les photos d'un jeu dans le formulaire d'édition
function refreshGamePhotos(gameId) {
  const grid = document.getElementById('gamePhotosGrid_' + gameId);
  if (!grid) return;
  const game = (archiveData.games || []).find(x => x.id === gameId);
  const photos = game?.photos || [];
  if (!photos.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Aucune photo pour ce jeu</div>';
    return;
  }
  grid.innerHTML = photos.map(p => renderMediaThumb(p, gameId)).join('');
}

// Ouvre le formulaire d'ajout de photo dans la carte de jeu (édition)
function openGamePhotoForm(gameId) {
  const formId = 'gamePhotoForm_' + gameId;
  const form = document.getElementById(formId);
  if (!form) return;
  const isVisible = form.style.display !== 'none';
  if (isVisible) { form.style.display = 'none'; return; }
  form.style.display = 'block';
  form.innerHTML = `
    <div class="arch-form-box" style="margin-top:8px">
      <div class="arch-photo-tabs">
        <button type="button" class="arch-photo-tab active" id="gpTabUpload_${gameId}" onclick="switchGamePhotoTab('upload',${gameId})">⬆️ Upload</button>
        <button type="button" class="arch-photo-tab" id="gpTabUrl_${gameId}" onclick="switchGamePhotoTab('url',${gameId})">🔗 URL / Vidéo</button>
      </div>
      <div id="gpUpload_${gameId}">
        <div class="arch-drop-zone" onclick="document.getElementById('gpFile_${gameId}').click()"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="handleGamePhotoDrop(event,${gameId})">
          <input type="file" id="gpFile_${gameId}" accept="image/*,video/*" multiple style="display:none"
            onchange="handleGamePhotoFiles(this.files,${gameId})">
          <div class="arch-drop-icon">📷</div>
          <div class="arch-drop-label">Cliquer ou glisser ici</div>
          <div class="arch-drop-sub">Images · max 8MB</div>
        </div>
        <div id="gpProgress_${gameId}" style="margin-top:8px"></div>
      </div>
      <div id="gpUrl_${gameId}" style="display:none">
        <div class="form-group" style="margin-top:8px">
          <label class="form-label">URL photo ou vidéo</label>
          <input class="form-input" id="gpUrlInput_${gameId}" placeholder="https://imgur.com/… ou https://youtube.com/…">
        </div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Légende (optionnel)</label>
        <input class="form-input" id="gpCaption_${gameId}" placeholder="Description…">
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button type="button" class="btn-sm ghost" onclick="document.getElementById('${formId}').style.display='none'">Fermer</button>
        <button type="button" class="btn-sm accent" id="gpUrlBtn_${gameId}" onclick="saveGamePhotoUrl(${gameId})" style="display:none">Ajouter</button>
      </div>
    </div>
  `;
}

function switchGamePhotoTab(tab, gameId) {
  document.getElementById('gpUpload_' + gameId).style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('gpUrl_' + gameId).style.display = tab === 'url' ? 'block' : 'none';
  document.getElementById('gpUrlBtn_' + gameId).style.display = tab === 'url' ? '' : 'none';
  document.getElementById('gpTabUpload_' + gameId).classList.toggle('active', tab === 'upload');
  document.getElementById('gpTabUrl_' + gameId).classList.toggle('active', tab === 'url');
}

function handleGamePhotoDrop(event, gameId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  handleGamePhotoFiles(event.dataTransfer.files, gameId);
}

async function handleGamePhotoFiles(files, gameId) {
  const caption = document.getElementById('gpCaption_' + gameId)?.value.trim() || '';
  const progress = document.getElementById('gpProgress_' + gameId);
  for (const file of Array.from(files)) {
    const bar = document.createElement('div');
    bar.className = 'arch-upload-item';
    bar.innerHTML = '<span class="arch-upload-name">' + esc(file.name) + '</span><span class="arch-upload-status">⏳</span>';
    progress.appendChild(bar);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('sessionId', currentSession.session.id);
      const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (data.url) {
        let thumbnail = null;
        if (data.type === 'video') {
          bar.querySelector('.arch-upload-status').textContent = '🎬';
          const frame = await extractVideoFrame(file);
          thumbnail = await uploadThumbnailBlob(frame);
        }
        await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', { url: data.url, caption, game_id: gameId, thumbnail, type: data.type });
        bar.querySelector('.arch-upload-status').textContent = '✅';
      } else {
        bar.querySelector('.arch-upload-status').textContent = '❌ ' + (data.error || 'Erreur');
      }
    } catch(e) {
      bar.querySelector('.arch-upload-status').textContent = '❌ Erreur';
    }
  }
  // Recharger archiveData et rafraîchir uniquement la grille
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/archive');
  archiveData = r;
  refreshGamePhotos(gameId);
}

async function saveGamePhotoUrl(gameId) {
  const url = document.getElementById('gpUrlInput_' + gameId)?.value.trim();
  if (!url) { showToast('URL requise'); return; }
  const caption = document.getElementById('gpCaption_' + gameId)?.value.trim() || '';
  // Détecter type
  const isVideo = /youtube\.com|youtu\.be|vimeo\.com|\.mp4$|\.mov$|\.webm$/i.test(url);
  await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', {
    url, caption, game_id: gameId, type: isVideo ? 'video' : 'photo'
  });
  document.getElementById('gpUrlInput_' + gameId).value = '';
  document.getElementById('gpCaption_' + gameId).value = '';
  const r = await api('GET', '/api/sessions/' + currentSession.session.id + '/archive');
  archiveData = r;
  refreshGamePhotos(gameId);
}

async function saveArchiveGame(isEdit) {
  const name = document.getElementById('agName').value.trim();
  if (!name) { showToast('Nom requis'); return; }
  // Le champ "Compte-rendu" global a été remplacé par "Mon avis" — on garde compte_rendu vide pour compatibilité
  const payload = {
    game_name: name,
    thumbnail: document.getElementById('agThumb').value.trim(),
    joueurs: document.getElementById('agJoueurs').value.trim(),
    vainqueur: document.getElementById('agVainqueur').value.trim(),
    scores: document.getElementById('agScores').value.trim(),
    compte_rendu: '',
  };
  let gameId;
  if (isEdit) {
    gameId = parseInt(document.getElementById('agEditId').value);
    await api('PATCH', `/api/archive/games/${gameId}`, payload);
  } else {
    const res = await api('POST', `/api/sessions/${currentSession.session.id}/archive/games`, { ...payload, sort_order: archiveData.games.length });
    gameId = res.id;
  }
  // Sauvegarder l'avis personnel sur ce jeu (CR utilisateur)
  const userCRField = document.getElementById('agUserCR');
  if (gameId && userCRField) {
    await api('POST', `/api/archive/games/${gameId}/cr`, { content: userCRField.value });
  }
  document.getElementById('archGameForm').style.display = 'none';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  initPhotoDnd();
  showToast(isEdit ? 'Jeu mis à jour !' : 'Jeu ajouté !');
}

async function deleteArchiveGame(id) {
  if (!confirm('Supprimer ce jeu de l\'archive ?')) return;
  await api('DELETE', `/api/archive/games/${id}`);
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  initPhotoDnd();
}

function openArchivePhotoForm(gameId) {
  // Si gameId est null, c'est pour la séance globale — formulaire dans archGameForm ou zone dédiée
  const formId = gameId !== null ? 'archGameForm' : 'archSessionMediaForm';
  let form = document.getElementById(formId);
  if (!form) {
    // créer un div temporaire sous archSessionMedia
    form = document.createElement('div');
    form.id = formId;
    document.getElementById('archSessionMedia').after(form);
  }
  form.style.display = 'block';
  form.innerHTML = `
    <div class="arch-form-box" style="margin-top:8px">
      <div class="section-label" style="margin-bottom:10px">📷 Ajouter photos / vidéos</div>
      <div class="arch-photo-tabs">
        <button class="arch-photo-tab active" id="tabUpload" onclick="switchPhotoTab('upload',${gameId})">⬆️ Upload</button>
        <button class="arch-photo-tab" id="tabUrl" onclick="switchPhotoTab('url',${gameId})">🔗 URL / Vidéo</button>
      </div>
      <div id="photoTabUpload">
        <div class="arch-drop-zone" id="archDropZone" onclick="document.getElementById('phFileInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handlePhotoDrop(event,${gameId})">
          <input type="file" id="phFileInput" accept="image/*,video/*" multiple style="display:none" onchange="handlePhotoFiles(this.files,${gameId})">
          <div class="arch-drop-icon">📷</div>
          <div class="arch-drop-label">Cliquer ou glisser ici</div>
          <div class="arch-drop-sub">Images · max 8MB</div>
        </div>
        <div id="archUploadProgress" style="margin-top:8px"></div>
      </div>
      <div id="photoTabUrl" style="display:none">
        <div class="form-group" style="margin-top:8px">
          <label class="form-label">URL photo ou vidéo</label>
          <input class="form-input" id="phUrl" placeholder="https://imgur.com/… ou https://youtube.com/watch?v=…">
          <div style="font-size:.68rem;color:var(--text-muted);margin-top:3px">YouTube, Vimeo, lien direct image</div>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Légende (optionnel)</label><input class="form-input" id="phCaption" placeholder="Description…"></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-sm ghost" onclick="document.getElementById('${formId}').style.display='none'">Fermer</button>
        <button class="btn-sm accent" id="phSaveUrlBtn" onclick="saveArchivePhotoUrl(${gameId},'${formId}')" style="display:none">Ajouter</button>
      </div>
    </div>
  `;
}

function switchPhotoTab(tab, gameId) {
  document.getElementById('photoTabUpload').style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('photoTabUrl').style.display = tab === 'url' ? 'block' : 'none';
  document.getElementById('phSaveUrlBtn').style.display = tab === 'url' ? '' : 'none';
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabUrl').classList.toggle('active', tab === 'url');
}

function renderSessionMedia() {
  const el = document.getElementById('archSessionMedia');
  if (!el) return;
  const media = archiveData?.photos || [];
  if (!media.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);font-style:italic;padding:4px 0">Aucun média — ajoutez photos ou vidéos de la journée</div>';
    return;
  }
  el.innerHTML = `<div class="arch-photos-row">${media.map(m => renderMediaThumb(m, null)).join('')}</div>`;
}

function renderMediaThumb(m, gameId) {
  const isDirectVideo = m.url.match(/\.mp4|\.webm|\.mov/i);
  const isEmbedVideo = m.url.match(/youtube|youtu\.be|vimeo/);
  const mid = m.id;
  const gid = gameId || '';
  const cap = m.caption || '';

  function makeWrap(innerEl) {
    const div = document.createElement('div');
    div.className = 'arch-photo-wrap';
    div.draggable = true;
    div.dataset.mid = String(mid);
    div.dataset.gid = String(gid);
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.appendChild(innerEl);

    const capEl = document.createElement('div');
    capEl.className = 'arch-caption-edit';
    capEl.contentEditable = 'true';
    capEl.dataset.mid = String(mid);
    capEl.title = 'Cliquer pour ajouter un titre';
    capEl.textContent = cap;
    capEl.onblur = function() { savePhotoCaption(this); };
    capEl.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
    const delLink = document.createElement('button');
    delLink.type = 'button';
    delLink.className = 'arch-del-btn';
    delLink.title = 'Supprimer';
    delLink.innerHTML = '🗑';
    delLink.setAttribute('onclick', `event.preventDefault();event.stopPropagation();if(confirm('Supprimer ce média ?'))deleteArchivePhoto(${mid},${gid===null?'null':gid})`);
    // Case "Ne pas publier"
    const pubWrap = document.createElement('label');
    pubWrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:.65rem;color:var(--text-muted);cursor:pointer;margin-top:3px';
    const pubCb = document.createElement('input');
    pubCb.type = 'checkbox';
    if (m.is_public === 0) pubCb.setAttribute('checked', 'checked');
    pubCb.setAttribute('onchange', `togglePhotoPublic(${mid}, this.checked ? 0 : 1)`);
    pubWrap.appendChild(pubCb);
    pubWrap.appendChild(document.createTextNode('Ne pas publier'));
    div.appendChild(inner);
    div.appendChild(capEl);
    div.appendChild(pubWrap);
    div.appendChild(delLink);
    return div;
  }

  function makeVideoPreview(imgSrc, clickUrl, isEmbed) {
    const wrap = document.createElement('div');
    wrap.className = 'arch-video-preview';
    const safeClick = clickUrl.replace(/'/g, "\\'");
    const safeCapV = (cap||'').replace(/'/g, "\\'");
    wrap.setAttribute('onclick', "openLightbox('" + safeClick + "','" + safeCapV + "'," + (isEmbed ? 'true' : 'false') + ")");
    function makeThumbIcon() {
      const ph = document.createElement('div');
      ph.className = 'arch-video-native-thumb';
      ph.style.cssText = 'background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:2rem';
      ph.textContent = '\u25B6';
      return ph;
    }
    if (imgSrc) {
      const img = document.createElement('img');
      img.src = imgSrc;
      img.className = 'arch-video-native-thumb';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onerror = function() { wrap.replaceChild(makeThumbIcon(), img); };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(makeThumbIcon());
    }
    const play = document.createElement('div');
    play.className = 'arch-video-play-btn';
    play.textContent = '\u25B6';
    wrap.appendChild(play);
    return wrap;
  }

  if (isEmbedVideo) {
    const ytMatch = m.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([-\w]+)/);
    const ytThumb = ytMatch ? 'https://img.youtube.com/vi/' + ytMatch[1] + '/hqdefault.jpg' : null;
    const embedUrl = getVideoEmbed(m.url);
    let innerEl;
    if (ytThumb) {
      innerEl = makeVideoPreview(ytThumb, embedUrl || m.url, true);
    } else {
      const a = document.createElement('a');
      a.href = m.url;
      a.target = '_blank';
      a.className = 'arch-video-link';
      a.textContent = '\u25B6 Vid\u00e9o';
      innerEl = a;
    }
    return makeWrap(innerEl).outerHTML;
  }

  if (isDirectVideo) {
    const innerEl = makeVideoPreview(m.thumbnail || null, m.url, false);
    return makeWrap(innerEl).outerHTML;
  }

  const img = document.createElement('img');
  img.src = m.url;
  img.className = 'arch-photo-thumb';
  img.loading = 'lazy';
  img.style.cursor = 'zoom-in';
  // Utiliser setAttribute pour que onclick survive à outerHTML
  const safeUrl = m.url.replace(/'/g, "\\'");
  const safeCap = (cap||'').replace(/'/g, "\\'");
  img.setAttribute('onclick', "openLightbox('" + safeUrl + "','" + safeCap + "',false)");
  img.setAttribute('onerror', "this.closest('.arch-photo-wrap').style.display='none'");
  return makeWrap(img).outerHTML;
}

function getVideoEmbed(url) {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

function handlePhotoDrop(event, gameId) {
  event.preventDefault();
  document.getElementById('archDropZone').classList.remove('drag-over');
  handlePhotoFiles(event.dataTransfer.files, gameId);
}

async function extractVideoFrame(file) {
  return new Promise(function(resolve) {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(file);
    video.src = url;
    let done = false;
    function capture() {
      if (done) return;
      done = true;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = video.videoWidth ? Math.round(320 * video.videoHeight / video.videoWidth) : 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(blob) { resolve(blob && blob.size > 1000 ? blob : null); }, 'image/jpeg', 0.75);
    }
    video.addEventListener('seeked', capture);
    video.addEventListener('canplay', function() {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.05);
    });
    video.addEventListener('loadedmetadata', function() {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.05);
    });
    video.addEventListener('error', function() { URL.revokeObjectURL(url); resolve(null); });
    setTimeout(function() { if (!done) { capture(); } }, 3000);
    video.load();
  });
}

async function uploadThumbnailBlob(blob) {
  if (!blob) return null;
  const formData = new FormData();
  formData.append('photo', blob, 'thumb.jpg');
  const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
  const data = await res.json();
  return data.url || null;
}

async function handlePhotoFiles(files, gameId) {
  const caption = document.getElementById('phCaption')?.value.trim() || '';
  const progress = document.getElementById('archUploadProgress');
  const arr = Array.from(files);
  for (const file of arr) {
    const bar = document.createElement('div');
    bar.className = 'arch-upload-item';
    bar.innerHTML = '<span class="arch-upload-name">' + esc(file.name) + '</span><span class="arch-upload-status">⏳</span>';
    progress.appendChild(bar);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      if (currentSession && currentSession.session) formData.append('sessionId', currentSession.session.id);
      const res = await fetch('/api/archive/photos/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (data.url) {
        let thumbnail = null;
        if (data.type === 'video') {
          bar.querySelector('.arch-upload-status').textContent = '🎬';
          const frame = await extractVideoFrame(file);
          thumbnail = await uploadThumbnailBlob(frame);
        }
        await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/photos', { url: data.url, caption, game_id: gameId, thumbnail, type: data.type });
        bar.querySelector('.arch-upload-status').textContent = '✅';
      } else {
        bar.querySelector('.arch-upload-status').textContent = '❌ ' + (data.error || 'Erreur');
      }
    } catch(e) {
      bar.querySelector('.arch-upload-status').textContent = '❌ Erreur';
    }
  }
  // Rafraîchir la galerie
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function saveArchivePhotoUrl(gameId, formId) {
  const url = document.getElementById('phUrl')?.value.trim();
  if (!url) { showToast('URL requise'); return; }
  const caption = document.getElementById('phCaption')?.value.trim() || '';
  await api('POST', `/api/sessions/${currentSession.session.id}/archive/photos`, { url, caption, game_id: gameId });
  const formEl = document.getElementById(formId || 'archGameForm');
  if (formEl) formEl.style.display = 'none';
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  showToast('Média ajouté !');
}

let _dndDragSrc = null;

function initPhotoDnd() {
  let dragSrc = null;
  document.querySelectorAll('.arch-photos-row').forEach(function(row) {
    row.addEventListener('dragstart', function(e) {
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (!wrap) return;
      dragSrc = wrap;
      setTimeout(function() { wrap.classList.add('dragging'); }, 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', function(e) {
      document.querySelectorAll('.arch-photo-wrap').forEach(function(x) { x.classList.remove('dragging','drag-over'); });
      dragSrc = null;
    });
    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (wrap && dragSrc && wrap !== dragSrc) {
        document.querySelectorAll('.arch-photo-wrap').forEach(function(x) { x.classList.remove('drag-over'); });
        wrap.classList.add('drag-over');
      }
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      const wrap = e.target.closest('.arch-photo-wrap[data-mid]');
      if (!wrap || !dragSrc || wrap === dragSrc) return;
      wrap.classList.remove('drag-over');
      if (dragSrc.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING) {
        row.insertBefore(dragSrc, wrap.nextSibling);
      } else {
        row.insertBefore(dragSrc, wrap);
      }
      const newOrder = Array.from(row.querySelectorAll('.arch-photo-wrap[data-mid]')).map(function(x, i) {
        return { id: parseInt(x.dataset.mid), sort_order: i };
      });
      api('PATCH', '/api/archive/photos/reorder', { items: newOrder });
    });

    row.addEventListener('blur', function(e) {
      if (e.target.classList.contains('arch-caption-edit')) {
        savePhotoCaption(e.target);
      }
    }, true);
    row.addEventListener('keydown', function(e) {
      if (e.target.classList.contains('arch-caption-edit') && e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });
  });
}

async function togglePhotoPublic(photoId, isPublic) {
  await api('PATCH', `/api/archive/photos/${photoId}`, { is_public: isPublic ? 1 : 0 });
  // Mettre à jour en mémoire
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(x => x.id === photoId);
    if (p) { p.is_public = isPublic ? 1 : 0; return; }
  }
  const p2 = (archiveData.photos || []).find(x => x.id === photoId);
  if (p2) p2.is_public = isPublic ? 1 : 0;
}

async function savePhotoCaption(el) {
  const mid = parseInt(el.dataset.mid);
  const caption = el.textContent.trim();
  let currentSortOrder = 0;
  let currentIsPublic = 1;
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(function(x) { return x.id === mid; });
    if (p) { currentSortOrder = p.sort_order || 0; currentIsPublic = p.is_public !== 0 ? 1 : 0; break; }
  }
  const p2 = (archiveData.photos || []).find(function(x) { return x.id === mid; });
  if (p2) { currentSortOrder = p2.sort_order || 0; currentIsPublic = p2.is_public !== 0 ? 1 : 0; }
  await api('PATCH', '/api/archive/photos/' + mid, { caption, sort_order: currentSortOrder, is_public: currentIsPublic });
  for (const g of (archiveData.games || [])) {
    const p = (g.photos || []).find(function(x) { return x.id === mid; });
    if (p) { p.caption = caption; return; }
  }
  if (p2) p2.caption = caption;
}

async function deleteArchivePhoto(photoId, gameId) {
  await api('DELETE', `/api/archive/photos/${photoId}`);
  const r = await api('GET', `/api/sessions/${currentSession.session.id}/archive`);
  archiveData = r;
  renderArchiveGames();
  renderSessionMedia();
  initPhotoDnd();
}

async function saveArchiveCR() {
  // Compatibilité ancienne — sauvegarde le CR général via la nouvelle API user CR
  return saveArchiveUserCR(currentUser.id);
}

// ─────────────────────────────────────────────────────────────
// CR PAR UTILISATEUR (séance)
// ─────────────────────────────────────────────────────────────

function renderUserCRs() {
  const container = document.getElementById('archUserCRs');
  if (!container) return;
  const userCRs = archiveData.userCRs || [];
  const myId = currentUser.id;
  const myCR = userCRs.find(c => c.user_id === myId);
  const others = userCRs.filter(c => c.user_id !== myId);
  const myContent = myCR?.content || '';

  // Mon CR — textarea grand par défaut, affiché en mode lecture si déjà écrit
  const myBlock = `
    <div class="user-cr-block" id="userCR_${myId}">
      <div class="user-cr-header">
        <span class="user-cr-author">👤 ${esc(currentUser.username)} (toi)</span>
        ${myContent ? `<button class="btn-sm ghost" onclick="editArchiveCR(${myId})">✏️ Modifier</button>` : ''}
      </div>
      <div class="user-cr-body" id="userCRBody_${myId}">
        ${myContent
          ? `<div class="user-cr-content">${renderCRContent(myContent)}</div>`
          : `<textarea class="form-input" id="archCR_${myId}" rows="8"
               placeholder="Ton compte-rendu : ressenti, anecdotes, moments mémorables…"
               style="resize:vertical;min-height:160px;font-size:16px">${esc(myContent)}</textarea>
             ${crToolbarHtml('archCR_'+myId)}
             <div style="display:flex;gap:6px;margin-top:8px">
               <button class="btn-sm accent" onclick="saveArchiveUserCR(${myId})">💾 Sauvegarder</button>
             </div>`}
      </div>
    </div>`;

  // Avis des autres — accordéon replié par défaut
  const othersBlock = others.length ? `
    <div class="user-cr-others">
      <div class="user-cr-others-header" onclick="toggleOtherCRs(this)">
        <span>💬 Avis des autres joueurs (${others.length})</span>
        <span class="user-cr-chevron">▸</span>
      </div>
      <div class="user-cr-others-body" style="display:none">
        ${others.map(cr => `
          <div class="user-cr-block" style="margin-bottom:8px">
            <div class="user-cr-header"><span class="user-cr-author">👤 ${esc(cr.username)}</span></div>
            <div class="user-cr-content">${renderCRContent(cr.content)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  container.innerHTML = myBlock + othersBlock;
}

function toggleOtherCRs(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector('.user-cr-chevron');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}

// Convertit ![gif](url) en <img> et préserve les sauts de ligne
function renderCRContent(text) {
  if (!text) return '';
  let html = esc(text);
  html = html.replace(/!\[gif\]\((https?:\/\/[^)]+)\)/g,
    '<img src="$1" alt="gif" style="max-width:200px;max-height:150px;border-radius:6px;display:block;margin:4px 0">');
  return html.replace(/\n/g, '<br>');
}

// Passe d'affichage à édition pour SON CR
function editArchiveCR(userId) {
  if (userId !== currentUser.id) return;
  const userCR = (archiveData.userCRs || []).find(c => c.user_id === userId);
  const content = userCR?.content || '';
  const body = document.getElementById('userCRBody_' + userId);
  if (!body) return;
  body.innerHTML = `
    <textarea class="form-input" id="archCR_${userId}" rows="10"
      placeholder="Ton compte-rendu : ressenti, anecdotes, moments mémorables…"
      style="resize:vertical;min-height:200px;font-size:16px">${esc(content)}</textarea>
    ${crToolbarHtml('archCR_'+userId)}
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn-sm accent" onclick="saveArchiveUserCR(${userId})">💾 Sauvegarder</button>
      <button class="btn-sm ghost" onclick="renderUserCRs()">Annuler</button>
    </div>
  `;
  document.getElementById('archCR_' + userId).focus();
}

async function saveArchiveUserCR(userId) {
  if (userId !== currentUser.id) return;
  const textarea = document.getElementById('archCR_' + userId);
  if (!textarea) return;
  const content = textarea.value;
  const res = await api('POST', '/api/sessions/' + currentSession.session.id + '/archive/cr', { content });
  if (res.error) { showToast(res.error); return; }
  // Mettre à jour archiveData localement
  if (!archiveData.userCRs) archiveData.userCRs = [];
  const existing = archiveData.userCRs.find(c => c.user_id === userId);
  if (existing) existing.content = content;
  else archiveData.userCRs.push({
    session_id: currentSession.session.id,
    user_id: userId,
    content,
    username: currentUser.username,
    updated_at: new Date().toISOString()
  });
  showToast('✓ Compte-rendu enregistré');
  renderUserCRs();
}

// ─────────────────────────────────────────────────────────────
// BARRE EMOJI + GIF pour les textareas CR
// ─────────────────────────────────────────────────────────────

function crToolbarHtml(textareaId) {
  return `
    <div class="cr-toolbar" id="crtb_${textareaId}">
      <div class="cr-emoji-row">
        <button class="cr-emoji-btn" title="Emojis" onclick="openEmojiPicker('${textareaId}', this)">😊</button>
        <button class="cr-gif-btn" onclick="toggleGifSearch('${textareaId}')">GIF</button>
      </div>
      <div class="cr-gif-panel" id="gifpanel_${textareaId}" style="display:none">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input class="form-input" id="gifsearch_${textareaId}" placeholder="Rechercher un GIF…"
            onkeydown="if(event.key==='Enter'){searchGiphy('${textareaId}');event.preventDefault()}">
          <button class="btn-sm ghost" onclick="searchGiphy('${textareaId}')">🔍</button>
          <button class="btn-sm ghost" onclick="document.getElementById('gifpanel_${textareaId}').style.display='none'">✕</button>
        </div>
        <div class="cr-gif-results" id="gifresults_${textareaId}"></div>
      </div>
    </div>`;
}

function insertCREmoji(textareaId, emoji) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + emoji.length;
  ta.focus();
}

let _emojiPickerEl = null;
let _emojiPickerTarget = null;

function openEmojiPicker(textareaId, btn) {
  if (!customElements.get('emoji-picker')) {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js';
    document.head.appendChild(script);
    script.onload = () => _showEmojiPicker(textareaId, btn);
    return;
  }
  _showEmojiPicker(textareaId, btn);
}

function _showEmojiPicker(textareaId, btn) {
  if (_emojiPickerEl && _emojiPickerTarget === textareaId) {
    _emojiPickerEl.remove();
    _emojiPickerEl = null;
    _emojiPickerTarget = null;
    return;
  }
  if (_emojiPickerEl) _emojiPickerEl.remove();

  const picker = document.createElement('emoji-picker');
  picker.style.cssText = 'position:absolute;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.3);border-radius:10px;';

  const rect = btn.getBoundingClientRect();
  picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  picker.style.left = Math.max(0, rect.left + window.scrollX) + 'px';

  picker.addEventListener('emoji-click', e => {
    insertCREmoji(textareaId, e.detail.unicode);
  });

  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target) && ev.target !== btn) {
        picker.remove();
        _emojiPickerEl = null;
        _emojiPickerTarget = null;
        document.removeEventListener('click', close);
      }
    });
  }, 50);

  document.body.appendChild(picker);
  _emojiPickerEl = picker;
  _emojiPickerTarget = textareaId;
}

function toggleGifSearch(textareaId) {
  const panel = document.getElementById('gifpanel_' + textareaId);
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) document.getElementById('gifsearch_' + textareaId)?.focus();
}

async function searchGiphy(textareaId) {
  const q = document.getElementById('gifsearch_' + textareaId)?.value.trim();
  if (!q) return;
  const results = document.getElementById('gifresults_' + textareaId);
  results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Recherche…</span>';
  try {
    const r = await api('GET', '/api/giphy?q=' + encodeURIComponent(q));
    if (!r.gifs?.length) { results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Aucun résultat</span>'; return; }
    results.innerHTML = '';
    r.gifs.forEach(gif => {
      const img = document.createElement('img');
      img.src = gif.preview;
      img.title = 'Cliquer pour insérer';
      img.className = 'cr-gif-thumb';
      img.onclick = () => insertGif(textareaId, gif.url);
      results.appendChild(img);
    });
  } catch(e) { results.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Erreur Giphy</span>'; }
}

function insertGif(textareaId, gifUrl) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  const md = '![gif](' + gifUrl + ')';
  ta.value = ta.value.slice(0, start) + md + ta.value.slice(start);
  ta.selectionStart = ta.selectionEnd = start + md.length;
  ta.focus();
  const panel = document.getElementById('gifpanel_' + textareaId);
  if (panel) panel.style.display = 'none';
}

function sortScoresDesc(scoresStr) {
  if (!scoresStr) return scoresStr;
  const parts = scoresStr.split(',').map(function(p) {
    const m = p.trim().match(/^(.+?):\s*(.+)$/);
    if (!m) return { raw: p.trim(), name: p.trim(), num: NaN };
    return { raw: p.trim(), name: m[1].trim(), val: m[2].trim(), num: parseFloat(m[2]) };
  });
  // Trier seulement si tous numériques
  if (parts.every(function(p) { return !isNaN(p.num); })) {
    parts.sort(function(a, b) { return b.num - a.num; });
  }
  return parts.map(function(p, i) {
    const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
    return p.val !== undefined ? (medal + p.name + ': ' + p.val) : p.raw;
  }).join(', ');
}

function refreshScoresGrid(g) {
  const grid = document.getElementById('agScoresGrid');
  const hidden = document.getElementById('agScores');
  if (!grid) return;

  // Récupérer les joueurs actuellement sélectionnés
  const joueursInput = document.getElementById('agJoueurs');
  const joueurs = joueursInput?.value ? joueursInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];

  // Parser les scores existants: "Alice: 87, Bob: 72"
  const existingScores = {};
  (g?.scores || hidden?.value || '').split(',').forEach(part => {
    const m = part.trim().match(/^(.+?):\s*(.+)$/);
    if (m) existingScores[m[1].trim()] = m[2].trim();
  });

  if (!joueurs.length) {
    grid.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">Ajoutez des joueurs pour saisir les scores</div>';
    return;
  }

  grid.innerHTML = joueurs.map(j => `
    <div class="score-row">
      <span class="score-name">${esc(j)}</span>
      <input class="form-input score-input" id="score_${esc(j).replace(/\s/g,'_')}" value="${esc(existingScores[j]||'')}" placeholder="0" oninput="updateScoresHidden()">
    </div>
  `).join('');
}

function updateScoresHidden() {
  const hidden = document.getElementById('agScores');
  const grid = document.getElementById('agScoresGrid');
  if (!hidden) return;
  const joueursInput = document.getElementById('agJoueurs');
  const joueurs = joueursInput?.value ? joueursInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  // Collecter scores actuels
  const rows = joueurs.map(j => {
    const input = document.getElementById('score_' + j.replace(/\s/g,'_'));
    const val = input?.value.trim() || '';
    return { j, val, num: parseFloat(val) };
  });
  // Sauvegarder
  hidden.value = rows.filter(r => r.val).map(r => r.j + ': ' + r.val).join(', ');
  // Réordonner visuellement si tous les scores sont numériques
  if (grid && rows.every(r => !r.val || !isNaN(r.num))) {
    const sorted = [...rows].sort((a, b) => {
      if (!a.val && !b.val) return 0;
      if (!a.val) return 1;
      if (!b.val) return -1;
      return b.num - a.num;
    });
    sorted.forEach(function(r, i) {
      const row = grid.querySelector('.score-row:nth-child(' + (i+1) + ')');
    });
    // Reconstruire les rows dans le bon ordre en préservant les valeurs
    const vals = {};
    rows.forEach(r => { vals[r.j] = r.val; });
    grid.innerHTML = sorted.map(function(r, i) {
      const medal = i === 0 && r.val ? '🥇 ' : i === 1 && r.val ? '🥈 ' : i === 2 && r.val ? '🥉 ' : '';
      return '<div class="score-row">'
        + '<span class="score-name">' + medal + esc(r.j) + '</span>'
        + '<input class="form-input score-input" id="score_' + esc(r.j).replace(/\s/g,'_') + '" value="' + esc(r.val) + '" placeholder="0" oninput="updateScoresHidden()">'
        + '</div>';
    }).join('');
  }
}

// ═══════════════════════════════════════════════════
// ARCHIVE GAME HELPERS
// ═══════════════════════════════════════════════════
function prefillArchiveGame(name, thumb, bggId) {
  const n = document.getElementById('agName');
  const t = document.getElementById('agThumb');
  if (n) n.value = name;
  if (t && thumb) t.value = thumb;
  // Highlight
  if (n) { n.focus(); n.select(); }
}

function buildVainqueurOptions(joueurs, current) {
  // Joueurs du jeu en priorité, sinon participants de la séance
  let list = joueurs ? joueurs.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  if (!list.length) {
    (currentSession.participants || []).forEach(function(p) { list.push(p.username); });
  }
  return list.map(function(name) {
    const sel = current === name ? ' selected' : '';
    return '<option value="' + esc(name) + '"' + sel + '>' + esc(name) + '</option>';
  }).join('');
}

function selectVainqueur(name) {
  const f = document.getElementById('agVainqueurFree');
  const h = document.getElementById('agVainqueur');
  const s = document.getElementById('agVainqueurFreeSugg');
  const sel = document.getElementById('agVainqueurSel');
  if (f) f.value = name;
  if (h) h.value = name;
  if (s) s.style.display = 'none';
  if (sel) sel.value = '';
}

function onVainqueurSelChange() {
  const sel = document.getElementById('agVainqueurSel');
  const free = document.getElementById('agVainqueurFree');
  const hidden = document.getElementById('agVainqueur');
  if (free && sel.value) free.value = '';
  if (hidden) hidden.value = sel.value;
}

function onVainqueurFreeInput(input) {
  const q = input.value.trim().toLowerCase();
  const hidden = document.getElementById('agVainqueur');
  const sel = document.getElementById('agVainqueurSel');
  const sugg = document.getElementById('agVainqueurFreeSugg');
  if (sel) sel.value = '';
  if (hidden) hidden.value = input.value.trim();
  if (!sugg) return;
  if (!q) { sugg.style.display = 'none'; return; }
  let list = (window._allUsers || currentSession.participants || []).map(function(u) { return u.username; });
  const matches = list.filter(function(n) { return n.toLowerCase().includes(q); });
  if (!matches.length) { sugg.style.display = 'none'; return; }
  sugg.innerHTML = matches.map(function(n) {
    const enc = encodeURIComponent(n);
    return '<div class="tag-sugg-item" onmousedown="event.preventDefault();selectVainqueur(decodeURIComponent(\'' + enc + '\'))">' + esc(n) + '</div>';
  }).join('');
  sugg.style.display = 'block';
}

// Mettre à jour le select vainqueur quand les joueurs changent
function refreshVainqueurSelect() {
  const sel = document.getElementById('agVainqueurSel');
  if (!sel) return;
  const joueurs = document.getElementById('agJoueurs')?.value || '';
  const current = document.getElementById('agVainqueur')?.value || '';
  sel.innerHTML = '<option value="">— Sélectionner —</option>' + buildVainqueurOptions(joueurs, current);
}

function archiveGameAC(input) {
  const q = input.value.trim();
  const sugg = document.getElementById('agNameSugg');
  if (!sugg) return;
  if (q.length < 2) { sugg.style.display = 'none'; return; }
  const local = (currentSession.proposals || []).filter(function(p) { return p.name.toLowerCase().includes(q.toLowerCase()); });
  let html = local.map(function(p) {
    const n = esc(p.name);
    const t = p.thumbnail ? '<img src="' + esc(p.thumbnail) + '" style="width:20px;height:20px;border-radius:3px;object-fit:cover">' : '<span>🎲</span>';
    return '<div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px" onmousedown="event.preventDefault();document.getElementById(' + "'agName'" + ').value=' + "'" + n.replace("'", "\\'") + "'" + ';document.getElementById(' + "'agNameSugg'" + ').style.display=' + "'none'" + '">' + t + '<span>' + n + '</span></div>';
  }).join('');
  if (html) { sugg.innerHTML = html; sugg.style.display = 'block'; }
  clearTimeout(window._agACTimer);
  window._agACTimer = setTimeout(async function() {
    const res = await api('GET', '/api/bgg/search?q=' + encodeURIComponent(q));
    const bggGames = (res.games || []).slice(0, 5);
    if (!bggGames.length) return;
    const bggHtml = bggGames.map(function(g) {
      const n = esc(g.name);
      const t = g.thumbnail ? '<img src="' + esc(g.thumbnail) + '" style="width:20px;height:20px;border-radius:3px;object-fit:cover">' : '<span>🎲</span>';
      return '<div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px" onmousedown="event.preventDefault();document.getElementById(' + "'agName'" + ').value=decodeURIComponent(' + "'" + encodeURIComponent(g.name) + "'" + ');if(document.getElementById(' + "'agThumb'" + '))document.getElementById(' + "'agThumb'" + ').value=' + "'" + esc(g.thumbnail||'').replace("'","\\'") + "'" + ';document.getElementById(' + "'agNameSugg'" + ').style.display=' + "'none'" + '">' + t + '<span>' + n + '</span><span style="font-size:.6rem;color:var(--accent2);margin-left:auto">BGG</span></div>';
    }).join('');
    sugg.innerHTML = (html || '') + bggHtml;
    sugg.style.display = 'block';
  }, 600);
}

async function searchBGGForArchive() {
  const q = document.getElementById('agBggSearch')?.value.trim();
  if (!q) return;
  const res = document.getElementById('agBggResults');
  res.style.display = 'block';
  res.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Recherche…</span>';
  const r = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (!r.results?.length) { res.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Aucun résultat</span>'; return; }
  res.innerHTML = r.results.slice(0, 6).map(g => `
    <div class="bgg-result-item" onclick="prefillArchiveGame('${esc(g.name).replace(/'/g,"\\'")}','${esc(g.thumbnail||'').replace(/'/g,"\\'")}','${g.id}')">
      ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<div style="width:28px;height:28px;border-radius:4px;background:var(--surface3);flex-shrink:0"></div>'}
      <span style="font-size:.78rem">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted)">(${g.year})</span>` : ''}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════
// TAG INPUT (joueurs autocomplete)
// ═══════════════════════════════════════════════════
function initTagInput(inputId, tagsId, hiddenId, suggId, suggestions, initialValues, onChange) {
  const input = document.getElementById(inputId);
  const tagsEl = document.getElementById(tagsId);
  const hidden = document.getElementById(hiddenId);
  const sugg = document.getElementById(suggId);
  if (!input) return;

  let selected = [...initialValues];

  function render() {
    tagsEl.innerHTML = selected.map(v => `
      <span class="tag-chip">${esc(v)}<button onclick="removeTag('${inputId}','${tagsId}','${hiddenId}','${suggId}',this)" data-val="${esc(v)}">×</button></span>
    `).join('');
    hidden.value = selected.join(', ');
    if (onChange) onChange(selected);
  }

  function showSugg(val) {
    const q = val.toLowerCase();
    const matches = suggestions.filter(s => s.toLowerCase().includes(q) && !selected.includes(s));
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.style.display = 'block';
    sugg.innerHTML = matches.map(s => `<div class="tag-sugg-item" onmousedown="addTag('${inputId}','${tagsId}','${hiddenId}','${suggId}','${s.replace(/'/g,"\\'")}');event.preventDefault()">${esc(s)}</div>`).join('');
  }

  input.oninput = () => showSugg(input.value);
  input.onfocus = () => showSugg(input.value);
  input.onblur = () => setTimeout(() => { sugg.style.display = 'none'; }, 150);
  input.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !selected.includes(val)) { selected.push(val); render(); }
      input.value = '';
      sugg.style.display = 'none';
    } else if (e.key === 'Backspace' && !input.value && selected.length) {
      selected.pop(); render();
    }
  };

  // stocker selected sur l'élément pour y accéder depuis addTag/removeTag
  input._selected = selected;
  input._render = render;
  render();
}

function addTag(inputId, tagsId, hiddenId, suggId, val) {
  const input = document.getElementById(inputId);
  if (!input._selected.includes(val)) { input._selected.push(val); input._render(); }
  input.value = '';
  document.getElementById(suggId).style.display = 'none';
}

function removeTag(inputId, tagsId, hiddenId, suggId, btn) {
  const input = document.getElementById(inputId);
  const val = btn.dataset.val;
  input._selected = input._selected.filter(s => s !== val);
  input._render();
}

// ═══════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════
async function loadStats(year) {
  const el = document.getElementById('statsContent');
  el.innerHTML = '<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Chargement…</span></div>';
  const url = year ? `/api/stats?year=${year}` : '/api/stats';
  const r = await api('GET', url);
  window._gameRankings = r.gameRankings || [];

  const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', {month:'long', year:'numeric'}) : '—';

  el.innerHTML = `
    <!-- Sélecteur d'année -->
    <div class="stats-year-tabs">
      <button class="stats-year-tab ${!r.currentYear ? 'active' : ''}" onclick="loadStats()">All-time</button>
      ${(r.years||[]).map(y => `<button class="stats-year-tab ${r.currentYear===y?'active':''}" onclick="loadStats('${y}')">${y}</button>`).join('')}
    </div>

    <!-- Chiffres clés -->
    <div class="stats-kpis">
      <div class="stats-kpi"><div class="stats-kpi-val">${r.seancesInfo?.total || 0}</div><div class="stats-kpi-label">Séances jouées</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.mostPlayed?.reduce((s,g) => s + Number(g.nb_parties), 0) || 0}</div><div class="stats-kpi-label">Parties jouées</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.mostPlayed?.length || 0}</div><div class="stats-kpi-label">Jeux différents</div></div>
      <div class="stats-kpi"><div class="stats-kpi-val">${r.playerStats?.length || 0}</div><div class="stats-kpi-label">Joueurs</div></div>
    </div>

    <!-- Classement joueurs -->
    <div class="stats-section">
      <div class="stats-section-title">🏆 Classement joueurs</div>
      <div class="stats-table-wrap">
        <table class="stats-table">
          <thead><tr><th>#</th><th>Joueur</th><th>Parties</th><th>Victoires</th><th>% Victoires</th><th>Séances</th></tr></thead>
          <tbody>
            ${(r.playerStats||[]).map((p,i) => `
              <tr class="${i===0?'stats-row-gold':i===1?'stats-row-silver':i===2?'stats-row-bronze':''}">
                <td class="stats-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
                <td class="stats-name">${esc(p.name)}</td>
                <td>${p.parties}</td>
                <td><strong>${p.victoires}</strong></td>
                <td>
                  <div class="stats-bar-wrap">
                    <div class="stats-bar" style="width:${p.pct_victoires}%"></div>
                    <span>${p.pct_victoires}%</span>
                  </div>
                </td>
                <td>${p.seances}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Jeux les plus joués -->
    <div class="stats-section">
      <div class="stats-section-title">🎲 Jeux les plus joués</div>
      <div class="stats-games-grid">
        ${(r.mostPlayed||[]).map((g,i) => `
          <div class="stats-game-card">
            ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" class="stats-game-thumb" onerror="this.style.display='none'">` : '<div class="stats-game-thumb-ph">🎲</div>'}
            <div class="stats-game-info">
              <div class="stats-game-name">${esc(g.game_name)}</div>
              <div class="stats-game-meta">${g.nb_parties} partie${g.nb_parties>1?'s':''}</div>
              ${g.champion ? `<div class="stats-game-champ">🏆 ${esc(g.champion)}</div>` : ''}
            </div>
            <div class="stats-game-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Champions par jeu -->
    <div class="stats-section">
      <div class="stats-section-title">👑 Champions par jeu</div>
      ${(r.champions||[]).filter(g=>g.champion||g.vainqueur).length ? `
      <div style="position:relative;margin-bottom:10px">
        <input class="form-input" id="champSearch" placeholder="Rechercher un jeu…" autocomplete="off"
          oninput="filterChampions(this.value)">
      </div>
      <div id="champsGrid" class="stats-champs-grid">
        ${(r.champions||[]).filter(g=>g.champion||g.vainqueur).map(g => `
          <div class="stats-champ-card" data-game="${esc((g.game_name||'').toLowerCase())}">
            ${g.thumbnail ? '<img src="' + esc(g.thumbnail) + '" class="stats-champ-thumb" onerror="this.style.display=\'none\'">' : ''}
            <div class="stats-champ-info">
              <div class="stats-champ-game">${esc(g.game_name)}</div>
              <div class="stats-champ-name">👑 ${esc(g.vainqueur||g.champion)}</div>
              <div class="stats-champ-nb">${g.nb_victoires} victoire${g.nb_victoires>1?'s':''}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div style="font-size:.78rem;color:var(--text-muted);font-style:italic">Pas encore de données</div>'}
    </div>

    ${r.neverPlayed?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">😴 Votés mais jamais joués</div>
      <div class="stats-never-list">
        ${r.neverPlayed.map(g => `<div class="stats-never-item">
          ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<div style="width:32px;height:32px;border-radius:4px;background:var(--surface2);flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
          <span style="flex:1">${esc(g.name)}</span>
          <span style="color:var(--text-muted);font-size:.7rem">${g.nb_votes} vote${g.nb_votes>1?'s':''}</span>
        </div>`).join('')}
      </div>
    </div>` : '<div class="stats-section"><div class="stats-section-title">😴 Votés mais jamais joués</div><div style="font-size:.78rem;color:var(--text-muted);font-style:italic">Tous les jeux votés ont été joués 🎉</div></div>'}

    ${r.gameRankings?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">🏅 Records par jeu</div>
      <div style="position:relative;margin-bottom:10px">
        <input class="form-input" id="gameRankingSearch" placeholder="Rechercher un jeu…" autocomplete="off"
          oninput="filterGameRankings(this.value)"
          onfocus="filterGameRankings(this.value)"
          onblur="setTimeout(()=>document.getElementById('gameRankingSugg').style.display='none',150)">
        <div id="gameRankingSugg" class="tag-suggestions" style="display:none"></div>
      </div>
      <div id="gameRankingResult"></div>
    </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════
// GAME RANKINGS SEARCH
// ═══════════════════════════════════════════════════
function filterChampions(q) {
  const grid = document.getElementById('champsGrid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.stats-champ-card');
  const search = q.toLowerCase().trim();
  cards.forEach(function(card) {
    const game = card.dataset.game || '';
    card.style.display = (!search || game.includes(search)) ? '' : 'none';
  });
}

function filterGameRankings(q) {
  const rankings = window._gameRankings || [];
  const sugg = document.getElementById('gameRankingSugg');
  if (!sugg) return;
  const matches = rankings.filter(g => g.game_name.toLowerCase().includes(q.toLowerCase()));
  if (!matches.length) { sugg.style.display = 'none'; return; }
  sugg.style.display = 'block';
  sugg.innerHTML = matches.slice(0, 8).map(g => `
    <div class="tag-sugg-item" style="display:flex;align-items:center;gap:8px"
      onmousedown="showGameRanking('${g.game_name.replace(/'/g,"\\'").replace(/"/g,'\\"')}');event.preventDefault()">
      ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0">` : '<span>🎲</span>'}
      <span>${esc(g.game_name)}</span>
      <span style="color:var(--text-muted);font-size:.68rem;margin-left:auto">${g.players.length} joueur${g.players.length>1?'s':''}</span>
    </div>`).join('');
}

function showGameRanking(gameName) {
  const rankings = window._gameRankings || [];
  const g = rankings.find(r => r.game_name === gameName);
  const input = document.getElementById('gameRankingSearch');
  const sugg = document.getElementById('gameRankingSugg');
  const result = document.getElementById('gameRankingResult');
  if (!g || !result) return;
  if (input) input.value = g.game_name;
  if (sugg) sugg.style.display = 'none';
  result.innerHTML = `
    <div class="stats-game-ranking">
      <div class="stats-game-ranking-header">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0">` : '<div style="width:36px;height:36px;border-radius:6px;background:var(--surface2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🎲</div>'}
        <span class="stats-game-name" style="font-size:1rem">${esc(g.game_name)}</span>
      </div>
      <table class="stats-table" style="margin-top:8px">
        <thead><tr><th>#</th><th>Joueur</th><th>Meilleur</th><th>Moyenne</th><th>Parties</th><th>Victoires</th></tr></thead>
        <tbody>
          ${g.players.map((p,i) => `<tr class="${i===0?'stats-row-gold':i===1?'stats-row-silver':i===2?'stats-row-bronze':''}">
            <td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
            <td><strong>${esc(p.name)}</strong></td>
            <td>${p.best}</td>
            <td>${p.avg}</td>
            <td>${p.nb_parties}</td>
            <td>${p.wins > 0 ? '🏆×'+p.wins : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
// EDIT SESSION
// ═══════════════════════════════════════════════════
function openEditSession() {
  // Formulaire inline sous la barre de gestion — évite les bugs de modal sur Android
  const existing = document.getElementById('inlineEditForm');
  if (existing) { existing.remove(); return; } // toggle

  const form = document.createElement('div');
  form.id = 'inlineEditForm';
  form.style.cssText = 'background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:14px;margin:8px 0 12px;display:flex;flex-direction:column;gap:8px;';
  form.innerHTML = `
    <div style="font-size:.72rem;font-weight:600;color:var(--accent);margin-bottom:2px">✏️ Modifier la séance</div>
    <textarea class="form-input" id="inlineEditName" rows="2"
      placeholder="Nom de la séance"
      style="font-size:16px;resize:none;overflow:auto;white-space:pre-wrap;word-break:break-word;"
    >${esc(currentSession.session.name)}</textarea>
    <input type="date" class="form-input" id="inlineEditDate" value="${currentSession.session.date}" style="font-size:16px">
    <div style="display:flex;gap:8px">
      <button class="btn-sm ghost" onclick="document.getElementById('inlineEditForm').remove()">Annuler</button>
      <button class="btn-sm accent" onclick="saveEditSession()">Enregistrer</button>
    </div>
  `;

  // Insérer sous la barre de gestion
  const mgmt = document.getElementById('sessMgmt');
  mgmt.parentNode.insertBefore(form, mgmt.nextSibling);

  // Focus immédiat
  setTimeout(() => {
    const input = document.getElementById('inlineEditName');
    if (input) { input.focus(); input.select(); }
  }, 50);
}

async function saveEditSession() {
  const name = document.getElementById('inlineEditName')?.value.trim();
  const date = document.getElementById('inlineEditDate')?.value;
  if (!name || !date) { showToast('Nom et date requis'); return; }
  const res = await api('PATCH', `/api/sessions/${currentSession.session.id}`, { name, date });
  if (res.error) { showToast(res.error); return; }
  document.getElementById('inlineEditForm')?.remove();
  await reloadSession();
  showToast('Séance mise à jour !');
}

// ═══════════════════════════════════════════════════
// PRIVATE SESSION MEMBERS
// ═══════════════════════════════════════════════════
async function openPrivateMembersModal() {
  // Charger tous les users et les membres actuels
  const [usersRes, members] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', `/api/sessions/${currentSession.session.id}/private-members`)
  ]);
  const users = usersRes.users || usersRes;
  const memberIds = new Set(members.map(m => m.id));
  const creatorId = currentSession.session.created_by;
  const container = document.getElementById('privateMembersList');
  container.innerHTML = users.filter(u => u.id !== creatorId).map(u =>
    `<label class="priv-member-item">
      <input type="checkbox" value="${u.id}" class="priv-edit-cb" ${memberIds.has(u.id) ? 'checked' : ''}>
      ${esc(u.username)}
    </label>`
  ).join('');
  openModal('privateMembersModal');
}

async function savePrivateMembers() {
  const ids = [...document.querySelectorAll('.priv-edit-cb:checked')].map(cb => parseInt(cb.value));
  // Toujours inclure le créateur
  ids.push(currentSession.session.created_by);
  await api('PUT', `/api/sessions/${currentSession.session.id}/private-members`, { user_ids: ids });
  closeModal('privateMembersModal');
  showToast('Membres mis à jour !');
}

// ═══════════════════════════════════════════════════
