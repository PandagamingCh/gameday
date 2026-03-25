// ─────────────────────────────────────────────────────────────
// doodle.js — Sondages de disponibilité (type Doodle)
//
// Contient :
//   - loadDoodlePage()         Charge la liste des sondages ouverts
//   - createDoodle()           Crée un nouveau sondage avec des dates proposées
//   - openDoodle(token)        Ouvre un sondage existant
//   - renderDoodleDetail()     Affiche un sondage avec les votes
//   - submitDoodleVotes()      Soumet les votes oui/non/peut-être
//   - validateDoodleDate()     Valide une date et crée une séance GameDay
//   - toggleDoodle()           Ouvre/ferme un sondage
// ─────────────────────────────────────────────────────────────

// DOODLE
// ═══════════════════════════════════════════════════

let _doodleSelectedDates = [];
let _currentDoodle = null;
let _doodleVotes = {}; // { dateId: 'yes'|'no'|'maybe' }

function showDoodleCreate() {
  _doodleSelectedDates = [];
  document.getElementById('doodleTitle').value = '';
  document.getElementById('doodleDatePicker').value = '';
  document.getElementById('doodleSelectedDates').innerHTML = '';
  document.getElementById('doodleCreateForm').style.display = 'block';
  document.getElementById('doodleList').style.display = 'none';
  document.getElementById('doodleDetail').style.display = 'none';
}

function hideDoodleCreate() {
  document.getElementById('doodleCreateForm').style.display = 'none';
  document.getElementById('doodleList').style.display = 'block';
}

function doodleAddDate(val) {
  if (!val || _doodleSelectedDates.includes(val)) return;
  _doodleSelectedDates.push(val);
  _doodleSelectedDates.sort();
  renderDoodleSelectedDates();
  document.getElementById('doodleDatePicker').value = '';
}

function doodleRemoveDate(val) {
  _doodleSelectedDates = _doodleSelectedDates.filter(d => d !== val);
  renderDoodleSelectedDates();
}

function renderDoodleSelectedDates() {
  const el = document.getElementById('doodleSelectedDates');
  el.innerHTML = _doodleSelectedDates.map(d => {
    const label = new Date(d+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    return `<span class="doodle-date-tag">${label}<button onclick="doodleRemoveDate('${d}')">✕</button></span>`;
  }).join('');
}

async function createDoodle() {
  const title = document.getElementById('doodleTitle').value.trim();
  if (!title) { showToast('Donne un titre au sondage'); return; }
  if (!_doodleSelectedDates.length) { showToast('Sélectionne au moins une date'); return; }
  const res = await api('POST', '/api/doodles', { title, dates: _doodleSelectedDates });
  if (res.error) { showToast('Erreur création : ' + res.error); return; }
  if (!res.token) { showToast('Erreur inattendue — pas de token reçu'); return; }
  hideDoodleCreate();
  await loadDoodlePage();
  openDoodle(res.token);
}

async function loadDoodlePage() {
  const res = await api('GET', '/api/doodles');
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  const list = document.getElementById('doodleList');
  list.style.display = 'block';
  document.getElementById('doodleDetail').style.display = 'none';
  if (!res.doodles?.length) {
    list.innerHTML = '<div class="empty"><span class="empty-icon">📅</span><div class="empty-label">Aucun sondage — crée le premier !</div></div>';
    return;
  }
  list.innerHTML = res.doodles.map(d => {
    const date = new Date(d.created_at).toLocaleDateString('fr-FR');
    const badge = d.closed ? '<span class="doodle-badge closed">Clôturé</span>' : '<span class="doodle-badge open">Ouvert</span>';
    const sessionLink = d.session_id ? `<span style="font-size:.7rem;color:var(--accent)"> → séance créée</span>` : '';
    return `<div class="doodle-card" onclick="openDoodle('${d.token}')">
      <div class="doodle-card-title">${esc(d.title)}${badge}${sessionLink}</div>
      <div class="doodle-card-meta">Par ${esc(d.creator)} · ${date}</div>
    </div>`;
  }).join('');
}

async function openDoodle(token) {
  const res = await api('GET', `/api/doodles/${token}`);
  if (res.error) { showToast(res.error); return; }
  _currentDoodle = res;
  // Pré-remplir mes votes
  _doodleVotes = {};
  res.votes.filter(v => v.user_id === currentUser.id).forEach(v => {
    _doodleVotes[String(v.date_id)] = v.answer;
  });
  document.getElementById('doodleList').style.display = 'none';
  document.getElementById('doodleCreateForm').style.display = 'none';
  renderDoodleDetail();
}

function renderDoodleDetail() {
  const { doodle, dates, votes, voters } = _currentDoodle;
  const el = document.getElementById('doodleDetail');
  el.style.display = 'block';

  const isOwner = doodle.created_by === currentUser.id || currentUser.is_admin;
  const isClosed = !!doodle.closed;

  // Calculer les totaux par date
  const totals = {};
  dates.forEach(d => { totals[d.id] = { yes:0, maybe:0, no:0 }; });
  votes.forEach(v => { if (totals[v.date_id]) totals[v.date_id][v.answer]++; });
  const maxYes = Math.max(...dates.map(d => totals[d.id].yes));

  // Construire la grille
  const dateHeaders = dates.map(d => {
    const label = new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
    const isBest = totals[d.id].yes === maxYes && maxYes > 0;
    return `<th class="date-col${isBest?' doodle-best':''}">${label}</th>`;
  }).join('');

  // Ligne de mon vote — toujours éditable (même si clôturé)
  const myRow = `<tr class="my-row">
    <td class="name-col">👤 ${esc(currentUser.username)} <span style="font-size:.65rem;color:var(--accent)">(toi)</span></td>
    ${dates.map(d => {
      const cur = _doodleVotes[String(d.id)] || 'no';
      return `<td>${['yes','maybe','no'].map(a => {
        const emoji = a==='yes'?'✅':a==='maybe'?'🤷':'❌';
        const sel = cur===a?` selected-${a}`:'';
        return `<button class="doodle-answer${sel}" onclick="doodleSetVote(${d.id},'${a}',this)">${emoji}</button>`;
      }).join('')}</td>`;
    }).join('')}
  </tr>`;

  // Lignes des autres votants
  const otherRows = voters.filter(v => v !== currentUser.username).map(voter => {
    const cells = dates.map(d => {
      const v = votes.find(x => x.username === voter && x.date_id === d.id);
      const emoji = !v ? '—' : v.answer==='yes'?'✅':v.answer==='maybe'?'🤷':'❌';
      return `<td>${emoji}</td>`;
    }).join('');
    return `<tr><td class="name-col">${esc(voter)}</td>${cells}</tr>`;
  }).join('');

  // Ligne totaux
  const totalRow = `<tr class="total-row">
    <td class="name-col">Total ✅</td>
    ${dates.map(d => `<td class="${totals[d.id].yes===maxYes&&maxYes>0?'doodle-best':''}">${totals[d.id].yes}✅ ${totals[d.id].maybe>0?totals[d.id].maybe+'🤷':''}</td>`).join('')}
  </tr>`;

  const shareUrl = `${location.origin}/doodle/${doodle.token}`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn-sm ghost" onclick="backToDoodleList()">← Retour</button>
      <div style="flex:1"></div>
      ${isOwner && isClosed ? `<button class="btn-sm accent" onclick="toggleDoodle('${doodle.token}', false)">🔓 Rouvrir le sondage</button>` : ''}
      ${isOwner && !isClosed ? `<button class="btn-sm warning" onclick="toggleDoodle('${doodle.token}', true)">🔒 Clôturer le sondage</button>` : ''}
      ${isOwner ? `<button class="btn-sm danger" onclick="deleteDoodle('${doodle.token}')">🗑 Supprimer</button>` : ''}
    </div>
    <div class="admin-section">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div>
          <div class="admin-section-title" style="margin-bottom:2px">${esc(doodle.title)}
            ${isClosed ? '<span class="doodle-badge closed">Clôturé</span>' : '<span class="doodle-badge open">Ouvert</span>'}
          </div>
          <div style="font-size:.72rem;color:var(--text-muted)">Par ${esc(doodle.creator)} · ${voters.length} participant${voters.length>1?'s':''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="form-input" value="${shareUrl}" readonly style="font-size:.7rem;max-width:220px" onclick="this.select()">
          <button class="btn-sm ghost" onclick="navigator.clipboard.writeText('${shareUrl}');showToast('Lien copié !')">📋</button>
          <a class="btn-sm ghost" href="${shareUrl}" target="_blank" rel="noopener" style="text-decoration:none">↗</a>
        </div>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        ${isOwner && !isClosed ? `<button class="btn-sm accent" style="background:var(--green-text,#6fcf97);color:#111" onclick="showValidatePicker()">✅ Valider une date</button>` : ''}
        ${isOwner && !isClosed && maxYes > 0 ? (() => {
          const bestDate = dates.find(d => totals[d.id].yes === maxYes);
          const bestLabel = new Date(bestDate.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
          return `<button class="btn-sm accent" style="background:#2d6a4f;color:#fff" onclick="quickCreateSession(${bestDate.id},'${esc(doodle.title)}')">🎉 Créer séance — ${bestLabel} (${maxYes}✅)</button>`;
        })() : ''}
      </div>
      <div id="doodleValidatePicker" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px">
        <div class="form-label" style="margin-bottom:8px">Choisir la date retenue :</div>
        <select class="form-input" id="doodleDateSelect" style="margin-bottom:10px">
          ${dates.map(d => {
            const label = new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
            const yes = totals[d.id].yes;
            return `<option value="${d.id}" data-date="${d.date}">${label} — ${yes} ✅</option>`;
          }).join('')}
        </select>
        <div class="form-group">
          <label class="form-label">Nom de la séance</label>
          <input class="form-input" id="doodleSessionName" value="${esc(doodle.title)}" placeholder="Nom de la séance">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-sm ghost" onclick="document.getElementById('doodleValidatePicker').style.display='none'">Annuler</button>
          <button class="btn-sm accent" onclick="confirmValidateDoodle()">🎉 Créer la séance</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="doodle-grid">
          <thead><tr><th></th>${dateHeaders}</tr></thead>
          <tbody>${myRow}${otherRows}${totalRow}</tbody>
        </table>
      </div>
      <div style="margin-top:10px">
        <button class="btn-sm accent" onclick="submitDoodleVotes()">💾 Enregistrer mes réponses</button>
      </div>
      ${doodle.session_id ? `<div style="margin-top:12px;font-size:.8rem;color:var(--accent)">✅ Séance créée — <a href="#" onclick="loadSession(${doodle.session_id});showPage('page-session');return false">ouvrir la séance</a></div>` : ''}
      ${isClosed && !isOwner ? '' : !isClosed ? '' : ''}
    </div>
  `;
}

function doodleSetVote(dateId, answer, btn) {
  _doodleVotes[String(dateId)] = answer;
  // Mettre à jour visuellement les 3 boutons de cette date
  const cell = btn.closest('td');
  cell.querySelectorAll('.doodle-answer').forEach(b => {
    b.className = 'doodle-answer';
  });
  btn.className = `doodle-answer selected-${answer}`;
}

async function submitDoodleVotes() {
  const token = _currentDoodle.doodle.token;
  const res = await api('POST', `/api/doodles/${token}/vote`, { answers: _doodleVotes });
  if (res.error) { showToast(res.error); return; }
  showToast('✅ Votes enregistrés !');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  votes_backup = _doodleVotes;
  renderDoodleDetail();
  _doodleVotes = votes_backup;
}

async function quickCreateSession(dateId, defaultName) {
  const name = prompt('Nom de la séance :', defaultName);
  if (name === null) return;
  await validateDoodleDate(dateId, name || defaultName);
}

function showValidatePicker() {
  document.getElementById('doodleValidatePicker').style.display = 'block';
}

async function confirmValidateDoodle() {
  const select = document.getElementById('doodleDateSelect');
  const dateId = parseInt(select.value);
  const sessionName = document.getElementById('doodleSessionName').value.trim() || _currentDoodle.doodle.title;
  await validateDoodleDate(dateId, sessionName);
  document.getElementById('doodleValidatePicker').style.display = 'none';
}

async function validateDoodleDate(dateId, sessionName) {
  const token = _currentDoodle.doodle.token;
  const res = await api('POST', `/api/doodles/${token}/validate`, { dateId, sessionName });
  if (res.error) { showToast(res.error); return; }
  showToast('🎉 Séance créée !');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  renderDoodleDetail();
  // Recharger les séances sur la page d'accueil
  loadHome();
}

async function toggleDoodle(token, close) {
  const res = await api('PATCH', `/api/doodles/${token}/toggle`, { closed: close });
  if (res.error) { showToast(res.error); return; }
  showToast(close ? '🔒 Sondage clôturé' : '🔓 Sondage rouvert');
  const r = await api('GET', `/api/doodles/${token}`);
  _currentDoodle = r;
  renderDoodleDetail();
}

async function deleteDoodle(token) {
  if (!confirm('Supprimer ce sondage ?')) return;
  await api('DELETE', `/api/doodles/${token}`);
  backToDoodleList();
}

function backToDoodleList() {
  document.getElementById('doodleDetail').style.display = 'none';
  document.getElementById('doodleList').style.display = 'block';
  _currentDoodle = null;
}