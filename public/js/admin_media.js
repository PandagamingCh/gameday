// ─────────────────────────────────────────────────────────────
// admin_media.js — Navigateur de fichiers admin (arborescence)
//
// Contient :
//   - scanMedia()             Charge l'arborescence et l'affiche
//   - renderMediaTree()       Affiche la vue arbre avec dossiers dépliables
//   - toggleFolder(name)      Ouvre/ferme un dossier
//   - renameFolder(name)      Prompt et envoi route rename-folder
//   - deleteFolder(name)      Confirmation et envoi route DELETE folder
//   - renameFile(folder,name) Prompt et envoi route rename-file
//   - moveFile(folder,name)   Menu de choix puis envoi route move-file
//   - deleteFile(folder,name) Confirmation et envoi route DELETE file
// ─────────────────────────────────────────────────────────────

let _mediaTree = null;
let _openFolders = new Set();

async function scanMedia() {
  const btn = document.getElementById('mediaScanBtn');
  const results = document.getElementById('mediaScanResults');
  if (!results) return;
  btn.disabled = true;
  btn.textContent = '⏳ Chargement…';
  results.innerHTML = '<div style="font-size:.75rem;color:var(--text-muted);padding:8px">Analyse de l\'arborescence…</div>';

  const tree = await api('GET', '/api/admin/media/tree');
  btn.disabled = false;
  btn.textContent = '🔄 Rafraîchir';

  if (tree.error) { results.innerHTML = `<div style="color:var(--red-text)">${esc(tree.error)}</div>`; return; }

  _mediaTree = tree;
  // Par défaut, tous les dossiers fermés
  if (_openFolders.size === 0 && tree.folders.length === 1) {
    _openFolders.add(tree.folders[0].name); // si 1 seul, l'ouvrir
  }
  renderMediaTree();
}

function renderMediaTree() {
  const results = document.getElementById('mediaScanResults');
  if (!results || !_mediaTree) return;

  const t = _mediaTree;
  const fmt = b => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : (b/1024).toFixed(0) + ' KB';

  // Stats globales
  let totalFiles = t.files.length;
  let totalSize = t.files.reduce((s,f) => s+f.size, 0);
  let totalUsed = t.files.filter(f => f.inUse).length;
  for (const folder of t.folders) {
    totalFiles += folder.fileCount;
    totalSize += folder.totalSize;
    totalUsed += folder.usedCount;
  }
  const orphanCount = totalFiles - totalUsed;

  let html = `
    <div class="media-stats-row">
      <div class="media-stat-box">
        <div class="media-stat-num">${t.folders.length}</div>
        <div class="media-stat-label">Dossiers</div>
      </div>
      <div class="media-stat-box">
        <div class="media-stat-num">${totalFiles}</div>
        <div class="media-stat-label">Fichiers</div>
        <div class="media-stat-size">${fmt(totalSize)}</div>
      </div>
      <div class="media-stat-box ${orphanCount ? 'media-stat-warn' : ''}">
        <div class="media-stat-num">${orphanCount}</div>
        <div class="media-stat-label">Orphelins</div>
      </div>
    </div>
  `;

  // Tree
  html += '<div class="media-tree">';

  // Dossiers
  for (const folder of t.folders) {
    const isOpen = _openFolders.has(folder.name);
    html += `
      <div class="media-folder ${isOpen ? 'open' : ''}">
        <div class="media-folder-header" onclick="toggleFolder('${esc(folder.name)}')">
          <span class="media-folder-chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="media-folder-icon">📁</span>
          <span class="media-folder-name">${esc(folder.name)}</span>
          <span class="media-folder-meta">${folder.fileCount} fichier${folder.fileCount>1?'s':''} · ${fmt(folder.totalSize)}${folder.usedCount < folder.fileCount ? ` · <span style="color:var(--accent)">${folder.fileCount - folder.usedCount} orphelin${folder.fileCount - folder.usedCount > 1 ? 's' : ''}</span>` : ''}</span>
          <div class="media-folder-actions" onclick="event.stopPropagation()">
            <button class="btn-icon" title="Renommer le dossier" onclick="renameFolder('${esc(folder.name)}')">✏️</button>
            <button class="btn-icon btn-icon-danger" title="Supprimer le dossier" onclick="deleteFolder('${esc(folder.name)}')">🗑</button>
          </div>
        </div>
        ${isOpen ? renderFolderContent(folder) : ''}
      </div>
    `;
  }

  // Fichiers à la racine
  if (t.files.length) {
    html += '<div class="media-root-files"><div class="media-folder-header"><span style="margin-left:14px">📄 Fichiers à la racine (' + t.files.length + ')</span></div>';
    html += '<div class="media-folder-body">';
    for (const file of t.files) {
      html += renderFileRow(file, '');
    }
    html += '</div></div>';
  }

  html += '</div>';

  if (!t.folders.length && !t.files.length) {
    html += '<div style="font-size:.78rem;color:var(--text-muted);font-style:italic;padding:20px;text-align:center">Aucun fichier dans /uploads</div>';
  }

  results.innerHTML = html;
}

function renderFolderContent(folder) {
  if (!folder.files.length) {
    return '<div class="media-folder-body"><div style="font-size:.72rem;color:var(--text-muted);font-style:italic;padding:8px">Dossier vide</div></div>';
  }
  let html = '<div class="media-folder-body">';
  for (const file of folder.files) {
    html += renderFileRow(file, folder.name);
  }
  html += '</div>';
  return html;
}

function renderFileRow(file, folderName) {
  const fmt = b => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : (b/1024).toFixed(0) + ' KB';
  const isVideo = /\.(mp4|mov|webm|avi)$/i.test(file.url);
  const folderJsParam = JSON.stringify(folderName);
  const nameJsParam = JSON.stringify(file.name);

  let badges = '';
  if (file.inUse) {
    if (file.session_name) badges += `<span class="media-badge">${esc(file.session_name)}</span>`;
    if (file.game_name) badges += `<span class="media-badge media-badge-game">${esc(file.game_name)}</span>`;
    if (file.caption) badges += `<span class="media-badge" style="font-style:italic">"${esc(file.caption.substring(0, 30))}${file.caption.length > 30 ? '…' : ''}"</span>`;
  } else {
    badges += '<span class="media-badge media-badge-warn">orphelin</span>';
  }

  return `
    <div class="media-file-row">
      <div class="media-file-thumb" onclick="openLightbox('${esc(file.url)}','',false)">
        ${isVideo
          ? `<video src="${esc(file.url)}" preload="metadata"></video><div class="media-play-icon">▶</div>`
          : `<img src="${esc(file.url)}" loading="lazy">`}
      </div>
      <div class="media-file-info">
        <div class="media-file-name">${esc(file.name)}</div>
        <div class="media-badges">${badges}</div>
        <div class="media-file-meta">${fmt(file.size)}</div>
      </div>
      <div class="media-file-actions">
        <button class="btn-icon" title="Renommer" onclick='renameFile(${folderJsParam}, ${nameJsParam})'>✏️</button>
        <button class="btn-icon" title="Déplacer" onclick='moveFile(${folderJsParam}, ${nameJsParam})'>📂</button>
        <button class="btn-icon btn-icon-danger" title="Supprimer" onclick='deleteFile(${folderJsParam}, ${nameJsParam})'>🗑</button>
      </div>
    </div>
  `;
}

function toggleFolder(name) {
  if (_openFolders.has(name)) _openFolders.delete(name);
  else _openFolders.add(name);
  renderMediaTree();
}

async function renameFolder(oldName) {
  const newName = prompt('Nouveau nom du dossier :', oldName);
  if (!newName || newName === oldName) return;
  const r = await api('POST', '/api/admin/media/rename-folder', { oldName, newName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  // Mettre à jour l'état des dossiers ouverts
  if (_openFolders.has(oldName)) {
    _openFolders.delete(oldName);
    _openFolders.add(newName);
  }
  showToast(`✅ Dossier renommé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function deleteFolder(name) {
  const folder = _mediaTree.folders.find(f => f.name === name);
  if (!folder) return;
  const msg = `Supprimer le dossier "${name}" et ses ${folder.fileCount} fichier${folder.fileCount>1?'s':''} ?\n\nLes références en base de données seront aussi supprimées.\n\nCette action est irréversible.`;
  if (!confirm(msg)) return;
  const r = await api('DELETE', '/api/admin/media/folder', { name });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  _openFolders.delete(name);
  showToast(`✅ Dossier supprimé (${r.fileCount} fichiers, ${r.dbDeleted} réf BDD)`);
  scanMedia();
}

async function renameFile(folder, oldName) {
  const newName = prompt('Nouveau nom du fichier :', oldName);
  if (!newName || newName === oldName) return;
  const r = await api('POST', '/api/admin/media/rename-file', { folder, oldName, newName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  showToast(`✅ Fichier renommé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function moveFile(fromFolder, fileName) {
  // Construire la liste des dossiers possibles
  const folders = _mediaTree.folders.map(f => f.name).filter(n => n !== fromFolder);
  if (!folders.length && fromFolder === '') { showToast('Aucun autre dossier disponible'); return; }

  const options = [];
  if (fromFolder !== '') options.push({ value: '', label: '(racine)' });
  folders.forEach(f => options.push({ value: f, label: f }));

  // Prompt simple avec liste numérotée
  const msg = 'Choisis le dossier de destination :\n\n' +
    options.map((o, i) => `${i + 1}. ${o.label}`).join('\n') +
    '\n\nEntre le numéro :';
  const choice = prompt(msg);
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) { showToast('Choix invalide'); return; }
  const toFolder = options[idx].value;

  const r = await api('POST', '/api/admin/media/move-file', { fromFolder, toFolder, fileName });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  // Garder le dossier de destination ouvert
  if (toFolder) _openFolders.add(toFolder);
  showToast(`✅ Fichier déplacé (${r.updated} référence${r.updated>1?'s':''} mises à jour)`);
  scanMedia();
}

async function deleteFile(folder, name) {
  if (!confirm(`Supprimer le fichier "${name}" ?\n\nLes références en base seront aussi supprimées.`)) return;
  const r = await api('DELETE', '/api/admin/media/file', { folder, name });
  if (r.error) { showToast('Erreur : ' + r.error); return; }
  showToast(`✅ Fichier supprimé${r.dbDeleted ? ` (${r.dbDeleted} réf BDD)` : ''}`);
  scanMedia();
}
