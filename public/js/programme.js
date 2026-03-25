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

async function renderProgrammePanel() {
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
      </div>
      <div class="prog-card-body">
        ${warnings.length ? `<div class="prog-warn">${warnings.join(' ')} Vous pouvez quand même créer le programme manuellement.</div>` : ''}
        ${hasProposals ? `
        <div class="prog-participants">
          <strong>${nbParticipants} participant${nbParticipants > 1 ? 's' : ''}</strong> ·
          <strong>${totalGames} jeu${totalGames > 1 ? 'x' : ''}</strong> proposés
        </div>` : ''}
        ${hasVotes ? `
        <button class="btn-sm ghost" style="margin-bottom:12px;width:100%" onclick="openRankingsPopup()">
          📊 Voir les classements individuels
        </button>` : ''}

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
                  <select id="progNbTables" class="form-input">
                    <option value="1">1 table</option>
                    <option value="2" selected>2 tables</option>
                    <option value="3">3 tables</option>
                  </select>
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
       <button class="btn-sm ghost" onclick="validateProgramme(false)">Dépublier</button>
       <a class="btn-sm ghost" href="/programme/${currentSession.session.id}" target="_blank">🔗 Voir la page</a>`
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

function _teacherId(idx, table, type) {
  if (table === 'A') return type === 'sel' ? `steacher_${idx}` : type === 'free' ? `steacher_free_${idx}` : `steacher_warn_${idx}`;
  if (table === 'B') return type === 'sel' ? `steacherb_${idx}` : type === 'free' ? `steacherb_free_${idx}` : `steacherb_warn_${idx}`;
  return type === 'sel' ? `steacherc_${idx}` : type === 'free' ? `steacherc_free_${idx}` : `steacherc_warn_${idx}`;
}

function _playersInputId(idx, table) {
  if (table === 'A') return `sp_${idx}`;
  if (table === 'B') return `spb_${idx}`;
  return `spc_${idx}`;
}

function onTeacherChange(idx, table) {
  const sel = document.getElementById(_teacherId(idx, table, 'sel'));
  const free = document.getElementById(_teacherId(idx, table, 'free'));
  if (free) free.value = '';
  checkTeacherWarning(idx, table, sel.value);
  checkTeacherConflictsLive(idx);
}

function onTeacherFreeInput(idx, table) {
  const free = document.getElementById(_teacherId(idx, table, 'free'));
  checkTeacherWarning(idx, table, free?.value || '');
  checkTeacherConflictsLive(idx);
}

function getTeacherValue(idx, table) {
  const free = document.getElementById(_teacherId(idx, table, 'free'));
  if (free?.value.trim()) return free.value.trim();
  const sel = document.getElementById(_teacherId(idx, table, 'sel'));
  return sel?.value || '';
}

function checkTeacherWarning(idx, table, teacher) {
  const warn = document.getElementById(_teacherId(idx, table, 'warn'));
  if (!warn || !teacher) { if(warn) warn.style.display='none'; return; }
  const playersInput = document.getElementById(_playersInputId(idx, table));
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
  const tA = getTeacherValue(editIdx, 'A');
  const tB = getTeacherValue(editIdx, 'B');
  const tC = getTeacherValue(editIdx, 'C');
  const wA = document.getElementById(`steacher_warn_${editIdx}`);
  if (tA && tB && tA.toLowerCase() === tB.toLowerCase()) {
    if (wA) { wA.textContent = '⚠ Même teacher pour les deux tables !'; wA.style.display = 'block'; }
  } else if (tA && tC && tA.toLowerCase() === tC.toLowerCase()) {
    if (wA) { wA.textContent = '⚠ Même teacher pour tables A et C !'; wA.style.display = 'block'; }
  }
}

function checkTeacherConflicts(editIdx) {
  const conflicts = [];
  const slot = programmeSlots[editIdx];
  const teacherA = slot.teacher;
  const teacherB = slot.teacher_b;
  const teacherC = slot.teacher_c;
  const teachers = [teacherA, teacherB, teacherC].filter(Boolean);

  // Conflits internes au créneau
  const seen = new Set();
  for (const t of teachers) {
    const key = t.toLowerCase();
    if (seen.has(key)) conflicts.push(`${t} ne peut pas enseigner plusieurs tables en même temps`);
    seen.add(key);
  }

  // Vérifier contre les autres créneaux simultanés (même heure)
  const startTime = document.getElementById(`st_${editIdx}`)?.value || '';
  if (startTime) {
    programmeSlots.forEach((s, i) => {
      if (i === editIdx || s.is_break) return;
      if (s.start_time === startTime) {
        const others = [s.teacher, s.teacher_b, s.teacher_c].filter(Boolean);
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

async function estimateSlotDuration(idx, table) {
  const gameIds = { 'A': `sn_${idx}`, 'B': `snb_${idx}`, 'C': `snc_${idx}` };
  const njIds = { 'A': `snj_${idx}`, 'B': `snjb_${idx}`, 'C': `snjc_${idx}` };
  const durIds = { 'A': `sde_${idx}`, 'B': `sdeb_${idx}`, 'C': `sdec_${idx}` };
  const gameInput = document.getElementById(gameIds[table]);
  const njInput = document.getElementById(njIds[table]);
  const durInput = document.getElementById(durIds[table]);
  const btn = document.querySelector(`[onclick="estimateSlotDuration(${idx},'${table}')"]`);
  const gameName = gameInput?.value?.trim();
  if (!gameName) { showToast("Renseigne d'abord le nom du jeu"); return; }
  const nbPlayers = parseInt(njInput?.value) || currentSession.participants?.length || 4;
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
  const res = await api('POST', '/api/programme/generate', {
    sessionId: currentSession.session.id,
    startTime, endTime, hasLunch, lunchTime,
    lunchDurationMinutes: parseInt(lunchDur),
    nbPlayers, nbTables, nbTogether, nbParallel
  });

  btn.disabled = false;
  btn.textContent = '✨ Générer avec l\'IA';
  output.innerHTML = '';

  if (res.error) {
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

  programmeSlots = res.slots || [];
  progLoaded = true;

  if (res.unscheduled?.length) {
    output.innerHTML = `<div class="prog-unscheduled">⚠ Jeux non planifiés : ${res.unscheduled.map(esc).join(', ')}</div>`;
  }

  renderSlots();
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
  const hasB = slot.game_name_b && slot.game_name_b.trim();
  const hasC = slot.game_name_c && slot.game_name_c.trim();
  const multiTable = hasB || hasC;

  // Index note BGG depuis les propositions
  const ratingIndex = {};
  (currentSession?.proposals || []).forEach(p => {
    if (p.bgg_rating) ratingIndex[p.name.toLowerCase()] = p.bgg_rating;
  });

  function tableViewHtml(letter, name, dur, players, teacher, badge, thumb) {
    const rating = name ? ratingIndex[name.toLowerCase()] : null;
    return `<div class="slot-table-block${multiTable ? ' slot-table-boxed' : ''}" style="display:flex;gap:8px;align-items:flex-start">
      ${thumb ? `<img src="${esc(thumb)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        ${multiTable ? `<div class="table-badge${letter !== 'A' ? ' table-badge-'+letter.toLowerCase() : ''}">${badge} Table ${letter}</div>` : ''}
        <div class="slot-name">${esc(name)}${rating ? ` <span style="font-size:.65rem;color:var(--accent);font-weight:700">⭐${rating}</span>` : ''}</div>
        <div class="slot-meta">${dur ? dur+'min · ' : ''}${esc(players)}${teacher ? ' · 🎓 '+esc(teacher) : ''}</div>
      </div>
    </div>`;
  }

  div.innerHTML = `
    <div class="slot-view">
      <div class="slot-drag-handle" title="Déplacer">⠿</div>
      <div class="slot-time">${esc(slot.start_time)}</div>
      <div class="slot-info" style="flex:1">
        ${slot.is_break
          ? `<div class="slot-name">☕ ${esc(slot.game_name)}</div>`
          : `<div class="slot-tables">
              ${tableViewHtml('A', slot.game_name, slot.duration_est, slot.players, slot.teacher, '🅰', slot.thumbnail)}
              ${hasB ? tableViewHtml('B', slot.game_name_b, slot.duration_est_b, slot.players_b, slot.teacher_b, '🅱', slot.thumbnail_b) : ''}
              ${hasC ? tableViewHtml('C', slot.game_name_c, slot.duration_est_c, slot.players_c, slot.teacher_c, '🅲', slot.thumbnail_c) : ''}
            </div>`
        }
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
        <input class="form-input" id="st_${idx}" value="${esc(slot.start_time)}" style="max-width:90px" list="slotTimeOptions" placeholder="HH:MM" autocomplete="off">
      </div>
      ${makeTableEditBlock('A', slot, idx)}
      <div id="stableB_${idx}" style="${hasB ? '' : 'display:none'}">
        ${makeTableEditBlock('B', slot, idx)}
      </div>
      <div id="stableC_${idx}" style="${hasC ? '' : 'display:none'}">
        ${makeTableEditBlock('C', slot, idx)}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap" id="stablebtn_${idx}">
        <button class="btn-sm ghost" id="saddB_${idx}" style="${hasB ? 'display:none' : ''}" onclick="addTableToSlot(${idx},'B')">+ Table B</button>
        <button class="btn-sm ghost" id="sremB_${idx}" style="${hasB ? '' : 'display:none'}" onclick="removeTableFromSlot(${idx},'B')">− Retirer Table B</button>
        <button class="btn-sm ghost" id="saddC_${idx}" style="${hasC || !hasB ? 'display:none' : ''}" onclick="addTableToSlot(${idx},'C')">+ Table C</button>
        <button class="btn-sm ghost" id="sremC_${idx}" style="${hasC ? '' : 'display:none'}" onclick="removeTableFromSlot(${idx},'C')">− Retirer Table C</button>
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
function makeTableEditBlock(letter, slot, idx) {
  const l = letter.toLowerCase();
  const suffixes = { 'A': '', 'B': '_b', 'C': '_c' };
  const suf = suffixes[letter];
  const colors = { 'A': 'var(--accent)', 'B': 'var(--accent2)', 'C': '#7c5cbf' };
  const badges = { 'A': '🅰', 'B': '🅱', 'C': '🅲' };
  const gameName = letter === 'A' ? slot.game_name : (slot['game_name_'+l] || '');
  const nbPlayers = letter === 'A' ? slot.nb_players : slot['nb_players_'+l];
  const durEst = letter === 'A' ? slot.duration_est : slot['duration_est_'+l];
  const players = letter === 'A' ? (slot.players||'') : (slot['players_'+l]||'');
  const teacher = letter === 'A' ? (slot.teacher||'') : (slot['teacher_'+l]||'');
  const gameId = letter === 'A' ? `sn_${idx}` : `sn${l}_${idx}`;
  const suggId = letter === 'A' ? `sgsugg_${idx}` : `sgsugg${l}_${idx}`;
  const nbId = letter === 'A' ? `snj_${idx}` : `snj${l}_${idx}`;
  const durId = letter === 'A' ? `sde_${idx}` : `sde${l}_${idx}`;
  const wrapId = letter === 'A' ? `spwrap_${idx}` : `spwrap_${l}_${idx}`;
  const teachSelId = letter === 'A' ? `steacher_${idx}` : `steacher${l}_${idx}`;
  const teachFreeId = letter === 'A' ? `steacher_free_${idx}` : `steacher${l}_free_${idx}`;
  const teachWarnId = letter === 'A' ? `steacher_warn_${idx}` : `steacher${l}_warn_${idx}`;
  const searchId = letter === 'A' ? `sgSearch_${idx}` : `sgSearch${l}_${idx}`;
  const searchResultId = letter === 'A' ? `sgResults_${idx}` : `sgResults${l}_${idx}`;
  const browserId = letter === 'A' ? `sgBrowser_${idx}` : `sgBrowser${l}_${idx}`;
  const participants = currentSession?.participants || [];
  const tabsHtml =
    `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',0,'${browserId}',this)">🗳 Votés</button>` +
    participants.map(u =>
      `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',${u.id},'${browserId}',this)">${esc(u.username)}</button>`
    ).join('') + `<button class="ctab" onclick="slotCollTab('${gameId}','${searchResultId}','${nbId}','${durId}',-1,'${browserId}',this)">🔍 BGG</button>`;

  return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px">
    <div class="form-label" style="margin-bottom:8px;color:${colors[letter]}">${badges[letter]} Table ${letter}${letter !== 'A' ? ' <span style="font-weight:normal;font-size:.7rem">(optionnel)</span>' : ''}</div>
    <div class="slot-edit-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Jeu sélectionné</label>
        <input class="form-input" id="${gameId}" value="${esc(gameName)}" placeholder="(rechercher ci-dessous)" style="background:var(--surface2)" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">👥 Joueurs</label>
        <input class="form-input" type="number" id="${nbId}" value="${nbPlayers||''}" style="max-width:60px" placeholder="nb">
      </div>
      <div class="form-group">
        <label class="form-label">Durée estimée</label>
        <div style="display:flex;gap:4px;align-items:center">
          <input class="form-input" type="number" id="${durId}" value="${durEst??''}" style="max-width:75px" placeholder="min">
          <button class="btn-sm ghost" style="padding:4px 7px;font-size:.7rem" title="Estimer avec l'IA" onclick="estimateSlotDuration(${idx},'${letter}')">✨</button>
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
        ${buildPlayersSelector(players, idx, letter)}
      </div>
    </div>
    <div class="form-group" style="margin-top:6px">
      <label class="form-label">🎓 Teacher</label>
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" id="${teachSelId}" onchange="onTeacherChange(${idx},'${letter}')" style="flex:1">
          <option value="">Pas de teach (jeu connu)</option>
          ${buildTeacherOptions(players, teacher)}
        </select>
        <input class="form-input" id="${teachFreeId}" value="${esc(teacher)}" placeholder="Saisie libre…" style="max-width:140px"
          oninput="document.getElementById('${teachSelId}').value=''; onTeacherFreeInput(${idx},'${letter}')">
      </div>
      <div id="${teachWarnId}" style="font-size:.72rem;color:#e07070;margin-top:3px;display:none"></div>
    </div>
  </div>`;
}

function addTableToSlot(idx, letter) {
  document.getElementById('stable'+letter+'_'+idx).style.display = 'block';
  document.getElementById('sadd'+letter+'_'+idx).style.display = 'none';
  document.getElementById('srem'+letter+'_'+idx).style.display = '';
  // Afficher bouton +C seulement si B vient d'être ajouté
  if (letter === 'B') {
    const addC = document.getElementById('saddC_'+idx);
    if (addC) addC.style.display = '';
  }
}

function removeTableFromSlot(idx, letter) {
  document.getElementById('stable'+letter+'_'+idx).style.display = 'none';
  document.getElementById('sadd'+letter+'_'+idx).style.display = '';
  document.getElementById('srem'+letter+'_'+idx).style.display = 'none';
  // Si on retire B, cacher aussi C
  if (letter === 'B') {
    const addC = document.getElementById('saddC_'+idx);
    const remC = document.getElementById('sremC_'+idx);
    const tableC = document.getElementById('stableC_'+idx);
    if (addC) addC.style.display = 'none';
    if (remC) remC.style.display = 'none';
    if (tableC) tableC.style.display = 'none';
  }
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
  slot.game_name = document.getElementById(`sn_${idx}`).value.trim();
  slot.duration_est = document.getElementById(`sde_${idx}`)?.value !== '' ? parseInt(document.getElementById(`sde_${idx}`)?.value) || null : null;
  slot.nb_players = parseInt(document.getElementById(`snj_${idx}`)?.value) || null;
  slot.players = getSlotPlayers(idx, 'A');
  slot.teacher = document.getElementById(`steacher_free_${idx}`)?.value.trim() || document.getElementById(`steacher_${idx}`)?.value || '';
  // Table B — vide si masquée
  const bVisible = document.getElementById(`stableB_${idx}`)?.style.display !== 'none';
  slot.game_name_b = bVisible ? (document.getElementById(`snb_${idx}`)?.value.trim() || '') : '';
  slot.duration_est_b = bVisible && document.getElementById(`sdeb_${idx}`)?.value !== '' ? parseInt(document.getElementById(`sdeb_${idx}`)?.value) || null : null;
  slot.nb_players_b = bVisible ? (parseInt(document.getElementById(`snjb_${idx}`)?.value) || null) : null;
  slot.players_b = bVisible ? getSlotPlayers(idx, 'B') : '';
  slot.teacher_b = bVisible ? (document.getElementById(`steacherb_free_${idx}`)?.value.trim() || document.getElementById(`steacherb_${idx}`)?.value || '') : '';
  // Table C — vide si masquée
  const cVisible = document.getElementById(`stableC_${idx}`)?.style.display !== 'none';
  slot.game_name_c = cVisible ? (document.getElementById(`snc_${idx}`)?.value.trim() || '') : '';
  slot.duration_est_c = cVisible && document.getElementById(`sdec_${idx}`)?.value !== '' ? parseInt(document.getElementById(`sdec_${idx}`)?.value) || null : null;
  slot.nb_players_c = cVisible ? (parseInt(document.getElementById(`snjc_${idx}`)?.value) || null) : null;
  slot.players_c = cVisible ? getSlotPlayers(idx, 'C') : '';
  slot.teacher_c = cVisible ? (document.getElementById(`steacherc_free_${idx}`)?.value.trim() || document.getElementById(`steacherc_${idx}`)?.value || '') : '';
  // Thumbnails
  slot.thumbnail = document.getElementById(`sthumb_${idx}`)?.value || slot.thumbnail || '';
  slot.thumbnail_b = bVisible ? (document.getElementById(`sthumb_b_${idx}`)?.value || slot.thumbnail_b || '') : '';
  slot.thumbnail_c = cVisible ? (document.getElementById(`sthumb_c_${idx}`)?.value || slot.thumbnail_c || '') : '';

  slot.note = document.getElementById(`sno_${idx}`).value.trim();
  slot.is_break = document.getElementById(`sb_${idx}`).checked ? 1 : 0;
  // Vérification conflits avant sauvegarde
  const conflicts = checkTeacherConflicts(idx);
  if (conflicts.length) {
    if (!confirm('⚠ Conflits détectés :\n' + conflicts.join('\n') + '\n\nSauvegarder quand même ?')) return;
  }

  if (slot.id) {
    await api('PATCH', `/api/programme/slots/${slot.id}`, slot);
  } else {
    const r = await api('POST', '/api/programme/slots', { ...slot, sessionId: currentSession.session.id, sort_order: idx });
    slot.id = r.id;
  }
  updateSlotView(idx);
  toggleSlotEdit(idx, false);
}

function updateSlotView(idx) {
  const slot = programmeSlots[idx];
  const card = document.querySelector(`.slot-card[data-id="${slot.id}"]`);
  if (!card) return;
  const hasB = slot.game_name_b && slot.game_name_b.trim();
  const hasC = slot.game_name_c && slot.game_name_c.trim();
  const multiTable = hasB || hasC;
  const view = card.querySelector('.slot-view');
  if (!view) return;
  const timeEl = view.querySelector('.slot-time');
  const infoEl = view.querySelector('.slot-info');
  if (timeEl) timeEl.textContent = slot.start_time;
  function tbView(letter, name, dur, players, teacher, thumb) {
    const badges = { 'A':'🅰', 'B':'🅱', 'C':'🅲' };
    const extraClass = letter !== 'A' ? ` slot-table-${letter.toLowerCase()}` : '';
    return `<div class="slot-table-block${multiTable ? ' slot-table-boxed'+extraClass : ''}" style="display:flex;gap:8px;align-items:flex-start">
      ${thumb ? `<img src="${esc(thumb)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        ${multiTable ? `<div class="table-badge${letter !== 'A' ? ' table-badge-'+letter.toLowerCase() : ''}">${badges[letter]} Table ${letter}</div>` : ''}
        <div class="slot-name">${esc(name)}</div>
        <div class="slot-meta">${dur ? dur+'min · ' : ''}${esc(players)}${teacher ? ' · 🎓 '+esc(teacher) : ''}</div>
      </div>
    </div>`;
  }
  if (infoEl) infoEl.innerHTML = slot.is_break
    ? `<div class="slot-name">☕ ${esc(slot.game_name)}</div>`
    : `<div class="slot-tables">
        ${tbView('A', slot.game_name, slot.duration_est, slot.players, slot.teacher, slot.thumbnail)}
        ${hasB ? tbView('B', slot.game_name_b, slot.duration_est_b, slot.players_b, slot.teacher_b, slot.thumbnail_b) : ''}
        ${hasC ? tbView('C', slot.game_name_c, slot.duration_est_c, slot.players_c, slot.teacher_c, slot.thumbnail_c) : ''}
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

function recalcSlotTimes() {
  if (!programmeSlots.length) return;
  // Utiliser l'heure de début de la journée comme ancre fixe
  const startInput = document.getElementById('progStart');
  let cursor = startInput?.value?.trim() || null;
  // Fallback : premier créneau non-vide
  if (!cursor) {
    for (const s of programmeSlots) {
      if (s.start_time && s.start_time.trim()) { cursor = s.start_time; break; }
    }
  }
  if (!cursor) return;

  for (let i = 0; i < programmeSlots.length; i++) {
    const s = programmeSlots[i];
    s.start_time = cursor;
    // Mettre à jour directement dans le DOM si la carte existe
    const card = document.querySelector(`.slot-card[data-id="${s.id}"]`);
    if (card) {
      const timeEl = card.querySelector('.slot-time');
      if (timeEl) timeEl.textContent = cursor;
      const stInput = card.querySelector(`input[id^="st_"]`);
      if (stInput) stInput.value = cursor;
    }
    // Calculer la durée de ce créneau
    const dur = s.duration_est || s.duration_min || 60;
    const durB = s.duration_est_b || s.duration_min_b || (s.game_name_b ? dur : 0);
    const durC = s.duration_est_c || s.duration_min_c || (s.game_name_c ? dur : 0);
    const slotDur = Math.max(dur, durB, durC);
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
    // Thumbnail caché
    const thumbId = gameId.replace(/^sn_/, 'sthumb_').replace(/^snb_/, 'sthumb_b_').replace(/^snc_/, 'sthumb_c_');
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
    return filtered.slice(0, 60).map(g => {
      const time = g.min_time && g.min_time !== '0' ? (g.min_time === g.max_time ? `${g.min_time}min` : `${g.min_time}-${g.max_time}min`) : '';
      const players = g.min_players && g.max_players ? (g.min_players === g.max_players ? `${g.min_players}j` : `${g.min_players}-${g.max_players}j`) : '';
      return `<div class="coll-item slot-coll-item" data-name="${esc(g.name)}">
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
        return `<div class="coll-item slot-coll-item" data-name="${esc(g.name)}">
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
      const name = item?.dataset.name;
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
    const name = item?.dataset.name;
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
  res.games.slice(0, 10).forEach(g => {
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
  const thumbId = gameId.replace(/^sn_/, 'sthumb_').replace(/^snb_/, 'sthumb_b_').replace(/^snc_/, 'sthumb_c_');
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
    if (coll.length) addSection(`📚 ${p.username} (${coll.length})`, coll.slice(0, 15), '');
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
      if (res.games?.length) addSection(`🌐 BGG (${res.games.length})`, res.games.slice(0, 8), '');
      if (!resultEl.children.length) {
        resultEl.innerHTML = '<div style="padding:8px;font-size:.75rem;color:var(--text-muted)">Aucun résultat</div>';
      }
    } catch(e) { if (resultEl.contains(loader)) resultEl.removeChild(loader); }
  }
}

function buildPlayersSelector(current, idx, table) {
  // Utiliser tous les membres du site ou juste les participants selon le paramètre global
  const useAllSite = sitePermissions['players_scope'] !== 1;
  const allUsers = useAllSite
    ? (allSiteUsers.length ? allSiteUsers : (currentSession.participants || []))
    : (currentSession.participants || []);
  const currentList = current.split(',').map(s => s.trim()).filter(Boolean);
  const isTous = !current || current.toLowerCase() === 'tous';
  const ids = { 'A': `sp_${idx}`, 'B': `spb_${idx}`, 'C': `spc_${idx}` };
  const inputId = ids[table] || `sp_${idx}`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      <label class="priv-member-item">
        <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${table}" value="tous" ${isTous ? 'checked' : ''}
          onchange="onSlotTousChange(this,${idx},'${table}')"> Tous
      </label>
      ${allUsers.map(p => `
        <label class="priv-member-item">
          <input type="checkbox" class="slot-player-cb slot-player-cb-${idx}-${table}" value="${esc(p.username)}" ${!isTous && currentList.includes(p.username) ? 'checked' : ''}
            onchange="onSlotPlayerChange(this,${idx},'${table}')"> ${esc(p.username)}
        </label>`).join('')}
    </div>
    <input class="form-input" id="${inputId}" value="${isTous ? 'tous' : esc(current)}" placeholder="Ou saisie libre…" style="font-size:.75rem"
      oninput="slotPlayerManualInput(this,${idx},'${table}')">
  `;
}

function onSlotTousChange(cb, idx, table) {
  const ids = { 'A': `sp_${idx}`, 'B': `spb_${idx}`, 'C': `spc_${idx}` };
  if (cb.checked) {
    document.querySelectorAll(`.slot-player-cb-${idx}-${table}`).forEach(c => { if (c.value !== 'tous') c.checked = false; });
    const inp = document.getElementById(ids[table]);
    if (inp) inp.value = 'tous';
  }
}

function onSlotPlayerChange(cb, idx, table) {
  const ids = { 'A': `sp_${idx}`, 'B': `spb_${idx}`, 'C': `spc_${idx}` };
  const tousCb = [...document.querySelectorAll(`.slot-player-cb-${idx}-${table}`)].find(c => c.value === 'tous');
  if (tousCb) tousCb.checked = false;
  const checked = [...document.querySelectorAll(`.slot-player-cb-${idx}-${table}:checked`)].map(c => c.value).filter(v => v !== 'tous');
  const inp = document.getElementById(ids[table]);
  if (inp) inp.value = checked.join(', ');
}

function slotPlayerManualInput(input, idx, table) {
  // Sync les checkboxes depuis la saisie manuelle (best effort)
  const vals = input.value.split(',').map(s => s.trim().toLowerCase());
  const isTous = vals.includes('tous') || vals.join('') === '';
  document.querySelectorAll(`.slot-player-cb-${idx}-${table}`).forEach(cb => {
    if (cb.value === 'tous') cb.checked = isTous;
    else cb.checked = !isTous && vals.includes(cb.value.toLowerCase());
  });
}

function getSlotPlayers(idx, table) {
  const ids = { 'A': `sp_${idx}`, 'B': `spb_${idx}`, 'C': `spc_${idx}` };
  const inp = document.getElementById(ids[table]);
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
