// ─────────────────────────────────────────────────────────────
// programme.js — Panel "Programme" : planning de la journée
//
// Contient :
//   - renderProgrammePanel()     Affiche le programme avec ses créneaux
//   - addSlot() / deleteSlot()   Ajoute/supprime un créneau manuellement
//   - generateProgramme()        Lance la génération IA via POST /api/programme/generate
//   - validateProgramme()        Publie le programme (visible par tous)
//   - renderSlotCard(slot)       Construit le HTML d'un créneau
//   - slotGameSearch()           Autocomplete jeux dans un créneau
//   - buildPlayersSelector()     Sélecteur de joueurs pour un créneau
//   - estimateDuration()         Estime la durée d'un créneau via IA
// ─────────────────────────────────────────────────────────────

// PROGRAMME IA
// ═══════════════════════════════════════════════════

// Programme slots en mémoire
let programmeSlots = [];
let progLoaded = false;
let conventionBookings = []; // réservations en mode convention

async function renderProgrammePanel() {
  // Mode convention — vue organisateur avec joueurs par table
  if (currentSession.session.is_convention) {
    await renderConventionProgramme();
    return;
  }

  // Charger tous les users si pas encore fait
  if (!window._allUsers) {
    const r = await api('GET', '/api/users');
    window._allUsers = r.users || r || [];
  }
  const el = document.getElementById('panel-programme');
  const hasVotes = currentSession.rankings.length > 0;
  const hasProposals = currentSession.proposals.length > 0;
  const canManage = currentSession.session.created_by === currentUser.id || currentUser.is_admin;

  const nbParticipants = currentSession.participants.length;
  const totalGames = currentSession.proposals.length;

  // Afficher un avertissement si pas encore de votes/propositions, mais laisser accès au programme
  const warnings = [];
  if (!hasProposals) warnings.push('Aucun jeu proposé encore.');
  if (hasProposals && !hasVotes) warnings.push("Personne n'a encore voté.");

  el.innerHTML = `
    <div class="prog-card">
      <div class="prog-card-header">
        <div class="prog-card-title">📋 Programme de la journée</div>
        ${currentSession.session.programme_validated ? `<a class="btn-sm accent" href="/programme/${currentSession.session.id}" target="_blank" style="text-decoration:none">🔗 Page publique</a>` : ''}
      </div>
      <div class="prog-card-body">
        ${warnings.length ? `<div class="prog-warn">${warnings.join(' ')} Vous pouvez quand même créer le programme manuellement.</div>` : ''}
        ${hasProposals ? `
        <div class="prog-participants">
          <strong>${nbParticipants} participant${nbParticipants > 1 ? 's' : ''}</strong> ·
          <strong>${totalGames} jeu${totalGames > 1 ? 'x' : ''}</strong> proposés
        </div>` : ''}
        ${hasVotes ? `
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn-sm ghost" style="flex:1" onclick="openRankingsPopup()">
            📊 Par joueur
          </button>
          <button class="btn-sm ghost" style="flex:1" onclick="openRankingsByGame()">
            🎲 Par jeu
          </button>
        </div>` : ''}

        <details class="prog-ai-section ai-feature">
          <summary>✨ Générer avec l'IA</summary>
          <div class="prog-ai-body">
            <div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:10px">
              <button class="btn-sm" id="progModeGuided" onclick="setProgMode('guided')" style="background:var(--accent);color:var(--bg)">⚙️ Mode guidé</button>
              <button class="btn-sm ghost" id="progModeFree" onclick="setProgMode('free')">✍️ Mode libre</button>
            </div>
            <div id="progGuidedForm">
              <div class="prog-options">
                <div class="prog-option">
                  <label>Heure de début</label>
                  <input type="time" id="progStart" value="10:00">
                </div>
                <div class="prog-option">
                  <label>Heure de fin</label>
                  <input type="time" id="progEnd" value="18:00">
                </div>
                <div class="prog-option">
                  <label>Pause déjeuner</label>
                  <div class="toggle-row">
                    <input type="checkbox" id="progLunch" checked onchange="document.getElementById('progLunchTime').style.display=this.checked?'block':'none'">
                    <span style="font-size:.75rem">Inclure une pause</span>
                  </div>
                  <input type="time" id="progLunchTime" value="12:30" style="margin-top:4px">
                </div>
                <div class="prog-option">
                  <label>Durée pause (min)</label>
                  <input type="number" id="progLunchDur" value="60" min="15" max="120" step="15">
                </div>
                <div class="prog-option">
                  <label>👥 Nombre de joueurs</label>
                  <input type="number" id="progNbPlayers" value="${nbParticipants}" min="2" max="20" step="1">
                </div>
                <div class="prog-option">
                  <label>🎲 Nombre de tables max</label>
                  <input type="number" id="progNbTables" class="form-input" value="2" min="1" max="10" step="1">
                </div>
                <div class="prog-option">
                  <label>🤝 Créneaux tous ensemble</label>
                  <input type="number" id="progNbTogether" value="0" min="0" max="10" step="1" placeholder="0 = pas de contrainte">
                </div>
                <div class="prog-option">
                  <label>⚡ Créneaux en parallèle</label>
                  <input type="number" id="progNbParallel" value="0" min="0" max="10" step="1" placeholder="0 = pas de contrainte">
                </div>
              </div>
              <button class="gen-btn" id="genBtn" onclick="generateProgramme()">
                ✨ Générer le programme avec l'IA
              </button>
              <button class="gen-btn" id="estimBtn" onclick="estimateDuration()" style="background:var(--surface);border:1px solid var(--accent);color:var(--accent);margin-top:8px">
                ⏱ Évaluer la durée de la séance
              </button>
            </div>
            <div id="progFreeForm" style="display:none">
              <div class="form-group">
                <label class="form-label" style="margin-bottom:6px">Décris le programme que tu veux :</label>
                <textarea class="form-input" id="progFreeText" rows="5" style="resize:vertical;font-size:.85rem" placeholder="Ex: Fais-moi un programme de 10h à 18h avec une pause déjeuner. Je veux 2 jeux où on est tous ensemble le matin, puis après-midi avec 3 tables de 3 joueurs. Commence par les jeux les mieux votés."></textarea>
              </div>
              <div class="prog-option" style="margin-bottom:10px">
                <label>👥 Nombre de joueurs</label>
                <input type="number" id="progNbPlayersFree" value="${nbParticipants}" min="2" max="20" step="1">
              </div>
              <button class="gen-btn" id="genBtnFree" onclick="generateProgrammeFree()">
                ✨ Générer le programme avec l'IA
              </button>
            </div>
            <div id="progOutput"></div>
          </div>
        </details>
        <div id="progSlots"></div>
        <div id="progValidateBar" style="margin-top:16px;display:flex;gap:8px;align-items:center"></div>
      </div>
    </div>
  `;

  // Charger les créneaux sauvegardés
  if (!progLoaded) {
    const r = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
    programmeSlots = r.slots || [];
    // Charger les réservations si mode convention
    if (currentSession.session.is_convention) {
      const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
      conventionBookings = br.bookings || [];
    }
    progLoaded = true;
  }
  renderSlots();
  renderValidateBar();
}

function renderValidateBar() {
  const bar = document.getElementById('progValidateBar');
  if (!bar) return;
  const sessOwnerId = currentSession.session.created_by;
  const canPub = canDoAction('programme_publish', sessOwnerId);
  if (!canPub || !programmeSlots.length) { bar.innerHTML = ''; return; }
  const validated = currentSession.session.programme_validated;
  bar.innerHTML = validated
    ? `<span style="color:var(--green-text);font-size:.8rem">✅ Programme publié</span>
       <button class="btn-sm ghost" onclick="validateProgramme(false)">Dépublier</button>`
    : `<button class="btn-sm accent" onclick="validateProgramme(true)">✅ Valider & publier le programme</button>`;
}

async function validateProgramme(publish) {
  const endpoint = publish ? 'validate' : 'unvalidate';
  await api('PATCH', `/api/sessions/${currentSession.session.id}/programme/${endpoint}`);
  currentSession.session.programme_validated = publish ? 1 : 0;
  renderValidateBar();
  showToast(publish ? 'Programme publié !' : 'Programme dépublié');
}

function buildTeacherOptions(players, current) {
  // Toujours proposer tous les participants, peu importe la valeur de players
  const list = [];
  (currentSession && currentSession.participants || []).forEach(function(p) {
    if (!list.includes(p.username)) list.push(p.username);
  });
  // Ajouter aussi les joueurs explicitement listés s'ils ne sont pas participants
  if (players && players.toLowerCase() !== 'tous') {
    players.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!list.includes(name)) list.push(name);
    });
  }
  return list.map(function(name) {
    const sel = current === name ? ' selected' : '';
    return '<option value="' + esc(name) + '"' + sel + '>' + esc(name) + '</option>';
  }).join('');
}

// table = numéro (1, 2, 3...)
function _teacherId(idx, tableNum, type) {
  if (type === 'sel')  return `steacher_${idx}_${tableNum}`;
  if (type === 'free') return `steacher_free_${idx}_${tableNum}`;
  return `steacher_warn_${idx}_${tableNum}`;
}

function _playersInputId(idx, tableNum) {
  return `sp_${idx}_${tableNum}`;
}

function onTeacherChange(idx, tableNum) {
  const sel  = document.getElementById(_teacherId(idx, tableNum, 'sel'));
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  if (free) free.value = '';
  checkTeacherWarning(idx, tableNum, sel?.value || '');
  checkTeacherConflictsLive(idx);
}

function onTeacherFreeInput(idx, tableNum) {
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  checkTeacherWarning(idx, tableNum, free?.value || '');
  checkTeacherConflictsLive(idx);
}

function getTeacherValue(idx, tableNum) {
  const free = document.getElementById(_teacherId(idx, tableNum, 'free'));
  if (free?.value.trim()) return free.value.trim();
  return document.getElementById(_teacherId(idx, tableNum, 'sel'))?.value || '';
}

function checkTeacherWarning(idx, tableNum, teacher) {
  const warn = document.getElementById(_teacherId(idx, tableNum, 'warn'));
  if (!warn || !teacher) { if (warn) warn.style.display = 'none'; return; }
  const playersInput = document.getElementById(_playersInputId(idx, tableNum));
  const players = playersInput?.value || '';
  if (players && players.toLowerCase() !== 'tous') {
    const list = players.split(',').map(s => s.trim().toLowerCase());
    if (!list.includes(teacher.toLowerCase())) {
      warn.textContent = `⚠ ${teacher} n'est pas dans les joueurs de cette table`;
      warn.style.display = 'block'; return;
    }
  }
  warn.style.display = 'none';
}

function checkTeacherConflictsLive(editIdx) {
  const slot = programmeSlots[editIdx];
  const teachers = (slot.tables || []).map(t => getTeacherValue(editIdx, t.table_number)).filter(Boolean);
  const seen = new Set();
  for (const t of teachers) {
    const key = t.toLowerCase();
    const warnId = `steacher_warn_${editIdx}_${(slot.tables || []).find(x => getTeacherValue(editIdx, x.table_number)?.toLowerCase() === key)?.table_number}`;
    const warnEl = document.getElementById(warnId);
    if (seen.has(key)) {
      if (warnEl) { warnEl.textContent = '⚠ Même teacher pour plusieurs tables !'; warnEl.style.display = 'block'; }
    }
    seen.add(key);
  }
}

function checkTeacherConflicts(editIdx) {
  const conflicts = [];
  const slot = programmeSlots[editIdx];
  const teachers = (slot.tables || []).map(t => t.teacher).filter(Boolean);

  // Conflits internes au créneau
  const seen = new Set();
  for (const t of teachers) {
    const key = t.toLowerCase();
    if (seen.has(key)) conflicts.push(`${t} ne peut pas enseigner plusieurs tables en même temps`);
    seen.add(key);
  }

  // Vérifier contre les autres créneaux simultanés
  const startTime = document.getElementById(`st_${editIdx}`)?.value || '';
  if (startTime) {
    programmeSlots.forEach((s, i) => {
      if (i === editIdx || s.is_break) return;
      if (s.start_time === startTime) {
        const others = (s.tables || []).map(t => t.teacher).filter(Boolean);
        teachers.forEach(t => {
          if (others.some(o => o.toLowerCase() === t.toLowerCase())) {
            conflicts.push(`${t} enseigne déjà à ${startTime} (autre créneau)`);
          }
        });
      }
    });
  }
  return [...new Set(conflicts)];
}

async function estimateSlotDuration(idx, tableNum) {
  const gameInput = document.getElementById(`sn_${idx}_${tableNum}`);
  const durInput  = document.getElementById(`sde_${idx}_${tableNum}`);
  const btn = document.querySelector(`[onclick="estimateSlotDuration(${idx},${tableNum})"]`);
  const gameName = gameInput?.value?.trim();
  if (!gameName) { showToast("Renseigne d'abord le nom du jeu"); return; }
  const nbPlayers = currentSession.participants?.length || 4;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const res = await api('POST', '/api/programme/estimate-slot', { gameName, nbPlayers });
  if (btn) { btn.textContent = '✨'; btn.disabled = false; }
  if (res.unknown || !res.duration) { showToast('Jeu inconnu de Claude'); return; }
  if (durInput) durInput.value = res.duration;
  showToast(`Durée estimée : ${res.duration}min pour ${nbPlayers} joueurs`);
}

function setProgMode(mode) {
  const guided = document.getElementById('progGuidedForm');
  const free = document.getElementById('progFreeForm');
  const btnG = document.getElementById('progModeGuided');
  const btnF = document.getElementById('progModeFree');
  if (mode === 'guided') {
    guided.style.display = ''; free.style.display = 'none';
    btnG.style.background = 'var(--accent)'; btnG.style.color = 'var(--bg)'; btnG.className = 'btn-sm';
    btnF.style.background = ''; btnF.style.color = ''; btnF.className = 'btn-sm ghost';
  } else {
    guided.style.display = 'none'; free.style.display = '';
    btnF.style.background = 'var(--accent)'; btnF.style.color = 'var(--bg)'; btnF.className = 'btn-sm';
    btnG.style.background = ''; btnG.style.color = ''; btnG.className = 'btn-sm ghost';
  }
}

async function generateProgrammeFree() {
  const btn = document.getElementById('genBtnFree');
  const output = document.getElementById('progOutput');
  const freeText = document.getElementById('progFreeText')?.value.trim();
  const nbPlayers = parseInt(document.getElementById('progNbPlayersFree')?.value) || currentSession.participants?.length || 4;

  if (!freeText) { showToast('Décris le programme souhaité avant de générer'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Génération…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude réfléchit…</span></div>`;

  const res = await api('POST', '/api/programme/generate', {
    sessionId: currentSession.session.id,
    freeText,
    nbPlayers,
    mode: 'free'
  });

  btn.disabled = false;
  btn.textContent = '✨ Générer le programme avec l\'IA';
  output.innerHTML = '';

  if (res.error) {
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">🔑 <strong>Clé API Anthropic non configurée</strong><br><span style="font-size:.8rem">${esc(res.message)}</span></div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }

  // Dépublier le programme existant si publié
  if (currentSession.session.programme_validated) {
    await api('PATCH', `/api/sessions/${currentSession.session.id}/programme/unvalidate`);
    currentSession.session.programme_validated = 0;
  }

  programmeSlots = res.slots || [];
  progLoaded = true;

  if (res.unscheduled?.length) {
    output.innerHTML = `<div class="prog-warn">⚠ Jeux non planifiés faute de temps : ${res.unscheduled.map(g => `<strong>${esc(g)}</strong>`).join(', ')}</div>`;
  }
  renderSlots();
  renderValidateBar();
}

async function generateProgramme() {
  const btn = document.getElementById('genBtn');
  const output = document.getElementById('progOutput');
  const nbParticipants = currentSession.participants?.length || 4;

  const startTime = document.getElementById('progStart').value;
  const endTime = document.getElementById('progEnd').value;
  const hasLunch = document.getElementById('progLunch').checked;
  const lunchTime = document.getElementById('progLunchTime').value;
  const lunchDur = document.getElementById('progLunchDur').value;

  btn.disabled = true;
  btn.textContent = '⏳ Génération…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude réfléchit…</span></div>`;

  const nbPlayers = parseInt(document.getElementById('progNbPlayers')?.value) || nbParticipants;
  const nbTables = parseInt(document.getElementById('progNbTables')?.value) || 2;
  const nbTogether = parseInt(document.getElementById('progNbTogether')?.value) || 0;
  const nbParallel = parseInt(document.getElementById('progNbParallel')?.value) || 0;

  // Enregistrer le listener SSE avant d'envoyer la requête
  window._pendingProgrammeGeneration = true;

  const res = await api('POST', '/api/programme/generate', {
    sessionId: currentSession.session.id,
    startTime, endTime, hasLunch, lunchTime,
    lunchDurationMinutes: parseInt(lunchDur),
    nbPlayers, nbTables, nbTogether, nbParallel
  });

  // Si erreur immédiate (clé manquante, session introuvable, etc.)
  if (res.error) {
    window._pendingProgrammeGeneration = false;
    btn.disabled = false;
    btn.textContent = '✨ Générer avec l\'IA';
    output.innerHTML = '';
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">
        🔑 <strong>Clé API Anthropic non configurée</strong><br>
        <span style="font-size:.8rem">${esc(res.message)}</span>
      </div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }

  // res.pending === true : la génération tourne en arrière-plan
  // Le résultat arrivera via SSE événement 'programme.generated'
  // (géré dans app.js → initSSE)
}

function _onProgrammeGenerated(data) {
  const btn = document.getElementById('genBtn');
  const output = document.getElementById('progOutput');
  window._pendingProgrammeGeneration = false;

  if (btn) { btn.disabled = false; btn.textContent = '✨ Générer avec l\'IA'; }
  if (output) output.innerHTML = '';

  if (data.error) {
    if (output) output.innerHTML = `<div class="prog-err">⚠ ${esc(data.error)}</div>`;
    return;
  }

  // Dépublier si nécessaire
  if (currentSession.session.programme_validated) {
    api('PATCH', `/api/sessions/${currentSession.session.id}/programme/unvalidate`);
    currentSession.session.programme_validated = 0;
  }

  programmeSlots = data.slots || [];
  progLoaded = true;

  if (data.unscheduled?.length) {
    if (output) output.innerHTML = `<div class="prog-unscheduled">⚠ Jeux non planifiés : ${data.unscheduled.map(esc).join(', ')}</div>`;
  }

  renderSlots();
  renderValidateBar();
}

function renderSlots() {
  const container = document.getElementById('progSlots');
  if (!container) return;

  if (!programmeSlots.length) {
    container.innerHTML = `
      <div class="prog-result">
        <div class="prog-result-header">
          <div class="prog-result-title">📋 Programme</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="prog-regen btn-sm ghost" onclick="addSlot()">+ Créneau</button>
          </div>
        </div>
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:.8rem">
          Aucun créneau — cliquez "+ Créneau" pour créer le programme manuellement
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="prog-result">
      <div class="prog-result-header">
        <div class="prog-result-title">📋 Programme</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="prog-regen btn-sm ghost" onclick="addSlot()">+ Créneau</button>
        </div>
      </div>
      <div id="slotList"></div>
    </div>
  `;

  const list = document.getElementById('slotList');
  programmeSlots.forEach((s, i) => {
    list.appendChild(makeSlotCard(s, i));
  });
  initSlotDragDrop(list);
}

function initSlotDragDrop(list) {
  let dragSrc = null;

  list.addEventListener('dragstart', e => {
    const card = e.target.closest('.slot-card');
    if (!card) return;
    dragSrc = card;
    card.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', e => {
    const card = e.target.closest('.slot-card');
    if (card) card.style.opacity = '';
    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));
    dragSrc = null;
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.slot-card');
    if (!card || card === dragSrc) return;
    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    const card = e.target.closest('.slot-card');
    if (!card || card === dragSrc || !dragSrc) return;

    const cards = [...list.querySelectorAll('.slot-card')];
    const fromIdx = cards.indexOf(dragSrc);
    const toIdx = cards.indexOf(card);
    if (fromIdx === -1 || toIdx === -1) return;

    // Réordonner programmeSlots
    const [moved] = programmeSlots.splice(fromIdx, 1);
    programmeSlots.splice(toIdx, 0, moved);

    list.querySelectorAll('.slot-card').forEach(c => c.classList.remove('drag-over'));

    // Recalculer les horaires et afficher immédiatement
    recalcSlotTimes();
    renderSlots();

    // Sauvegarder en arrière-plan
    const reorder = programmeSlots.map((s, i) => ({ id: s.id, sort_order: i })).filter(s => s.id);
    if (reorder.length) api('PATCH', '/api/programme/reorder', { slots: reorder });
    for (const s of programmeSlots) {
      if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, s);
    }
  });
}

function makeSlotCard(slot, idx) {
  const div = document.createElement('div');
  div.className = 'slot-card' + (slot.is_break ? ' slot-break' : '');
  div.dataset.id = slot.id;
  div.draggable = true;

  const tables = slot.tables || [];
  const multiTable = tables.length > 1;

  // Index BGG rating et tuto_url depuis les propositions
  const ratingIndex = {};
  const tutoIndex = {};
  (currentSession?.proposals || []).forEach(p => {
    if (p.bgg_rating) ratingIndex[p.name.toLowerCase()] = p.bgg_rating;
    if (p.tuto_url)   tutoIndex[p.name.toLowerCase()] = p.tuto_url;
  });

  function tableViewHtml(t) {
    const rating = t.game_name ? ratingIndex[t.game_name.toLowerCase()] : null;
    const tutoUrl = t.game_name ? tutoIndex[t.game_name.toLowerCase()] : null;
    return `<div class="slot-table-block${multiTable ? ' slot-table-boxed' : ''}" style="display:flex;gap:8px;align-items:flex-start">
      ${t.thumbnail ? `<img src="${esc(t.thumbnail)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        ${multiTable ? `<div class="table-badge">Table ${t.table_number}</div>` : ''}
        <div class="slot-name">${esc(t.game_name)}${rating ? ` <span style="font-size:.65rem;color:var(--accent);font-weight:700">⭐${rating}</span>` : ''}</div>
        <div class="slot-meta">${t.duration_est ? t.duration_est+'min · ' : ''}${esc(t.players)}${t.teacher ? ' · 🎓 '+esc(t.teacher) : ''}</div>
        ${tutoUrl ? `<a href="${esc(tutoUrl)}" target="_blank" rel="noopener" style="font-size:.68rem;color:var(--accent)">🎬 Vidéo tuto</a>` : ''}
        ${currentSession?.session?.is_convention && !slot.is_break ? (() => {
          const tableBookings = conventionBookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
          const myBooking = tableBookings.find(b => b.user_id === currentUser?.id);
          const mySlotBooking = conventionBookings.find(b => b.slot_id === slot.id && b.user_id === currentUser?.id);
          const isFull = t.max_players && tableBookings.length >= t.max_players;
          const count = `${tableBookings.length}${t.max_players ? '/'+t.max_players : ''} joueur${tableBookings.length !== 1 ? 's' : ''}`;
          const minInfo = t.min_players ? ` (min ${t.min_players})` : '';
          if (myBooking) {
            return `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:.72rem;color:var(--green,#4caf50)">✅ Tu es inscrit — ${count}</span>
              <button class="btn-sm ghost" style="font-size:.68rem;padding:2px 8px" onclick="cancelBooking(${slot.id})">Annuler</button>
            </div>`;
          }
          if (mySlotBooking) {
            return `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">⛔ Tu joues déjà sur ce créneau — ${count}</div>`;
          }
          if (isFull) {
            return `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">🔒 Complet — ${count}</div>`;
          }
          return `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:.72rem;color:var(--text-muted)">${count}${minInfo}</span>
            <button class="btn-sm accent" style="font-size:.68rem;padding:2px 8px" onclick="bookTable(${slot.id},${t.id})">Réserver</button>
          </div>`;
        })() : ''}
      </div>
    </div>`;
  }

  const tablesViewHtml = slot.is_break
    ? `<div class="slot-name">☕ ${esc(tables[0]?.game_name || slot.note || 'Pause')}</div>`
    : `<div class="slot-tables">${tables.map(t => tableViewHtml(t)).join('')}</div>`;

  // Formulaire d'édition — une section par table
  const tablesEditHtml = tables.map((t, ti) => makeTableEditBlock(ti, t, slot, idx)).join('');

  div.innerHTML = `
    <div class="slot-view">
      <div class="slot-drag-handle" title="Déplacer">⠿</div>
      <div class="slot-time">${esc(slot.start_time)}</div>
      <div class="slot-info" style="flex:1">
        ${tablesViewHtml}
        ${slot.note ? `<div class="slot-note">💬 ${esc(slot.note)}</div>` : ''}
      </div>
      <div class="slot-actions">
        <button class="prop-edit slot-toggle-btn" id="stoggle_${idx}" onclick="toggleSlotEdit(${idx})" title="Modifier">▸</button>
        <button class="prop-del" onclick="deleteSlot(${idx})">✕</button>
      </div>
    </div>
    <div class="slot-edit-form" id="sedit_${idx}" style="display:none">
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label">⏰ Heure</label>
        <input type="time" class="form-input" id="st_${idx}" value="${esc(slot.start_time)}" style="max-width:120px" onchange="cascadeTimeFrom(${idx}, this.value)">
      </div>
      <div id="stablesEdit_${idx}">${tablesEditHtml}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn-sm ghost" onclick="addTableToSlot(${idx})">+ Ajouter une table</button>
        ${tables.length > 1 ? `<button class="btn-sm ghost" onclick="removeTableFromSlot(${idx})">− Retirer dernière table</button>` : ''}
      </div>
      <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="sno_${idx}" value="${esc(slot.note)}" placeholder="Conseil, remarque…"></div>
      <div class="form-group"><label class="form-label"><input type="checkbox" id="sb_${idx}" ${slot.is_break ? 'checked' : ''}> Pause (déjeuner, café…)</label></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-sm ghost" onclick="cancelEditSlot(${idx})">Annuler</button>
        <button class="btn-sm accent" onclick="saveSlot(${idx})">Enregistrer</button>
        ${idx > 0 ? `<button class="btn-sm ghost" onclick="moveSlot(${idx},-1)">↑</button>` : ''}
        ${idx < programmeSlots.length-1 ? `<button class="btn-sm ghost" onclick="moveSlot(${idx},1)">↓</button>` : ''}
      </div>
    </div>
  `;
  return div;
}

function makeTableEditBlock(tableIndex, table, slot, idx) {
  const tn = table.table_number;
  const gameName  = table.game_name  || '';
  const players   = table.players    || '';
  const teacher   = table.teacher    || '';
  const durEst    = table.duration_est;
  const gameId    = `sn_${idx}_${tn}`;
  const nbId      = `snj_${idx}_${tn}`;
  const durId     = `sde_${idx}_${tn}`;
  const wrapId    = `spwrap_${idx}_${tn}`;
  const teachSelId  = `steacher_${idx}_${tn}`;
  const teachFreeId = `steacher_free_${idx}_${tn}`;
  const teachWarnId = `steacher_warn_${idx}_${tn}`;
  const browserId   = `sgBrowser_${idx}_${tn}`;
  const searchResultId = `sgResults_${idx}_${tn}`;
  const participants = currentSession?.participants || [];

  const tabsHtml =
    `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',0,'${browserId}',this)">🗳 Votés</button>` +
    participants.map(u =>
      `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',${u.id},'${browserId}',this)">${esc(u.username)}</button>`
    ).join('') +
    `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',-1,'${browserId}',this)">🔍 BGG</button>`;

  const tutoUrl = (() => {
    const p = (currentSession?.proposals || []).find(x => x.name === gameName);
    return p?.tuto_url || '';
  })();

  return `<div data-table-block="${tn}" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px">
    <div class="form-label" style="margin-bottom:8px;color:var(--accent)">Table ${tn}${tn > 1 ? ' <span style="font-weight:normal;font-size:.7rem">(parallèle)</span>' : ''}</div>
    <div class="slot-edit-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Jeu sélectionné</label>
        <input class="form-input" id="${gameId}" value="${esc(gameName)}" placeholder="(rechercher ci-dessous)" style="background:var(--surface2)" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">Durée estimée</label>
        <div style="display:flex;gap:4px;align-items:center">
          <input class="form-input" type="number" id="${durId}" value="${durEst ?? ''}" style="max-width:75px" placeholder="min">
          <button class="btn-sm ghost" style="padding:4px 7px;font-size:.7rem" title="Estimer avec l'IA" onclick="estimateSlotDuration(${idx},${tn})">✨</button>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">🔍 Ajouter un jeu</label>
      <div class="collection-tabs" style="margin-bottom:6px">${tabsHtml}</div>
      <div id="${browserId}">
        <div style="font-size:.72rem;color:var(--text-muted);padding:4px">Clique sur un joueur pour voir sa collection, ou 🔍 BGG pour chercher.</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Joueurs</label>
      <div class="slot-players-wrap" id="${wrapId}">
        ${buildPlayersSelector(players, idx, tn)}
      </div>
    </div>
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">🎓 Teacher</label>
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" id="${teachSelId}" onchange="onTeacherChange(${idx},${tn})" style="flex:1">
          <option value="">Pas de teach (jeu connu)</option>
          ${buildTeacherOptions(players, teacher)}
        </select>
        <input class="form-input" id="${teachFreeId}" value="${esc(teacher)}" placeholder="Saisie libre…" style="max-width:140px"
          oninput="document.getElementById('${teachSelId}').value=''; onTeacherFreeInput(${idx},${tn})">
      </div>
      <div id="${teachWarnId}" style="font-size:.72rem;color:#e07070;margin-top:3px;display:none"></div>
    </div>
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">🎬 Vidéo tuto (URL)</label>
      <input class="form-input" id="stuto_${idx}_${tn}" value="${esc(tutoUrl)}" placeholder="youtube.com/watch?v=…" style="font-size:.8rem">
    </div>
    ${currentSession?.session?.is_convention ? `
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">👥 Joueurs min / max (convention)</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="form-input" type="number" id="sminp_${idx}_${tn}" value="${esc(String(table.min_players || ''))}" placeholder="min" style="max-width:70px">
        <span style="font-size:.8rem;color:var(--text-muted)">→</span>
        <input class="form-input" type="number" id="smaxp_${idx}_${tn}" value="${esc(String(table.max_players || ''))}" placeholder="max" style="max-width:70px">
      </div>
    </div>` : ''}
  </div>`;
}

function addTableToSlot(idx) {
  const slot = programmeSlots[idx];
  if (!slot.tables) slot.tables = [];
  const newNum = slot.tables.length + 1;
  const newTable = { table_number: newNum, game_name: '', players: '', teacher: '', duration_est: null, thumbnail: '' };
  slot.tables.push(newTable);
  const container = document.getElementById(`stablesEdit_${idx}`);
  if (container) {
    container.insertAdjacentHTML('beforeend', makeTableEditBlock(slot.tables.length - 1, newTable, slot, idx));
  }
  // Rafraîchir les boutons
  renderSlots();
}

function removeTableFromSlot(idx) {
  const slot = programmeSlots[idx];
  if (!slot.tables || slot.tables.length <= 1) return;
  slot.tables.pop();
  renderSlots();
}
function cancelEditSlot(idx) { toggleSlotEdit(idx, false); }
function toggleSlotEdit(idx, forceOpen) {
  const form = document.getElementById(`sedit_${idx}`);
  const btn = document.getElementById(`stoggle_${idx}`);
  if (!form) return;
  const open = forceOpen !== undefined ? forceOpen : form.style.display === 'none';
  form.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? '▾' : '▸';
}

async function saveSlot(idx) {
  const slot = programmeSlots[idx];
  slot.start_time = document.getElementById(`st_${idx}`).value.trim();
  slot.note       = document.getElementById(`sno_${idx}`).value.trim();
  slot.is_break   = document.getElementById(`sb_${idx}`).checked ? 1 : 0;

  // Lire chaque table depuis le DOM
  const tables = (slot.tables || []).map(t => {
    const tn = t.table_number;
    return {
      table_number: tn,
      game_name:    document.getElementById(`sn_${idx}_${tn}`)?.value.trim()   || '',
      players:      getSlotPlayers(idx, tn),
      teacher:      document.getElementById(`steacher_free_${idx}_${tn}`)?.value.trim() || document.getElementById(`steacher_${idx}_${tn}`)?.value || '',
      duration_est: document.getElementById(`sde_${idx}_${tn}`)?.value !== '' ? parseInt(document.getElementById(`sde_${idx}_${tn}`)?.value) || null : null,
      max_players:  document.getElementById(`smaxp_${idx}_${tn}`)?.value ? parseInt(document.getElementById(`smaxp_${idx}_${tn}`)?.value) || null : null,
      min_players:  document.getElementById(`sminp_${idx}_${tn}`)?.value ? parseInt(document.getElementById(`sminp_${idx}_${tn}`)?.value) || null : null,
      thumbnail:    t.thumbnail || '',
    };
  }).filter(t => t.game_name || slot.is_break);
  slot.tables = tables;

  // Vérification conflits
  const conflicts = checkTeacherConflicts(idx);
  if (conflicts.length) {
    if (!confirm('⚠ Conflits détectés :\n' + conflicts.join('\n') + '\n\nSauvegarder quand même ?')) return;
  }

  if (slot.id) {
    await api('PATCH', `/api/programme/slots/${slot.id}`, { ...slot, tables });
  } else {
    const r = await api('POST', '/api/programme/slots', { ...slot, tables, sessionId: currentSession.session.id, sort_order: idx });
    slot.id = r.id;
  }

  // Cascade horaires
  recalcSlotTimesFrom(idx);
  updateSlotView(idx);
  toggleSlotEdit(idx, false);
  for (const s of programmeSlots) {
    if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, { start_time: s.start_time, note: s.note, is_break: s.is_break, sort_order: programmeSlots.indexOf(s), tables: s.tables || [] });
  }

  // Sauvegarder tuto_url dans les proposals
  tables.forEach(t => {
    const tutoUrl = document.getElementById(`stuto_${idx}_${t.table_number}`)?.value.trim() || '';
    if (tutoUrl && t.game_name) {
      const p = currentSession.proposals?.find(x => x.name === t.game_name);
      if (p?.id) api('PATCH', `/api/proposals/${p.id}`, { ...p, tutoUrl });
    }
  });
}
function updateSlotView(idx) {
  const slot = programmeSlots[idx];
  const card = document.querySelector(`.slot-card[data-id="${slot.id}"]`);
  if (!card) return;
  const tables = slot.tables || [];
  const multiTable = tables.length > 1;
  const view = card.querySelector('.slot-view');
  if (!view) return;
  const timeEl = view.querySelector('.slot-time');
  const infoEl = view.querySelector('.slot-info');
  if (timeEl) timeEl.textContent = slot.start_time;
  if (infoEl) infoEl.innerHTML = slot.is_break
    ? `<div class="slot-name">☕ ${esc(tables[0]?.game_name || slot.note || 'Pause')}</div>`
    : `<div class="slot-tables">
        ${tables.map(t => `<div class="slot-table-block${multiTable ? ' slot-table-boxed' : ''}" style="display:flex;gap:8px;align-items:flex-start">
          ${t.thumbnail ? `<img src="${esc(t.thumbnail)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0">
            ${multiTable ? `<div class="table-badge">Table ${t.table_number}</div>` : ''}
            <div class="slot-name">${esc(t.game_name)}</div>
            <div class="slot-meta">${t.duration_est ? t.duration_est+'min · ' : ''}${esc(t.players)}${t.teacher ? ' · 🎓 '+esc(t.teacher) : ''}</div>
          </div>
        </div>`).join('')}
      </div>
      ${slot.note ? `<div class="slot-note">💬 ${esc(slot.note)}</div>` : ''}`;
}

async function deleteSlot(idx) {
  const slot = programmeSlots[idx];
  if (slot.id) await api('DELETE', `/api/programme/slots/${slot.id}`);
  programmeSlots.splice(idx, 1);
  renderSlots();
}

async function moveSlot(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= programmeSlots.length) return;
  [programmeSlots[idx], programmeSlots[newIdx]] = [programmeSlots[newIdx], programmeSlots[idx]];
  // Recalculer et afficher immédiatement
  recalcSlotTimes();
  renderSlots();
  // Sauvegarder en arrière-plan
  const reorder = programmeSlots.map((s, i) => ({ id: s.id, sort_order: i })).filter(s => s.id);
  if (reorder.length) api('PATCH', '/api/programme/reorder', { slots: reorder });
  for (const s of programmeSlots) {
    if (s.id) api('PATCH', `/api/programme/slots/${s.id}`, s);
  }
}

async function bookTable(slotId, tableId) {
  const res = await api('POST', '/api/convention/book', { slotId, tableId });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Réservation enregistrée !');
  const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  conventionBookings = br.bookings || [];
  renderSlots();
}

async function cancelBooking(slotId) {
  if (!confirm('Annuler ta réservation ?')) return;
  await api('DELETE', '/api/convention/book', { slotId });
  showToast('Réservation annulée');
  const br = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  conventionBookings = br.bookings || [];
  renderSlots();
}

function cascadeTimeFrom(idx, newTime) {
  programmeSlots[idx].start_time = newTime;
  recalcSlotTimesFrom(idx);
}

function recalcSlotTimesFrom(fromIdx) {
  let cursor = programmeSlots[fromIdx].start_time;
  if (!cursor) return;
  for (let i = fromIdx; i < programmeSlots.length; i++) {
    const s = programmeSlots[i];
    s.start_time = cursor;
    const card = document.querySelector(`.slot-card[data-id="${s.id}"]`);
    if (card) {
      const timeEl = card.querySelector('.slot-time');
      if (timeEl) timeEl.textContent = cursor;
      const stInput = card.querySelector(`input[id^="st_"]`);
      if (stInput) stInput.value = cursor;
    }
    const slotDur = s.tables?.length
      ? Math.max(...s.tables.map(t => t.duration_est || 60))
      : (s.duration_est || s.duration_min || 60);
    cursor = addMinutes(cursor, slotDur);
  }
}

function recalcSlotTimes() {
  if (!programmeSlots.length) return;
  let cursor = null;
  for (const s of programmeSlots) {
    if (s.start_time && s.start_time.trim()) { cursor = s.start_time; break; }
  }
  if (!cursor) {
    const startInput = document.getElementById('progStart');
    cursor = startInput?.value?.trim() || '10:00';
  }

  for (let i = 0; i < programmeSlots.length; i++) {
    const s = programmeSlots[i];
    s.start_time = cursor;
    const card = document.querySelector(`.slot-card[data-id="${s.id}"]`);
    if (card) {
      const timeEl = card.querySelector('.slot-time');
      if (timeEl) timeEl.textContent = cursor;
      const stInput = card.querySelector(`input[id^="st_"]`);
      if (stInput) stInput.value = cursor;
    }
    const slotDur = s.tables?.length
      ? Math.max(...s.tables.map(t => t.duration_est || 60))
      : (s.duration_est || s.duration_min || 60);
    cursor = addMinutes(cursor, slotDur);
  }
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}

async function addSlot() {
  const newSlot = { start_time: '', game_name: '', duration_min: 60, players: 'tous', note: '', is_break: 0 };
  const r = await api('POST', '/api/programme/slots', { ...newSlot, sessionId: currentSession.session.id, sort_order: programmeSlots.length });
  newSlot.id = r.id;
  programmeSlots.push(newSlot);
  renderSlots();
  // Ouvrir le formulaire du dernier créneau
  setTimeout(() => toggleSlotEdit(programmeSlots.length - 1, true), 50);
}

// ═══════════════════════════════════════════════════
// SLOT GAME AUTOCOMPLETE + PLAYER SELECTOR
// ═══════════════════════════════════════════════════

function getSlotGameList() {
  // Propositions de la séance
  const fromProps = currentSession.proposals.map(p => ({ name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time, source: 'proposé' }));
  // Collections BGG de tous les participants
  const fromColl = [];
  for (const games of Object.values(userCollections)) {
    for (const g of games) {
      if (!fromColl.some(x => x.name.toLowerCase() === g.name.toLowerCase()))
        fromColl.push({ name: g.name, thumbnail: g.thumbnail, min_time: g.min_time, max_time: g.max_time, source: 'collection' });
    }
  }
  // Fusionner sans doublons
  const all = [...fromProps];
  for (const g of fromColl) {
    if (!all.some(x => x.name.toLowerCase() === g.name.toLowerCase())) all.push(g);
  }
  return all.sort((a,b) => a.name.localeCompare(b.name));
}

async function slotCollTab(gameId, resultId, nbId, durId, userId, browserId, btn) {
  // Activer onglet
  const tabs = btn.closest('.collection-tabs');
  if (tabs) tabs.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const browser = document.getElementById(browserId);
  if (!browser) return;

  function pickGame(g) {
    const gameInput = document.getElementById(gameId);
    if (gameInput) { gameInput.value = g.name; gameInput.removeAttribute('readonly'); }
    // Thumbnail caché — dérivé depuis gameId (sn_idx_tn -> sthumb_idx_tn)
    const thumbId = gameId.replace(/^sn_/, 'sthumb_');
    let thumbInput = document.getElementById(thumbId);
    if (!thumbInput) {
      thumbInput = document.createElement('input');
      thumbInput.type = 'hidden'; thumbInput.id = thumbId;
      gameInput?.parentElement?.appendChild(thumbInput);
    }
    thumbInput.value = g.thumbnail || '';
    if (g.min_time && g.min_time !== '0') {
      const durInput = document.getElementById(durId);
      if (durInput && !durInput.value) durInput.value = g.min_time;
    }
    showToast(`✅ ${g.name} sélectionné`);
  }

  function renderGames(games, filter) {
    const filtered = filter ? games.filter(g => g.name.toLowerCase().includes(filter.toLowerCase())) : games;
    if (!filtered.length) return '<div style="padding:8px;font-size:.75rem;color:var(--text-muted)">Aucun jeu</div>';
    return filtered.map(g => {
      const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
      const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
      return `<div class="coll-item slot-coll-item" data-name="${encodeURIComponent(g.name)}">
        ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
        <div class="coll-info"><div class="coll-name">${esc(g.name)}</div><div class="coll-meta">${[players,time, g.bgg_rating && `⭐ ${g.bgg_rating}`].filter(Boolean).join(' · ')}</div></div>
        <button class="coll-add">Choisir</button>
      </div>`;
    }).join('');
  }

  if (userId === 0) {
    // Mode jeux votés — propositions de la séance avec scores Borda
    const proposals = currentSession?.proposals || [];
    const rankings = currentSession?.rankings || [];
    const scores = {};
    proposals.forEach(p => scores[p.id] = 0);
    const rankingsByUser = {};
    rankings.forEach(r => {
      const key = `${r.user_id}_${r.category_id}`;
      if (!rankingsByUser[key]) rankingsByUser[key] = [];
      rankingsByUser[key].push(r);
    });
    Object.values(rankingsByUser).forEach(userRanks => {
      const n = userRanks.length;
      userRanks.forEach(r => { if (scores[r.proposal_id] !== undefined) scores[r.proposal_id] += (n - r.rank + 1); });
    });
    const sorted = [...proposals].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    browser.innerHTML = `<input type="text" class="collection-filter" id="sgVoteFilter_${browserId}" placeholder="Filtrer les jeux votés…" oninput="slotVoteFilter('${browserId}')">
      <div class="collection-list" id="sgVoteList_${browserId}"></div>`;
    browser._games = sorted.map(p => ({
      name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time,
      min_players: p.min_players, max_players: p.max_players, score: scores[p.id] || 0
    }));
    function renderVotedGames(games, filter) {
      const filtered = filter ? games.filter(g => g.name.toLowerCase().includes(filter.toLowerCase())) : games;
      return filtered.map(g => {
        const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
        const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
        return `<div class="coll-item slot-coll-item" data-name="${encodeURIComponent(g.name)}">
          ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
          <div class="coll-info"><div class="coll-name">${esc(g.name)}</div><div class="coll-meta">${[players,time].filter(Boolean).join(' · ')}${g.score ? ` · <span style="color:var(--accent)">${g.score}pts</span>` : ''}</div></div>
          <button class="coll-add">Choisir</button>
        </div>`;
      }).join('');
    }
    browser._renderGames = renderVotedGames;
    document.getElementById(`sgVoteList_${browserId}`).innerHTML = renderVotedGames(browser._games, '');
    browser._pickGame = pickGame;
    browser.addEventListener('click', e => {
      const btn = e.target.closest('.coll-add');
      if (!btn) return;
      const item = btn.closest('.slot-coll-item');
      const name = item?.dataset.name ? decodeURIComponent(item.dataset.name) : undefined;
      const g = (browser._games || []).find(x => x.name === name) || { name };
      browser._pickGame && browser._pickGame(g);
    });
    return;
  }

  if (userId === -1) {
    // Mode BGG
    browser.innerHTML = `
      <div class="bgg-search-row">
        <input type="text" class="collection-filter" id="sgBggInput_${browserId}" placeholder="Rechercher sur BoardGameGeek…" onkeydown="if(event.key==='Enter')slotBggSearch('${browserId}')">
        <button class="bgg-search-btn" onclick="slotBggSearch('${browserId}')">Chercher</button>
      </div>
      <div id="sgBggStatus_${browserId}" style="font-size:.72rem;color:var(--text-muted);padding:4px"></div>
      <div id="sgBggResults_${browserId}" class="collection-list"></div>`;
    // Stocker pickGame pour réutilisation
    browser._pickGame = pickGame;
    return;
  }

  // Mode collection joueur
  let games = userCollections[userId];
  if (!games) {
    browser.innerHTML = '<div style="padding:8px;font-size:.72rem;color:var(--text-muted)">⏳ Chargement…</div>';
    const r = await api('GET', `/api/bgg/collection/${userId}`);
    if (r.games) { userCollections[userId] = r.games; games = r.games; }
    else { browser.innerHTML = '<div style="padding:8px;font-size:.72rem;color:var(--text-muted)">Collection non disponible</div>'; return; }
  }

  browser.innerHTML = `
    <input type="text" class="collection-filter" id="sgFilter_${browserId}" placeholder="Filtrer (${games.length} jeux)…" oninput="slotCollFilter('${browserId}')">
    <div class="collection-list" id="sgList_${browserId}">${renderGames(games, '')}</div>`;
  browser._games = games;
  browser._pickGame = pickGame;
  browser._renderGames = renderGames;

  // Attacher les clics
  browser.addEventListener('click', e => {
    const btn = e.target.closest('.coll-add');
    if (!btn) return;
    const item = btn.closest('.slot-coll-item');
    const name = item?.dataset.name ? decodeURIComponent(item.dataset.name) : undefined;
    const g = (browser._games || []).find(x => x.name === name) ||
              (currentSession?.proposals || []).find(x => x.name === name) || { name };
    browser._pickGame && browser._pickGame(g);
  }, { once: false });
}

function canDoAction(action, ownerId = null) {
  if (!currentUser) return false;
  if (currentUser.is_admin) return true;
  const level = sitePermissions[action] ?? 0;
  if (level === 0) return true;
  if (level === 1) return ownerId != null && currentUser.id === ownerId;
  return false; // level 2 = admin only
}

function slotVoteFilter(browserId) {
  const browser = document.getElementById(browserId);
  const filter = document.getElementById(`sgVoteFilter_${browserId}`)?.value || '';
  const listEl = document.getElementById(`sgVoteList_${browserId}`);
  if (!listEl || !browser._games || !browser._renderGames) return;
  listEl.innerHTML = browser._renderGames(browser._games, filter);
}

function slotCollFilter(browserId) {
  const browser = document.getElementById(browserId);
  const filter = document.getElementById(`sgFilter_${browserId}`)?.value || '';
  const listEl = document.getElementById(`sgList_${browserId}`);
  if (!listEl || !browser._games || !browser._renderGames) return;
  listEl.innerHTML = browser._renderGames(browser._games, filter);
}

async function slotBggSearch(browserId) {
  const browser = document.getElementById(browserId);
  const q = document.getElementById(`sgBggInput_${browserId}`)?.value.trim();
  const statusEl = document.getElementById(`sgBggStatus_${browserId}`);
  const resultsEl = document.getElementById(`sgBggResults_${browserId}`);
  if (!q || !resultsEl) return;
  statusEl.textContent = '⏳ Recherche en cours…';
  resultsEl.innerHTML = '';
  const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
  if (res.error) { statusEl.textContent = '⚠ ' + res.error; return; }
  if (!res.games?.length) { statusEl.textContent = 'Aucun résultat — essayez en anglais'; return; }
  statusEl.textContent = `${res.games.length} résultat(s)`;
  res.games.forEach(g => {
    const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
    const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
    const div = document.createElement('div');
    div.className = 'coll-item slot-coll-item';
    div.dataset.name = g.name;
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info"><div class="coll-name">${esc(g.name)}${g.year ? ` <span style="color:var(--text-muted);font-weight:400">(${g.year})</span>` : ''}</div><div class="coll-meta">${[players,time].filter(Boolean).join(' · ')}</div></div>
      <button class="coll-add">Choisir</button>`;
    div.querySelector('.coll-add').addEventListener('click', () => {
      browser._pickGame && browser._pickGame(g);
    });
    resultsEl.appendChild(div);
  });
}

async function slotGameSearch(gameId, searchId, resultId, nbId, durId) {
  const thumbId = gameId.replace(/^sn_/, 'sthumb_');
  const q = document.getElementById(searchId)?.value.trim() || '';
  const resultEl = document.getElementById(resultId);
  if (!resultEl) return;

  resultEl.innerHTML = '';
  resultEl.style.display = 'block';

  function pickGame(g) {
    const gameInput = document.getElementById(gameId);
    if (gameInput) gameInput.value = g.name;
    // Sauvegarder thumbnail
    let thumbInput = document.getElementById(thumbId);
    if (!thumbInput) {
      thumbInput = document.createElement('input');
      thumbInput.type = 'hidden';
      thumbInput.id = thumbId;
      gameInput?.parentElement?.appendChild(thumbInput);
    }
    thumbInput.value = g.thumbnail || '';
    // Pré-remplir durée
    if (g.min_time && g.min_time !== '0') {
      const durInput = document.getElementById(durId);
      if (durInput && !durInput.value) durInput.value = g.min_time;
    }
    resultEl.style.display = 'none';
    const searchInput = document.getElementById(searchId);
    if (searchInput) searchInput.value = '';
  }

  function addItem(g, badge) {
    const time = g.min_time && g.min_time !== '0'
      ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
    const players = g.min_players && g.max_players
      ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
    const div = document.createElement('div');
    div.className = 'coll-item';
    div.innerHTML = `
      ${g.thumbnail ? `<img class="coll-thumb" src="${g.thumbnail}" alt="" onerror="this.style.display='none'">` : `<div class="coll-thumb-ph">🎲</div>`}
      <div class="coll-info">
        <div class="coll-name">${esc(g.name)}</div>
        <div class="coll-meta">${[players, time].filter(Boolean).join(' · ')}${badge ? ` <span style="color:var(--accent2);font-size:.6rem">${badge}</span>` : ''}</div>
      </div>
      <button class="coll-add">Choisir</button>
    `;
    div.querySelector('.coll-add').addEventListener('click', () => pickGame(g));
    resultEl.appendChild(div);
  }

  function addSection(title, items, badge) {
    if (!items.length) return;
    const header = document.createElement('div');
    header.style.cssText = 'font-size:.65rem;color:var(--text-muted);padding:4px 8px;background:var(--surface2);border-bottom:1px solid var(--border);font-weight:600';
    header.textContent = title;
    resultEl.appendChild(header);
    items.forEach(g => addItem(g, badge));
  }

  // Propositions de la séance
  const proposals = (currentSession?.proposals || [])
    .filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase()))
    .map(p => ({ name: p.name, thumbnail: p.thumbnail, min_time: p.min_time, max_time: p.max_time,
                 min_players: p.min_players, max_players: p.max_players }));
  addSection(`🗳 Propositions (${proposals.length})`, proposals, '');

  // Collections par joueur présent
  const participants = currentSession?.participants || [];
  for (const p of participants) {
    const coll = (userCollections[p.id] || [])
      .filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase()));
    if (coll.length) addSection(`📚 ${p.username} (${coll.length})`, coll, '');
  }

  if (!resultEl.children.length && !q) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px;font-size:.75rem;color:var(--text-muted)';
    empty.textContent = 'Collections non chargées — synchronisez les profils BGG';
    resultEl.appendChild(empty);
  }

  // Recherche BGG si query >= 2 chars
  if (q.length >= 2) {
    const loader = document.createElement('div');
    loader.style.cssText = 'font-size:.72rem;color:var(--text-muted);padding:8px;text-align:center';
    loader.textContent = '🌐 Recherche BGG en cours…';
    resultEl.appendChild(loader);
    try {
      const res = await api('GET', `/api/bgg/search?q=${encodeURIComponent(q)}`);
      if (resultEl.contains(loader)) resultEl.removeChild(loader);
      if (res.games?.length) addSection(`🌐 BGG (${res.games.length})`, res.games, '');
      if (!resultEl.children.length) {
        resultEl.innerHTML = '<div style="padding:8px;font-size:.75rem;color:var(--text-muted)">Aucun résultat</div>';
      }
    } catch(e) { if (resultEl.contains(loader)) resultEl.removeChild(loader); }
  }
}

function buildPlayersSelector(current, idx, tableNum) {
  const useAllSite = sitePermissions['players_scope'] !== 1;
  const allUsers = useAllSite
    ? (allSiteUsers.length ? allSiteUsers : (currentSession.participants || []))
    : (currentSession.participants || []);
  const currentList = current.split(',').map(s => s.trim()).filter(Boolean);
  const isTous = !current || current.toLowerCase() === 'tous';
  const inputId = `sp_${idx}_${tableNum}`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      <label class="priv-member-item">
        <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${tableNum}" value="tous" ${isTous ? 'checked' : ''}
          onchange="onSlotTousChange(this,${idx},${tableNum})"> Tous
      </label>
      ${allUsers.map(p => `
        <label class="priv-member-item">
          <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${tableNum}" value="${esc(p.username)}" ${!isTous && currentList.includes(p.username) ? 'checked' : ''}
            onchange="onSlotPlayerChange(this,${idx},${tableNum})"> ${esc(p.username)}
        </label>`).join('')}
    </div>
    <input class="form-input" id="${inputId}" value="${isTous ? 'tous' : esc(current)}" placeholder="Ou saisie libre…" style="font-size:.75rem"
      oninput="slotPlayerManualInput(this,${idx},${tableNum})">
  `;
}

function onSlotTousChange(cb, idx, tableNum) {
  if (cb.checked) {
    document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`).forEach(c => { if (c.value !== 'tous') c.checked = false; });
    const inp = document.getElementById(`sp_${idx}_${tableNum}`);
    if (inp) inp.value = 'tous';
  }
}

function onSlotPlayerChange(cb, idx, tableNum) {
  const tousCb = [...document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`)].find(c => c.value === 'tous');
  if (tousCb) tousCb.checked = false;
  const checked = [...document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}:checked`)].map(c => c.value).filter(v => v !== 'tous');
  const inp = document.getElementById(`sp_${idx}_${tableNum}`);
  if (inp) inp.value = checked.join(', ');
}

function slotPlayerManualInput(input, idx, tableNum) {
  const vals = input.value.split(',').map(s => s.trim().toLowerCase());
  const isTous = vals.includes('tous') || vals.join('') === '';
  document.querySelectorAll(`.slot-player-cb-${idx}-${tableNum}`).forEach(cb => {
    if (cb.value === 'tous') cb.checked = isTous;
    else cb.checked = !isTous && vals.includes(cb.value.toLowerCase());
  });
}

function getSlotPlayers(idx, tableNum) {
  const inp = document.getElementById(`sp_${idx}_${tableNum}`);
  return inp?.value?.trim() || 'tous';
}

// ═══════════════════════════════════════════════════
// ESTIMATE DURATION
// ═══════════════════════════════════════════════════
async function estimateDuration() {
  const btn = document.getElementById('estimBtn');
  const output = document.getElementById('progOutput');
  const startTime = document.getElementById('progStart').value;
  const endTime = document.getElementById('progEnd').value;
  const hasLunch = document.getElementById('progLunch').checked;
  const lunchDur = parseInt(document.getElementById('progLunchDur').value) || 60;
  const nbPlayers = parseInt(document.getElementById('progNbPlayers')?.value) || currentSession.participants?.length || 4;

  btn.disabled = true;
  btn.textContent = '⏳ Analyse…';
  output.innerHTML = `<div class="prog-loading"><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><div class="prog-loading-dot"></div><span>Claude évalue la durée…</span></div>`;

  const res = await api('POST', '/api/programme/estimate', {
    sessionId: currentSession.session.id,
    startTime, endTime, hasLunch, lunchDurationMinutes: lunchDur, nbPlayers
  });

  btn.disabled = false;
  btn.textContent = '⏱ Évaluer la durée de la séance';

  if (res.error) {
    if (res.error === 'CLÉ_MANQUANTE') {
      output.innerHTML = `<div class="prog-err">🔑 <strong>Clé API Anthropic non configurée</strong><br><span style="font-size:.8rem">${esc(res.message)}</span></div>`;
    } else {
      output.innerHTML = `<div class="prog-err">⚠ ${esc(res.error)}</div>`;
    }
    return;
  }
  output.innerHTML = `<div class="prog-estimate">${res.html}</div>`;
}

// ═══════════════════════════════════════════════════

// ── VUE PROGRAMME CONVENTION (organisateur) ──────────────────

async function renderConventionProgramme() {
  const el = document.getElementById('panel-programme');
  if (!el) return;

  el.innerHTML = `<div style="padding:16px 20px">
    <div style="font-family:var(--font-serif,'Fraunces',serif);font-size:1.1rem;font-weight:700;margin-bottom:16px">📋 Programme — Vue organisateur</div>
    <div id="convProgContent"><div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Chargement…</div></div>
  </div>`;

  await _loadConventionProgramme();
}

async function _loadConventionProgramme() {
  const content = document.getElementById('convProgContent');
  if (!content) return;

  const [progRes, bookRes] = await Promise.all([
    api('GET', `/api/sessions/${currentSession.session.id}/programme`),
    api('GET', `/api/sessions/${currentSession.session.id}/bookings`)
  ]);

  const slots = progRes.slots || [];
  const bookings = bookRes.bookings || [];

  if (!slots.length) {
    content.innerHTML = '<div class="empty"><span class="empty-icon">🎲</span><div class="empty-label">Aucun jeu — ajoutez des jeux depuis l\'onglet Convention</div></div>';
    return;
  }

  // Grouper par jeu → tables → créneaux
  const byGame = {};
  for (const slot of slots) {
    if (slot.is_break) continue;
    for (const t of (slot.tables || [])) {
      if (!t.game_name) continue;
      if (!byGame[t.game_name]) byGame[t.game_name] = { game_name: t.game_name, thumbnail: t.thumbnail, byTable: {} };
      const key = t.table_number;
      if (!byGame[t.game_name].byTable[key]) byGame[t.game_name].byTable[key] = [];
      const tableBookings = bookings.filter(b => b.slot_id === slot.id && b.table_number === t.table_number);
      byGame[t.game_name].byTable[key].push({ slot, table: t, tableBookings });
    }
  }

  content.innerHTML = Object.values(byGame).map(g => {
    const allEntries = Object.values(g.byTable).flat();
    const totalPlayers = allEntries.reduce((sum, e) => sum + e.tableBookings.length, 0);
    const gameId = `cprog_${g.game_name.replace(/\W/g,'_')}`;

    const tablesHtml = Object.entries(g.byTable).map(([tableNum, entries]) => {
      const tableId = `${gameId}_t${tableNum}`;

      const slotsHtml = entries.map(e => {
        const players = e.tableBookings;
        const count = `${players.length}${e.table.max_players ? '/'+e.table.max_players : ''} joueur${players.length !== 1 ? 's' : ''}`;
        const playersHtml = players.length
          ? players.map(b => `
            <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:2px 8px;font-size:.72rem;margin:2px">
              ${esc(b.username)}
              <button class="btn-icon" style="font-size:.6rem;padding:0 2px" title="Déplacer" onclick="openMovePlayer(${b.user_id},'${esc(b.username)}',${e.slot.id},${e.table.id},'${esc(g.game_name)}',${tableNum})">↕</button>
            </span>`).join('')
          : `<span style="font-size:.72rem;color:var(--text-muted);font-style:italic">Aucun joueur inscrit</span>`;

        return `<div style="padding:10px 14px 10px 24px;border-top:1px solid var(--border);background:var(--surface)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div>
              ${e.slot.start_time ? `<span style="color:var(--accent);font-weight:600;font-size:.8rem">${esc(e.slot.start_time)} · </span>` : ''}
              <span style="font-size:.78rem;color:var(--text-muted)">${count}</span>
            </div>
            <button class="btn-sm ghost" style="font-size:.65rem" onclick="addPlayerToSlot(${e.slot.id},${e.table.id},'${esc(g.game_name)}',${tableNum})">+ Ajouter</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:2px">${playersHtml}</div>
        </div>`;
      }).join('');

      const tablePlayers = entries.reduce((sum, e) => sum + e.tableBookings.length, 0);
      return `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--border);cursor:pointer;background:var(--surface2)"
             onclick="const d=document.getElementById('${tableId}');d.style.display=d.style.display==='none'?'block':'none';this.querySelector('.cp-chev').textContent=d.style.display==='none'?'▶':'▼'">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.82rem;font-weight:600">Table ${tableNum}</span>
            <span style="font-size:.72rem;color:var(--text-muted)">${tablePlayers} joueur${tablePlayers !== 1 ? 's' : ''}</span>
          </div>
          <span class="cp-chev" style="color:var(--text-muted);font-size:.75rem">▶</span>
        </div>
        <div id="${tableId}" style="display:none">${slotsHtml}</div>
      </div>`;
    }).join('');

    return `<div class="prog-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer"
           onclick="const d=document.getElementById('${gameId}');d.style.display=d.style.display==='none'?'block':'none';this.querySelector('.cp-chev').textContent=d.style.display==='none'?'▶':'▼'">
        ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:44px;height:44px;background:var(--surface2);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎲</div>'}
        <div style="flex:1">
          <div style="font-weight:600">${esc(g.game_name)}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${totalPlayers} joueur${totalPlayers !== 1 ? 's' : ''} inscrits · ${allEntries.length} créneau${allEntries.length !== 1 ? 'x' : ''}</div>
        </div>
        <span class="cp-chev" style="color:var(--text-muted)">▶</span>
      </div>
      <div id="${gameId}" style="display:none">${tablesHtml}</div>
    </div>`;
  }).join('');
}

async function addPlayerToSlot(slotId, tableId, gameName, tableNum) {
  const users = window._allUsers || [];
  const bookings = await api('GET', `/api/sessions/${currentSession.session.id}/bookings`);
  const alreadyBooked = (bookings.bookings || []).filter(b => b.slot_id === slotId).map(b => b.user_id);
  const available = users.filter(u => !alreadyBooked.includes(u.id));
  if (!available.length) { showToast('Tous les joueurs sont déjà inscrits sur ce créneau'); return; }
  const opts = available.map((u, i) => `${i+1}. ${u.username}`).join('\n');
  const choice = prompt(`Ajouter un joueur à "${gameName}" Table ${tableNum} :\n\n${opts}\n\nEntre le numéro :`);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= available.length) { showToast('Choix invalide'); return; }
  const user = available[idx];
  const res = await api('POST', '/api/convention/book', { slotId, tableId, userId: user.id });
  if (res.error) { showToast(res.error); return; }
  showToast(`✅ ${user.username} ajouté`);
  await _loadConventionProgramme();
}

async function openMovePlayer(userId, username, slotId, tableId, gameName, fromTableNum) {
  const progRes = await api('GET', `/api/sessions/${currentSession.session.id}/programme`);
  const slots = progRes.slots || [];
  // Trouver les autres tables sur le même créneau pour ce jeu
  const targetSlot = slots.find(s => s.id === slotId);
  if (!targetSlot) return;
  const otherTables = (targetSlot.tables || []).filter(t => t.table_number !== fromTableNum && t.game_name === gameName);
  if (!otherTables.length) { showToast('Aucune autre table disponible sur ce créneau'); return; }
  const opts = otherTables.map((t, i) => `${i+1}. Table ${t.table_number}`).join('\n');
  const choice = prompt(`Déplacer ${username} vers :\n\n${opts}\n\nEntre le numéro :`);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= otherTables.length) { showToast('Choix invalide'); return; }
  const targetTable = otherTables[idx];
  // Annuler la réservation actuelle et créer une nouvelle
  await api('DELETE', '/api/convention/book', { slotId, userId });
  const res = await api('POST', '/api/convention/book', { slotId, tableId: targetTable.id, userId });
  if (res.error) { showToast(res.error); return; }
  showToast(`✅ ${username} déplacé vers Table ${targetTable.table_number}`);
  await _loadConventionProgramme();
}
