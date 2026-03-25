// ─────────────────────────────────────────────────────────────
// lightbox.js — Galerie photos plein écran
//
// Contient :
//   - openLightbox(url, caption, isEmbed)  Ouvre la lightbox sur une image/vidéo
//   - closeLightbox()                      Ferme la lightbox
//   - lbPrev() / lbNext()                 Navigation entre les médias
// ─────────────────────────────────────────────────────────────

// LIGHTBOX
// ═══════════════════════════════════════════════════
// ── Lightbox avec navigation ─────────────────────────────────────────────────
let _lbItems = [];
let _lbIdx = 0;

function openLightbox(url, caption, isEmbed) {
  // Collecter tous les médias visibles dans le même contexte (même row ou même page)
  _lbItems = [];
  document.querySelectorAll('.arch-photo-wrap[data-mid]').forEach(function(wrap) {
    const img = wrap.querySelector('img.arch-photo-thumb');
    const vidWrap = wrap.querySelector('.arch-video-preview');
    const cap = wrap.querySelector('.arch-caption-edit');
    const capText = cap ? cap.textContent.trim() : '';
    if (img) {
      _lbItems.push({ url: img.src, caption: capText, isEmbed: false });
    } else if (vidWrap) {
      const oc = vidWrap.getAttribute('onclick') || '';
      const m = oc.match(/openLightbox\('([^']+)','[^']*',(\w+)\)/);
      if (m) _lbItems.push({ url: m[1], caption: capText, isEmbed: m[2] === 'true' });
    }
  });
  // Si aucun item collecté, afficher juste l'image courante
  if (_lbItems.length === 0) _lbItems = [{ url, caption: caption||'', isEmbed: !!isEmbed }];
  // Trouver l'index courant
  _lbIdx = _lbItems.findIndex(function(it) { return it.url === url; });
  if (_lbIdx < 0) _lbIdx = 0;
  _lbShow();
  document.getElementById('lightboxOverlay').style.display = 'flex';
  document.addEventListener('keydown', lightboxKeyHandler);
}

function _lbShow() {
  const item = _lbItems[_lbIdx];
  if (!item) return;
  const img = document.getElementById('lightboxImg');
  const vid = document.getElementById('lightboxVideo');
  vid.pause(); vid.src = '';
  if (item.isEmbed) {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = item.url;
  } else if (item.url.match(/\.mp4|\.webm|\.mov/i)) {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = item.url;
    vid.play().catch(function(){});
  } else {
    vid.style.display = 'none';
    img.style.display = 'block';
    img.src = item.url;
  }
  document.getElementById('lightboxCaption').textContent = item.caption || '';
  // Afficher/cacher flèches
  document.getElementById('lbPrev').style.display = _lbIdx > 0 ? 'flex' : 'none';
  document.getElementById('lbNext').style.display = _lbIdx < _lbItems.length - 1 ? 'flex' : 'none';
  document.getElementById('lbCounter').textContent = _lbItems.length > 1 ? (_lbIdx + 1) + ' / ' + _lbItems.length : '';
}

function lbPrev(e) { e.stopPropagation(); if (_lbIdx > 0) { _lbIdx--; _lbShow(); } }
function lbNext(e) { e.stopPropagation(); if (_lbIdx < _lbItems.length - 1) { _lbIdx++; _lbShow(); } }

function closeLightbox() {
  const vid = document.getElementById('lightboxVideo');
  vid.pause(); vid.src = '';
  document.getElementById('lightboxOverlay').style.display = 'none';
  document.removeEventListener('keydown', lightboxKeyHandler);
}
function lightboxKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') { if (_lbIdx > 0) { _lbIdx--; _lbShow(); } }
  if (e.key === 'ArrowRight') { if (_lbIdx < _lbItems.length - 1) { _lbIdx++; _lbShow(); } }
}

// ═══════════════════════════════════════════════════
