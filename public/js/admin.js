// ─────────────────────────────────────────────────────────────
// admin.js — Page d'administration
//
// Contient :
//   - loadAdmin()               Charge la page admin (permissions, users, invites, etc.)
//   - renderPermissionsTable()  Affiche le tableau des permissions par action
//   - savePermissions()         Sauvegarde les permissions via API
//   - renderAdminUsers()        Liste les utilisateurs avec actions (delete, reset)
//   - generateInviteLink()      Crée un lien d'invitation
//   - toggleAdminSection()      Ouvre/ferme une section collapsible
// ─────────────────────────────────────────────────────────────

// ADMIN
// ═══════════════════════════════════════════════════
function copyAdminResetUrl() {
  const url = document.getElementById('adminResetUrl')?.textContent;
  if (url) { navigator.clipboard.writeText(url); showToast('URL copiée !'); }
}

function toggleSimVotes(enabled) {
  sessionStorage.setItem('simVotesEnabled', enabled ? '1' : '0');
  showToast(enabled ? '🤖 Simulation activée' : 'Simulation désactivée');
}

const PERM_LABELS = {
  session_create:     '📅 Créer une séance',
  session_edit:       '✏️ Modifier une séance',
  session_delete:     '🗑 Supprimer une séance',
  proposal_add:       '➕ Ajouter un jeu',
  proposal_edit:      '✏️ Modifier un jeu',
  proposal_delete:    '✕ Supprimer un jeu',
  vote:               '🗳 Voter',
  vote_lock:          '🔒 Verrouiller les votes',
  programme_generate: '✨ Générer un programme (IA)',
  programme_edit:     '🔧 Modifier les créneaux',
  programme_publish:  '✅ Publier le programme',
  report_media:       '📷 Ajouter des médias (CR)',
  report_scores:      '🏆 Ajouter des scores (CR)',
  report_notes:       '📝 Ajouter des notes (CR)',
};

const PERM_LEVEL_LABELS = ['Tous les membres', 'Créateur / Proposant', 'Admin uniquement'];

function renderPermissionsPanel(permissions) {
  const panel = document.getElementById('permissionsPanel');
  if (!panel) return;
  const permsMap = {};
  permissions.forEach(p => permsMap[p.action] = p.level);

  panel.innerHTML = `
    <table style="width:100%;font-size:.78rem;border-collapse:collapse">
      <thead>
        <tr style="color:var(--text-muted);text-align:left">
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Action</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Qui peut faire ça ?</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(PERM_LABELS).map(([action, label]) => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid var(--border2)">${label}</td>
            <td style="padding:8px;border-bottom:1px solid var(--border2)">
              <select class="form-input" style="font-size:.75rem;padding:4px 8px" onchange="savePermission('${action}', parseInt(this.value))">
                ${PERM_LEVEL_LABELS.map((l, i) => `<option value="${i}" ${(permsMap[action]??0) === i ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

async function savePermission(action, level) {
  await api('PATCH', '/api/permissions', { permissions: [{ action, level }] });
  sitePermissions[action] = level;
}

function isSimVotesEnabled() {
  return sessionStorage.getItem('simVotesEnabled') === '1';
}

async function savePlayersScopeSetting(val) {
  await api('PATCH', '/api/permissions', { permissions: [{ action: 'players_scope', level: val }] });
  sitePermissions['players_scope'] = val;
}

function openRankingsPopup() {
  const participants = currentSession.participants;
  const proposals = currentSession.proposals;
  const rankings = currentSession.rankings;
  const content = participants.map(p => {
    const catBlocks = currentSession.categories.map(cat => {
      const catRankings = rankings.filter(r => r.user_id === p.id && r.category_id === cat.id).sort((a,b) => a.rank - b.rank);
      if (!catRankings.length) return '';
      const games = catRankings.map(r => {
        const prop = proposals.find(x => x.id === r.proposal_id);
        return prop ? `<div style="font-size:.78rem;padding:2px 0"><span style="color:var(--text-muted);min-width:18px;display:inline-block">${r.rank}.</span> ${esc(prop.name)}</div>` : '';
      }).filter(Boolean).join('');
      return `<div style="margin-bottom:8px">
        <div style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">${esc(cat.icon)} ${esc(cat.name)}</div>
        ${games}
      </div>`;
    }).filter(Boolean).join('');
    if (!catBlocks) return '';
    return `<div style="border-top:1px solid var(--border);padding:12px 0">
      <div style="font-size:.85rem;font-weight:700;margin-bottom:8px">👤 ${esc(p.username)}</div>
      ${catBlocks}
    </div>`;
  }).join('');
  document.getElementById('rankingsPopupContent').innerHTML = content || '<div style="color:var(--text-muted);font-size:.8rem">Aucun vote enregistré.</div>';
  const popup = document.getElementById('rankingsPopup');
  popup.classList.add('open');
  popup.onclick = e => { if (e.target === popup) popup.classList.remove('open'); };
}

// ── Thème CSS ────────────────────────────────────────────────

async function loadAdmin() {
  // Sync checkbox état
  const toggle = document.getElementById('simVotesToggle');
  if (toggle) toggle.checked = isSimVotesEnabled();

  // Init email reset toggle
  const emailToggle = document.getElementById('emailResetToggle');
  const emailEnabled = !!sitePermissions['email_reset_enabled'];
  if (emailToggle) emailToggle.checked = emailEnabled;
  const emailPanel = document.getElementById('emailSettingsPanel');
  if (emailPanel) emailPanel.style.display = emailEnabled ? '' : 'none';
  // Pré-remplir nom du site
  const siteNameInput = document.getElementById('siteNameInput');
  if (siteNameInput) {
    const r = await api('GET', '/api/settings');
    if (r.settings?.site_name) siteNameInput.value = r.settings.site_name;
  }

  // Afficher l'URL de récupération admin
  const resetUrlEl = document.getElementById('adminResetUrl');
  if (resetUrlEl) resetUrlEl.textContent = `${location.origin}/admin-reset?token=VOTRE_ADMIN_RESET_TOKEN`;

  // Charger et afficher les permissions
  const permRes = await api('GET', '/api/permissions');
  if (permRes.permissions) {
    sitePermissions = {};
    permRes.permissions.forEach(p => sitePermissions[p.action] = p.level);
    renderPermissionsPanel(permRes.permissions);
    // Sync radio players scope
    const scope = sitePermissions['players_scope'] ?? 0;
    const radios = document.querySelectorAll('input[name="playersScope"]');
    radios.forEach(r => r.checked = parseInt(r.value) === scope);
  }
  renderThemeEditor();

  const res = await api('GET', '/api/invites');
  const list = document.getElementById('invitesList');
  list.innerHTML = '';
  if (res.invites?.length) {
    res.invites.forEach(inv => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.7rem;';
      d.innerHTML = `
        <span style="color:${inv.used_by_name ? 'var(--text-muted)' : 'var(--accent)'}">
          ${inv.used_by_name ? `✓ Utilisé par ${esc(inv.used_by_name)}` : `🔗 Actif`}
        </span>
        <span style="color:var(--text-muted)">${new Date(inv.created_at).toLocaleDateString('fr-FR')}</span>
        ${!inv.used_by_name && inv.is_active ? `<button class="btn-sm ghost" onclick="copyInvite('${inv.token}')">Copier le lien</button>` : ''}
      `;
      list.appendChild(d);
    });
  }

  const usersRes = await api('GET', '/api/admin/users');
  const tbody = document.getElementById('adminUsersList');
  tbody.innerHTML = `<table class="users-table">
    <thead><tr><th>Pseudo</th><th>BGG</th><th>Jeux</th><th>Inscrit le</th><th></th></tr></thead>
    <tbody>${(usersRes.users || []).map(u => `
      <tr>
        <td>${esc(u.username)} ${u.is_admin ? '<span style="color:var(--accent)">★</span>' : ''}</td>
        <td style="color:var(--text-muted)">${esc(u.bgg_username || '—')}</td>
        <td style="color:var(--text-muted)">${u.game_count || 0}</td>
        <td style="color:var(--text-muted)">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
        <td style="display:flex;gap:4px">
          <button class="btn-sm ghost" onclick="generateResetLink(${u.id},'${esc(u.username)}')">🔑 Reset</button>
          ${u.is_admin ? '' : `<button class="btn-sm danger" onclick="deleteUser(${u.id},'${esc(u.username)}')">Supprimer</button>`}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Section backup
  const backupSection = document.getElementById('backupSection');
  if (backupSection) {
    backupSection.style.display = 'block';
    loadBackups();
  }
}

async function createInvite() {
  const res = await api('POST', '/api/invites');
  const el = document.getElementById('inviteResult');
  el.innerHTML = `<div class="invite-link" onclick="copyInviteLink('${res.link}')">🔗 ${res.link}<br><small style="color:var(--text-muted)">Cliquez pour copier</small></div>`;
  loadAdmin();
}

function copyInviteLink(link) { navigator.clipboard.writeText(link); showToast('Lien copié !'); }
function copyInvite(token) { navigator.clipboard.writeText(`${location.origin}/register?invite=${token}`); showToast('Lien copié !'); }

async function generateResetLink(id, name) {
  const res = await api('POST', `/api/admin/reset-link/${id}`);
  if (res.error) { showToast('Erreur : ' + res.error); return; }
  // Afficher le lien dans une modale simple
  const msg = `Lien de réinitialisation pour ${name} :\n\n${res.link}\n\nValable 24h. Copiez et envoyez-le à l'utilisateur.`;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(res.link);
    showToast(`🔑 Lien copié pour ${name} !`);
  } else {
    prompt('Lien de reset (copiez-le) :', res.link);
  }
}

async function deleteUser(id, name) {
  if (!confirm(`Supprimer l'utilisateur "${name}" ?`)) return;
  await api('DELETE', `/api/admin/users/${id}`);
  loadAdmin();
}

async function loadBackups() {
  const r = await api('GET', '/api/admin/backup/list');
  const el = document.getElementById('backupList');
  if (!el) return;
  const files = r.files || [];
  if (!files.length) { el.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted)">Aucun backup disponible</div>'; return; }
  el.innerHTML = files.map(f => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.75rem;color:var(--text)">${esc(f.name)}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:.7rem;color:var(--text-muted)">${(f.size/1024).toFixed(1)} KB</span>
        <a class="btn-sm ghost" href="/api/admin/backup/download/${esc(f.name)}" download>⬇️</a>
      </div>
    </div>
  `).join('');
}

async function triggerBackup() {
  const r = await api('POST', '/api/admin/backup/now');
  showToast('Backup lancé !');
  setTimeout(loadBackups, 1500);
}

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formatDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }

// ═══════════════════════════════════════════════════
