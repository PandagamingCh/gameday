// ─────────────────────────────────────────────────────────────
// routes/archives.js — Compte-rendu, médias, scores et stats
//
// Routes :
//   GET    /api/sessions/:id/archive         Récupère les données d'archive
//   POST   /api/sessions/:id/archive         Sauvegarde le compte-rendu
//   POST   /api/sessions/:id/archive/games   Ajoute une partie jouée
//   PATCH  /api/archive/games/:id            Modifie une partie
//   DELETE /api/archive/games/:id            Supprime une partie
//   POST   /api/archive/photos/upload        Upload une photo/vidéo
//   POST   /api/sessions/:id/archive/photos  Associe une photo à la séance
//   PATCH  /api/archive/photos/:id           Modifie une photo (caption)
//   DELETE /api/archive/photos/:id           Supprime une photo
//   PATCH  /api/archive/photos/reorder       Réordonne les photos
//   GET    /api/stats                        Statistiques globales du site
//   GET    /archive/:sessionId               Page publique d'archive (HTML)
//   GET    /archive                          Page liste des archives (HTML)
//   GET    /stats                            Page stats (HTML)
//   GET    /photo/:filename                  Sert une photo uploadée
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const upload = require('../upload');
// upload passé via req.upload depuis server.js
const fs = require('fs');
const path = require('path');

// ── ARCHIVES ─────────────────────────────────────────────────

// GET /archive/:sessionId — page publique archive d'une séance (sans auth)
router.get('/archive/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).send('<h1>Archive introuvable</h1>');

  const archive = db.prepare('SELECT * FROM session_archive WHERE session_id = ?').get(sessionId);
  const games = db.prepare('SELECT * FROM archive_games WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  let allMedia = [];
  try { allMedia = db.prepare('SELECT * FROM archive_media WHERE session_id = ? ORDER BY sort_order').all(sessionId); }
  catch(e) { allMedia = db.prepare('SELECT *, "photo" as type FROM archive_photos WHERE session_id = ? ORDER BY sort_order').all(sessionId); }

  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function mediaHtml(items, height='200px') {
    return items.map((m,idx) => {
      const cap = m.caption ? `<div class="media-leg">${esc(m.caption)}</div>` : '';
      if (m.type === 'video') {
        const yt = (m.url||'').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
        if (yt) {
          const ytThumb = 'https://img.youtube.com/vi/' + yt[1] + '/hqdefault.jpg';
          const src = 'https://www.youtube.com/embed/' + yt[1];
          return `<div class="media-item video-item" data-lburl="${esc(src)}" data-lbmode="embed" style="cursor:pointer" onclick="openLightbox('${esc(src)}','embed')"><div class="media-thumb-wrap"><img src="${esc(ytThumb)}" style="width:100%;height:${height};object-fit:cover;border-radius:8px"><div class="media-play-overlay">▶</div></div>${cap}</div>`;
        }
        const thumb = m.thumbnail;
        const vurl = esc(m.url);
        return `<div class="media-item video-item" data-lburl="${vurl}" data-lbmode="mp4">${thumb ? `<div class="media-thumb-wrap" style="cursor:pointer" onclick="openLightbox('${vurl}','mp4')"><img src="${esc(thumb)}" style="width:100%;height:${height};object-fit:cover;border-radius:8px"><div class="media-play-overlay">▶</div></div>` : `<div class="media-thumb-wrap" style="cursor:pointer;height:${height}" onclick="openLightbox('${vurl}','mp4')"><div style="width:100%;height:100%;background:var(--card2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:2.5rem">🎬</div><div class="media-play-overlay">▶</div></div>`}${cap}</div>`;
      }
      return `<div class="media-item" data-lburl="${esc(m.url)}" data-lbmode="img" style="cursor:zoom-in" onclick="openLightbox('${esc(m.url)}','img')"><img src="${esc(m.url)}" alt="" loading="lazy" style="width:100%;height:${height};object-fit:cover;border-radius:8px" onerror="this.parentElement.style.display='none'">${cap}</div>`;
    }).join('');
  }

  // Notes générales + photos de séance
  const sessionMedia = allMedia.filter(m => !m.game_id);
  const notesHtml = archive?.compte_rendu
    ? `<div class="notes-box"><div class="notes-label">📝 Notes générales</div><div class="notes-text">${esc(archive.compte_rendu)}</div></div>` : '';
  const sessionMediaHtml = sessionMedia.length
    ? `<div class="media-row">${mediaHtml(sessionMedia)}</div>` : '';

  // Fiche par jeu — tous les jeux
  const gamesHtml = games.map(g => {
    const gameMedia = allMedia.filter(m => m.game_id === g.id);
    const photosHtml = gameMedia.length ? `<div class="media-row">${mediaHtml(gameMedia, '180px')}</div>` : '';
    const scoresSorted = sortScoresDesc(g.scores || '');
    return `<div class="game-card">
      <div class="game-header">
        ${g.thumbnail ? `<img class="game-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'" loading="lazy">` : '<div class="game-thumb-ph">🎲</div>'}
        <div class="game-info">
          <div class="game-name">${esc(g.game_name)}</div>
          ${g.joueurs ? `<div class="game-meta">👥 ${esc(g.joueurs)}</div>` : ''}
          ${g.vainqueur ? `<div class="game-win">🏆 ${esc(g.vainqueur)}</div>` : ''}
          ${scoresSorted ? `<div class="game-meta">📊 ${esc(scoresSorted)}</div>` : ''}
        </div>
      </div>
      ${g.compte_rendu ? `<div class="game-cr">${esc(g.compte_rendu)}</div>` : ''}
      ${photosHtml}
    </div>`;
  }).join('');

  const hasContent = notesHtml || sessionMediaHtml || gamesHtml;

  const html = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archive — ${esc(session.name)}</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
a{text-decoration:none;color:inherit}
a{text-decoration:none;color:inherit}
:root,[data-theme="light"]{--bg:#e0d9ce;--card:#ece6db;--card2:#d8d2c6;--text:#1a1a2e;--text2:#4a4a6a;--text3:#888;--accent:#4a6fa5;--border:#c8c2b6;}
[data-theme="dark"]{--bg:#0f0e0b;--card:#1a1814;--card2:#222019;--text:#e8e4d8;--text2:#a09880;--text3:#666;--accent:#8ba3c7;--border:#2a2820;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px 16px;max-width:720px;margin:0 auto}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
h1{font-size:1.5rem;font-weight:800;margin-bottom:4px}
.subtitle{color:var(--text3);font-size:.85rem;margin-bottom:20px}
.theme-btn{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:.82rem;color:var(--text);flex-shrink:0}
/* Notes générales */
.notes-box{background:var(--card);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px}
.notes-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:6px}
.notes-text{font-size:.88rem;line-height:1.65;color:var(--text2);white-space:pre-wrap}
/* Photos séance */
.media-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.media-thumb-wrap{position:relative;}
.media-play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);color:#fff;font-size:2rem;border-radius:8px;transition:background .15s;}
.media-thumb-wrap:hover .media-play-overlay{background:rgba(0,0,0,.5);}
.media-item{flex:0 0 auto;width:calc(33.333% - 6px);display:flex;flex-direction:column;}
.media-item img{width:100%;border-radius:8px;object-fit:cover;aspect-ratio:4/3;display:block;cursor:zoom-in;transition:opacity .15s}
.media-item img:hover{opacity:.88}
.video-item{width:100%}
.media-leg{font-size:.72rem;color:var(--text2);margin-top:5px;text-align:center;font-style:italic;line-height:1.3;}
/* Fiches jeux */
.games-title{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:12px}
.game-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px}
.game-header{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px}
.game-thumb{width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0}
.game-thumb-ph{width:56px;height:56px;border-radius:8px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0}
.game-name{font-size:1rem;font-weight:700;line-height:1.2}
.game-win{font-size:.78rem;color:var(--accent);font-weight:600;margin-top:4px}
.game-meta{font-size:.72rem;color:var(--text3);margin-top:3px}
.game-cr{font-size:.85rem;color:var(--text2);line-height:1.6;margin-bottom:12px;white-space:pre-wrap}
/* Lightbox */
.lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out}
.lightbox.open{display:flex}
.lightbox img{max-width:94vw;max-height:94vh;border-radius:6px}
.footer{font-size:.68rem;color:var(--text3);margin-top:28px;text-align:center}
@media print{.print-btn,.theme-btn{display:none}body{background:#fff}}
@media(max-width:480px){.media-item{width:calc(50% - 4px)}}
</style>
</head>
<body>
<div class="topbar">
  <div>
    <h1>📚 ${esc(session.name)}</h1>
    <div class="subtitle">${esc(session.date || '')}</div>
  </div>
  <button class="theme-btn" onclick="toggleTheme()" id="themeBtn">🌙</button>
</div>

${notesHtml}
${sessionMediaHtml}
${gamesHtml ? `<div class="games-title">Comptes rendus par jeu</div>${gamesHtml}` : ''}
${!hasContent ? '<p style="color:var(--text3);font-size:.85rem;font-style:italic">Aucun contenu pour cette séance.</p>' : ''}

<p class="footer">GameDay · pandagaming.ch</p>
<div id="lightbox" onclick="closeLb()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:10px">
  <button id="lbPrev" onclick="lbPrev(event)" style="display:none;position:fixed;left:16px;top:50%;transform:translateY(-50%);background:rgba(30,30,30,.88);border:2px solid rgba(255,255,255,.5);color:#fff;font-size:2.4rem;width:56px;height:56px;border-radius:50%;cursor:pointer;z-index:10001;line-height:1;box-shadow:0 2px 16px rgba(0,0,0,.6);align-items:center;justify-content:center;padding:0">&#8249;</button>
  <img id="lightboxImg" src="" style="max-width:80vw;max-height:82vh;border-radius:8px;display:none">
  <iframe id="lightboxIframe" src="" frameborder="0" allowfullscreen style="display:none;width:80vw;max-width:900px;height:50vw;max-height:506px;border-radius:8px" onclick="event.stopPropagation()"></iframe>
  <video id="lightboxVid" src="" controls playsinline style="display:none;max-width:80vw;max-height:82vh;border-radius:8px" onclick="event.stopPropagation()"></video>
  <div id="lbCaption" style="color:#ccc;font-size:.85rem;text-align:center;max-width:80vw"></div>
  <div id="lbCounter" style="color:#888;font-size:.72rem"></div>
  <button id="lbNext" onclick="lbNext(event)" style="display:none;position:fixed;right:16px;top:50%;transform:translateY(-50%);background:rgba(30,30,30,.88);border:2px solid rgba(255,255,255,.5);color:#fff;font-size:2.4rem;width:56px;height:56px;border-radius:50%;cursor:pointer;z-index:10001;line-height:1;box-shadow:0 2px 16px rgba(0,0,0,.6);align-items:center;justify-content:center;padding:0">&#8250;</button>
</div>
<script>
var _lbItems=[], _lbIdx=0;
function _collectMedia(){
  var items=[];
  document.querySelectorAll('.media-item[data-lburl]').forEach(function(el){
    var cap=el.querySelector('.media-leg');
    items.push({url:el.dataset.lburl, mode:el.dataset.lbmode||'img', caption:cap?cap.textContent:''});
  });
  return items;
}
function openLightbox(url,mode){
  _lbItems=_collectMedia();
  if(_lbItems.length===0) _lbItems=[{url:url,mode:mode,caption:''}];
  _lbIdx=_lbItems.findIndex(function(it){return it.url===url;});
  if(_lbIdx<0) _lbIdx=0;
  _lbShow();
  document.getElementById('lightbox').style.display='flex';
}
function _lbShow(){
  var it=_lbItems[_lbIdx];
  var img=document.getElementById('lightboxImg');
  var ifr=document.getElementById('lightboxIframe');
  var vid=document.getElementById('lightboxVid');
  img.style.display='none'; ifr.style.display='none'; ifr.src=''; vid.pause&&vid.pause(); vid.style.display='none'; vid.src='';
  if(it.mode==='embed'){ifr.src=it.url;ifr.style.display='block';}
  else if(it.mode==='mp4'||it.mode==='direct'||it.url.match(/\.mp4|\.webm|\.mov/i)){vid.src=it.url;vid.style.display='block';}
  else{img.src=it.url;img.style.display='block';}
  document.getElementById('lbCaption').textContent=it.caption||'';
  document.getElementById('lbCounter').textContent=_lbItems.length>1?(_lbIdx+1)+' / '+_lbItems.length:'';
  document.getElementById('lbPrev').style.display=_lbIdx>0?'flex':'none';
  document.getElementById('lbNext').style.display=_lbIdx<_lbItems.length-1?'flex':'none';
}
function lbPrev(e){e.stopPropagation();if(_lbIdx>0){_lbIdx--;_lbShow();}}
function lbNext(e){e.stopPropagation();if(_lbIdx<_lbItems.length-1){_lbIdx++;_lbShow();}}
function closeLb(){
  document.getElementById('lightboxIframe').src='';
  var v=document.getElementById('lightboxVid'); v.pause&&v.pause(); v.src='';
  document.getElementById('lightbox').style.display='none';
}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeLb();
  if(e.key==='ArrowLeft')lbPrev(e);
  if(e.key==='ArrowRight')lbNext(e);
});
function toggleTheme(){
  const h=document.documentElement,dark=h.getAttribute('data-theme')==='dark';
  h.setAttribute('data-theme',dark?'light':'dark');
  document.getElementById('themeBtn').textContent=dark?'🌙':'☀️';
  localStorage.setItem('gd_arch_theme',dark?'light':'dark');
}
const t=localStorage.getItem('gd_arch_theme');
if(t){document.documentElement.setAttribute('data-theme',t);document.getElementById('themeBtn').textContent=t==='dark'?'☀️':'🌙';}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /api/sessions/:id/archive
router.get('/api/sessions/:id/archive', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const archive = db.prepare('SELECT * FROM session_archive WHERE session_id = ?').get(sessionId);
  const games = db.prepare('SELECT * FROM archive_games WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  // Essayer archive_media d'abord, fallback sur archive_photos
  let allMedia = [];
  try {
    allMedia = db.prepare('SELECT * FROM archive_media WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  } catch(e) {
    allMedia = db.prepare('SELECT *, "photo" as type FROM archive_photos WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  }
  const gamesWithMedia = games.map(g => ({
    ...g,
    photos: allMedia.filter(m => m.game_id === g.id)
  }));
  const sessionMedia = allMedia.filter(m => !m.game_id);
  res.json({ archive: archive || null, games: gamesWithMedia, photos: sessionMedia });
});

// POST /api/sessions/:id/archive — créer ou mettre à jour le CR
router.post('/api/sessions/:id/archive', requireAuth, requirePerm('report_notes'), (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { compte_rendu } = req.body;
  const existing = db.prepare('SELECT id FROM session_archive WHERE session_id = ?').get(sessionId);
  if (existing) {
    db.prepare("UPDATE session_archive SET compte_rendu=?, updated_at=datetime('now') WHERE session_id=?").run(compte_rendu||'', sessionId);
  } else {
    db.prepare('INSERT INTO session_archive (session_id, compte_rendu) VALUES (?,?)').run(sessionId, compte_rendu||'');
  }
  res.json({ ok: true });
});

// POST /api/sessions/:id/archive/games — ajouter un jeu joué
router.post('/api/sessions/:id/archive/games', requireAuth, requirePerm('report_scores'), (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { game_name, bgg_id, thumbnail, vainqueur, scores, sort_order, joueurs, compte_rendu } = req.body;
  if (!game_name) return res.status(400).json({ error: 'Nom requis' });
  const r = db.prepare('INSERT INTO archive_games (session_id, game_name, bgg_id, thumbnail, vainqueur, scores, sort_order, joueurs, compte_rendu) VALUES (?,?,?,?,?,?,?,?,?)').run(sessionId, game_name, bgg_id||'', thumbnail||'', vainqueur||'', scores||'', sort_order||0, joueurs||'', compte_rendu||'');
  res.json({ ok: true, id: r.lastInsertRowid });
});

// PATCH /api/archive/games/:id
router.patch('/api/archive/games/:id', requireAuth, (req, res) => {
  const { game_name, bgg_id, thumbnail, vainqueur, scores, joueurs, compte_rendu } = req.body;
  db.prepare('UPDATE archive_games SET game_name=?, bgg_id=?, thumbnail=?, vainqueur=?, scores=?, joueurs=?, compte_rendu=? WHERE id=?').run(game_name||'', bgg_id||'', thumbnail||'', vainqueur||'', scores||'', joueurs||'', compte_rendu||'', parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/archive/games/:id
router.delete('/api/archive/games/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM archive_games WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// POST /api/archive/photos/upload — upload d'une photo
router.post('/api/archive/photos/upload', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const ext = req.file.mimetype.split('/')[1].replace('jpeg','jpg').replace('quicktime','mov');
  const newName = req.file.filename + '.' + ext;
  const oldPath = req.file.path;
  // Dossier par séance : /uploads/session-{id}-{slug}/
  let subDir = 'misc';
  if (req.body.sessionId) {
    const sid = parseInt(req.body.sessionId);
    const sess = db.prepare('SELECT name, date FROM sessions WHERE id = ?').get(sid);
    if (sess) {
      const slug = (sess.name || 'session').toLowerCase()
        .replace(/[àáâã]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i')
        .replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u').replace(/ç/g,'c')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,30);
      subDir = 'session-' + sid + '-' + slug;
    }
  }
  const dirPath = path.join(__dirname, 'public/uploads', subDir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const newPath = path.join(dirPath, newName);
  fs.renameSync(oldPath, newPath);
  const url = '/uploads/' + subDir + '/' + newName;
  res.json({ ok: true, url, type: req.file.mimetype.startsWith('video/') ? 'video' : 'photo' });
});

// POST /api/sessions/:id/archive/photos — ajouter un media (photo/vidéo)
router.post('/api/sessions/:id/archive/photos', requireAuth, requirePerm('report_media'), (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { url, caption, sort_order, game_id, type, thumbnail } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise' });
  const mediaType = type || (url.match(/youtube|youtu\.be|vimeo/) ? 'video' : 'photo');
  try {
    const r = db.prepare('INSERT INTO archive_media (session_id, url, caption, sort_order, game_id, type, thumbnail) VALUES (?,?,?,?,?,?,?)').run(sessionId, url, caption||'', sort_order||0, game_id||null, mediaType, thumbnail||'');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch(e) {
    console.error('POST archive/photos error:', e.message);
    // Fallback sans thumbnail si colonne absente
    try {
      const r2 = db.prepare('INSERT INTO archive_media (session_id, url, caption, sort_order, game_id, type) VALUES (?,?,?,?,?,?)').run(sessionId, url, caption||'', sort_order||0, game_id||null, mediaType);
      res.json({ ok: true, id: r2.lastInsertRowid });
    } catch(e2) {
      res.status(500).json({ error: e.message });
    }
  }
});

// PATCH /api/archive/photos/reorder — réordonner les médias (DOIT être avant /:id)
router.patch('/api/archive/photos/reorder', requireAuth, (req, res) => {
  const { items } = req.body;
  const upd = db.prepare('UPDATE archive_media SET sort_order=? WHERE id=?');
  db.transaction((list) => list.forEach(m => upd.run(m.sort_order, m.id)))(items);
  res.json({ ok: true });
});

// PATCH /api/archive/photos/:id — modifier caption ou sort_order
router.patch('/api/archive/photos/:id', requireAuth, (req, res) => {
  const { caption, sort_order } = req.body;
  try { db.prepare('UPDATE archive_media SET caption=?, sort_order=? WHERE id=?').run(caption||'', sort_order??0, parseInt(req.params.id)); } catch(e) {}
  res.json({ ok: true });
});

// DELETE /api/archive/photos/:id
router.delete('/api/archive/photos/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  // Récupérer URLs avant suppression pour effacer les fichiers locaux
  let urls = [];
  try { const row = db.prepare('SELECT url, thumbnail FROM archive_media WHERE id = ?').get(id); if (row) { urls.push(row.url); if (row.thumbnail) urls.push(row.thumbnail); } } catch(e) { console.error('SELECT err:', e.message); }
  try { const row = db.prepare('SELECT url FROM archive_photos WHERE id = ?').get(id); if (row) urls.push(row.url); } catch(e) {}
  for (const url of urls) {
    if (url && url.startsWith('/uploads/')) {
      const fp = path.join(__dirname, 'public', url);
      const exists = fs.existsSync(fp);
      try { if (exists) fs.unlinkSync(fp); } catch(e) { console.error('unlink err:', e.message); }
    }
  }
  try { db.prepare('DELETE FROM archive_media WHERE id = ?').run(id); } catch(e) {}
  try { db.prepare('DELETE FROM archive_photos WHERE id = ?').run(id); } catch(e) {}
  res.json({ ok: true });
});

// GET /api/stats — statistiques globales complètes
router.get('/api/stats', (req, res) => {
  const year = req.query.year || null; // null = all-time
  // Jeux les plus joués avec champion par jeu
  const mostPlayed = db.prepare(`
    SELECT game_name, COUNT(*) as nb_parties,
           MAX(thumbnail) as thumbnail,
           (SELECT vainqueur FROM archive_games ag2 JOIN sessions s2 ON s2.id = ag2.session_id
            WHERE LOWER(TRIM(ag2.game_name)) = LOWER(TRIM(ag.game_name))
            AND ag2.vainqueur != '' AND s2.is_archived = 1
            GROUP BY LOWER(TRIM(ag2.vainqueur)) ORDER BY COUNT(*) DESC LIMIT 1) as champion,
           (SELECT COUNT(*) FROM archive_games ag2 JOIN sessions s2 ON s2.id = ag2.session_id
            WHERE LOWER(TRIM(ag2.game_name)) = LOWER(TRIM(ag.game_name))
            AND ag2.vainqueur != '' AND s2.is_archived = 1) as nb_avec_vainqueur
    FROM archive_games ag JOIN sessions s ON s.id = ag.session_id WHERE ag.game_name != '' AND s.is_private = 0 AND s.is_archived = 1 AND (? IS NULL OR strftime('%Y', s.date) = ?)
    GROUP BY LOWER(TRIM(game_name))
    ORDER BY nb_parties DESC LIMIT 20
  `).all(year, year);

  // Stats par joueur : parties jouées, victoires, % victoires, séances
  const allGames = db.prepare(`SELECT ag.*, s.id as sid, s.date as sdate FROM archive_games ag JOIN sessions s ON s.id = ag.session_id WHERE ag.game_name != '' AND s.is_private = 0 AND s.is_archived = 1 AND (? IS NULL OR strftime('%Y', s.date) = ?)`).all(year, year);
  const playerMap = {};
  for (const g of allGames) {
    // Compter les joueurs
    const joueurs = g.joueurs ? g.joueurs.split(',').map(j => j.trim()).filter(Boolean) : [];
    // Si pas de joueurs listés mais vainqueur, on compte juste le vainqueur
    const allPlayers = joueurs.length ? joueurs : (g.vainqueur ? [g.vainqueur] : []);
    const sessions = new Set();
    for (const j of allPlayers) {
      const key = j.toLowerCase().trim();
      if (!playerMap[key]) playerMap[key] = { name: j, parties: 0, victoires: 0, sessions: new Set() };
      playerMap[key].parties++;
      playerMap[key].sessions.add(g.sid);
    }
    if (g.vainqueur) {
      const key = g.vainqueur.toLowerCase().trim();
      if (!playerMap[key]) playerMap[key] = { name: g.vainqueur, parties: 1, victoires: 0, sessions: new Set() };
      playerMap[key].victoires++;
    }
  }
  const playerStats = Object.values(playerMap).map(p => ({
    name: p.name,
    parties: p.parties,
    victoires: p.victoires,
    seances: p.sessions.size,
    pct_victoires: p.parties > 0 ? Math.round(p.victoires / p.parties * 100) : 0
  })).sort((a, b) => b.victoires - a.victoires);

  // Champion par jeu
  const championByGame = db.prepare(`
    SELECT game_name, MAX(thumbnail) as thumbnail, vainqueur,
           COUNT(*) as nb_victoires
    FROM archive_games ag2 JOIN sessions s2 ON s2.id = ag2.session_id WHERE ag2.vainqueur != '' AND ag2.game_name != '' AND s2.is_private = 0 AND s2.is_archived = 1 AND (? IS NULL OR strftime('%Y', s2.date) = ?)
    GROUP BY LOWER(TRIM(ag2.game_name)), LOWER(TRIM(ag2.vainqueur))
    ORDER BY LOWER(TRIM(ag2.game_name)), nb_victoires DESC
  `).all(year, year);
  // Garder seulement le champion (1er) par jeu
  const seen = new Set();
  const champions = championByGame.filter(r => {
    const key = r.game_name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Séances jouées (archivées)
  const seancesInfo = db.prepare(`
    SELECT COUNT(*) as total,
           MIN(date) as premiere,
           MAX(date) as derniere
    FROM sessions WHERE is_archived = 1 AND is_private = 0 AND (? IS NULL OR strftime('%Y', date) = ?)
  `).get(year, year);

  // Jeux votés mais jamais joués
  const voted = db.prepare(`
    SELECT LOWER(TRIM(p.name)) as nom, p.name, COUNT(DISTINCT r.session_id) as nb_votes,
           MAX(p.thumbnail) as thumbnail
    FROM proposals p JOIN rankings r ON r.proposal_id = p.id
    GROUP BY LOWER(TRIM(p.name))
  `).all();
  const played = new Set(db.prepare('SELECT LOWER(TRIM(ag.game_name)) as nom FROM archive_games ag JOIN sessions s ON s.id = ag.session_id WHERE s.is_archived = 1').all().map(g => g.nom));
  const neverPlayed = voted.filter(g => !played.has(g.nom)).sort((a,b) => b.nb_votes - a.nb_votes).slice(0,10);

  // Classement par jeu — parser les scores texte "Alice: 87, Bob: 72"
  const allGamesWithScores = db.prepare(`SELECT ag.game_name, ag.scores, ag.vainqueur, ag.thumbnail FROM archive_games ag JOIN sessions s ON s.id = ag.session_id WHERE ag.game_name != '' AND ag.scores != '' AND s.is_private = 0 AND s.is_archived = 1`).all();
  const gameScoreMap = {};
  for (const g of allGamesWithScores) {
    const key = g.game_name.toLowerCase().trim();
    if (!gameScoreMap[key]) gameScoreMap[key] = { game_name: g.game_name, thumbnail: g.thumbnail || '', players: {} };
    // Parser "Alice: 87, Bob: 72" ou "Alice: 87pts, Bob: 72"
    const parts = g.scores.split(',');
    for (const part of parts) {
      const m = part.trim().match(/^(.+?):\s*([\d\.]+)/);
      if (m) {
        const name = m[1].trim();
        const score = parseFloat(m[2]);
        const pkey = name.toLowerCase();
        if (!gameScoreMap[key].players[pkey]) gameScoreMap[key].players[pkey] = { name, scores: [], wins: 0 };
        gameScoreMap[key].players[pkey].scores.push(score);
      }
    }
    // Compter les victoires
    if (g.vainqueur) {
      const pkey = g.vainqueur.toLowerCase().trim();
      if (!gameScoreMap[key].players[pkey]) gameScoreMap[key].players[pkey] = { name: g.vainqueur, scores: [], wins: 0 };
      gameScoreMap[key].players[pkey].wins++;
    }
  }
  const gameRankings = Object.values(gameScoreMap).map(g => ({
    game_name: g.game_name,
    thumbnail: g.thumbnail,
    players: Object.values(g.players).map(p => ({
      name: p.name,
      best: Math.max(...p.scores),
      avg: Math.round(p.scores.reduce((a,b) => a+b, 0) / p.scores.length * 10) / 10,
      nb_parties: p.scores.length,
      wins: p.wins
    })).sort((a, b) => b.best - a.best)
  })).filter(g => g.players.length > 0)
    .sort((a, b) => a.game_name.localeCompare(b.game_name));

  // Liste des années disponibles
  const years = db.prepare(`SELECT DISTINCT strftime('%Y', s.date) as y FROM sessions s WHERE s.is_private = 0 AND s.is_archived = 1 ORDER BY y DESC`).all().map(r => r.y);

  res.json({ mostPlayed, playerStats, champions, seancesInfo, neverPlayed, gameRankings, years, currentYear: year });
});

// GET /archive — page publique archives + stats
router.get('/archive', (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*, sa.compte_rendu,
      (SELECT COUNT(*) FROM archive_games ag WHERE ag.session_id = s.id) as nb_jeux,
      (SELECT COUNT(*) FROM archive_photos ap WHERE ap.session_id = s.id) as nb_photos
    FROM sessions s
    LEFT JOIN session_archive sa ON sa.session_id = s.id
    WHERE s.is_private = 0 AND EXISTS (SELECT 1 FROM archive_games WHERE session_id = s.id)
    ORDER BY s.date DESC, s.id DESC
  `).all();

  const stats = (() => {
    const mostPlayed = db.prepare(`SELECT ag.game_name, COUNT(*) as nb FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name!='' AND s.is_archived=1 GROUP BY LOWER(TRIM(ag.game_name)) ORDER BY nb DESC LIMIT 5`).all();
    const champions = db.prepare(`SELECT ag.vainqueur, COUNT(*) as nb FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.vainqueur!='' AND s.is_archived=1 GROUP BY LOWER(TRIM(ag.vainqueur)) ORDER BY nb DESC LIMIT 5`).all();
    return { mostPlayed, champions };
  })();

  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const sessionsHtml = sessions.map(s => {
    const games = db.prepare('SELECT * FROM archive_games WHERE session_id = ? ORDER BY sort_order').all(s.id);
    const photos = db.prepare('SELECT * FROM archive_photos WHERE session_id = ? ORDER BY sort_order').all(s.id);
    const gamesHtml = games.map(g => `
      <div class="ag-item">
        ${g.thumbnail ? `<img class="ag-thumb" src="${esc(g.thumbnail)}" alt="" onerror="this.style.display='none'">` : '<div class="ag-thumb-ph">🎲</div>'}
        <div class="ag-info">
          <div class="ag-name">${esc(g.game_name)}</div>
          ${g.vainqueur ? `<div class="ag-win">🏆 ${esc(g.vainqueur)}</div>` : ''}
          ${g.scores ? `<div class="ag-scores">${esc(g.scores)}</div>` : ''}
        </div>
      </div>`).join('');
    const photosHtml = photos.map(p => `
      <a href="${esc(p.url)}" target="_blank" class="photo-link">
        <img src="${esc(p.url)}" alt="${esc(p.caption)}" class="photo-thumb" onerror="this.style.display='none'">
        ${p.caption ? `<div class="photo-caption">${esc(p.caption)}</div>` : ''}
      </a>`).join('');

    return `<div class="session-block">
      <div class="session-header">
        <div style="flex:1">
          <div class="session-title">🎲 ${esc(s.name)}</div>
          <div class="session-date">${esc(s.date||'')} · ${games.length} jeu${games.length!==1?'x':''} joué${games.length!==1?'s':''}</div>
        </div>
        <a href="/archive/${s.id}" class="session-link">Voir la page →</a>
      </div>
      ${games.length ? `<div class="games-grid">${gamesHtml}</div>` : ''}
      ${s.compte_rendu ? `<div class="cr-block">📝 ${esc(s.compte_rendu)}</div>` : ''}
      ${photos.length ? `<div class="photos-grid">${photosHtml}</div>` : ''}
    </div>`;
  }).join('');

  const statsHtml = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">🎲 Jeux les plus joués</div>
        ${stats.mostPlayed.map(g => `<div class="stat-item"><span class="stat-name">${esc(g.game_name)}</span><span class="stat-val">${g.nb}×</span></div>`).join('') || '<div class="stat-empty">Pas encore de données</div>'}
      </div>
      <div class="stat-card">
        <div class="stat-title">🏆 Champions</div>
        ${stats.champions.map(g => `<div class="stat-item"><span class="stat-name">${esc(g.vainqueur)}</span><span class="stat-val">${g.nb} victoire${g.nb>1?'s':''}</span></div>`).join('') || '<div class="stat-empty">Pas encore de données</div>'}
      </div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archives — GameDay</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
a{text-decoration:none;color:inherit}
:root,[data-theme="light"]{--bg:#e0d9ce;--card:#ece6db;--card2:#d8d2c6;--text:#1a1a2e;--text2:#555;--text3:#888;--accent:#4a6fa5;--accent2:#8b6f47;--border:#c8c2b6;}
[data-theme="dark"]{--bg:#0f0e0b;--card:#1a1814;--card2:#222019;--text:#e8e4d8;--text2:#a09880;--text3:#666;--accent:#8ba3c7;--accent2:#c8a060;--border:#2a2820;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px 16px;max-width:800px;margin:0 auto}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
h1{font-size:1.6rem;color:var(--text)}
.theme-btn{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:.85rem;color:var(--text)}
h2{font-size:1rem;font-weight:600;color:var(--text);margin:24px 0 12px}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.stat-title{font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em}
.stat-item{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.8rem}
.stat-item:last-child{border:none}
.stat-name{color:var(--text)}
.stat-val{color:var(--accent2);font-weight:600;font-size:.75rem}
.stat-empty{font-size:.75rem;color:var(--text3);font-style:italic}
.session-block{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px}
.session-link{background:var(--accent);color:#fff;text-decoration:none;padding:6px 14px;border-radius:8px;font-size:.8rem;font-weight:600;flex-shrink:0;margin-left:12px;}
.session-header{margin-bottom:12px}
.session-title{font-size:1rem;font-weight:700;color:var(--text)}
.session-date{font-size:.75rem;color:var(--text2);margin-top:2px}
.games-grid{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.ag-item{display:flex;gap:10px;align-items:center;background:var(--card2);border-radius:8px;padding:7px 10px}
.ag-thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0}
.ag-thumb-ph{width:36px;height:36px;border-radius:6px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
.ag-info{flex:1;min-width:0}
.ag-name{font-size:.82rem;font-weight:600;color:var(--text)}
.ag-win{font-size:.72rem;color:var(--accent2);margin-top:1px}
.ag-scores{font-size:.7rem;color:var(--text3);margin-top:1px}
.cr-block{font-size:.78rem;color:var(--text2);background:var(--card2);border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.5;white-space:pre-wrap}
.photos-grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.photo-link{display:flex;flex-direction:column;align-items:center;gap:4px;text-decoration:none}
.photo-thumb{width:100px;height:80px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
.photo-caption{font-size:.65rem;color:var(--text3);max-width:100px;text-align:center}
@media(max-width:500px){.stats-grid{grid-template-columns:1fr}.photo-thumb{width:80px;height:64px}}
</style>
</head>
<body>
<div class="topbar">
  <h1>📚 Archives GameDay</h1>
  <button class="theme-btn" onclick="toggleTheme()" id="themeBtn">🌙 Sombre</button>
</div>
<h2>Statistiques</h2>
${statsHtml}
<h2>Séances</h2>
${sessionsHtml || '<p style="color:var(--text3);font-size:.85rem">Aucune archive pour l&#39;instant.</p>'}
<p style="font-size:.7rem;color:var(--text3);margin-top:24px;text-align:center">GameDay · pandagaming.ch</p>
<script>
function toggleTheme(){const h=document.documentElement,d=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',d?'light':'dark');document.getElementById('themeBtn').textContent=d?'🌙 Sombre':'☀️ Clair';localStorage.setItem('gd_arch_theme',d?'light':'dark');}
const s=localStorage.getItem('gd_arch_theme');if(s){document.documentElement.setAttribute('data-theme',s);document.getElementById('themeBtn').textContent=s==='dark'?'☀️ Clair':'🌙 Sombre';}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /photo/:filename — lightbox page pour les images
router.get('/photo/:filename', (req, res) => {
  const fn = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const url = '/uploads/' + fn;
  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo — GameDay</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#0f0e0b;display:flex;align-items:center;justify-content:center;flex-direction:column;}
img{max-width:100vw;max-height:90vh;object-fit:contain;display:block;}
.close{position:fixed;top:12px;right:16px;color:#aaa;font-size:1.8rem;cursor:pointer;text-decoration:none;line-height:1;}
.close:hover{color:#fff;}
</style>
</head>
<body>
<a class="close" onclick="window.close()" href="javascript:history.back()">×</a>
<img src="${url}" alt="Photo GameDay">
</body>
</html>`);
});

// GET /stats — page publique statistiques
router.get('/stats', (req, res) => {
  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const mostPlayed = db.prepare(`SELECT game_name, COUNT(*) as nb, MAX(thumbnail) as thumbnail,
    (SELECT ag2.vainqueur FROM archive_games ag2 JOIN sessions s2 ON s2.id=ag2.session_id WHERE LOWER(TRIM(ag2.game_name))=LOWER(TRIM(ag.game_name)) AND ag2.vainqueur!='' AND s2.is_archived=1 GROUP BY LOWER(TRIM(ag2.vainqueur)) ORDER BY COUNT(*) DESC LIMIT 1) as champion
    FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name!='' AND s.is_archived=1 GROUP BY LOWER(TRIM(ag.game_name)) ORDER BY nb DESC LIMIT 10`).all();

  const allGames = db.prepare(`SELECT ag.* FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name != '' AND s.is_archived=1`).all();
  const playerMap = {};
  for (const g of allGames) {
    const joueurs = g.joueurs ? g.joueurs.split(',').map(j=>j.trim()).filter(Boolean) : (g.vainqueur ? [g.vainqueur] : []);
    for (const j of joueurs) {
      const key = j.toLowerCase().trim();
      if (!playerMap[key]) playerMap[key] = { name: j, parties: 0, victoires: 0 };
      playerMap[key].parties++;
    }
    if (g.vainqueur) {
      const key = g.vainqueur.toLowerCase().trim();
      if (!playerMap[key]) playerMap[key] = { name: g.vainqueur, parties: 1, victoires: 0 };
      playerMap[key].victoires++;
    }
  }
  const players = Object.values(playerMap).map(p => ({
    ...p, pct: p.parties > 0 ? Math.round(p.victoires/p.parties*100) : 0
  })).sort((a,b) => b.victoires - a.victoires).slice(0, 10);

  const seancesInfo = db.prepare(`SELECT COUNT(*) as total, MIN(date) as premiere, MAX(date) as derniere FROM sessions WHERE is_archived=1`).get();
  const totalParties = allGames.length;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statistiques — GameDay</title>
<link rel="icon" type="image/png" href="/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#1a1917;--surface:#242220;--surface2:#2c2a27;--border:#3a3835;--text:#f0ece4;--text-muted:#8a857c;--accent:#c17d3c;--accent2:#8fba6a;--radius:10px;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);padding:20px;max-width:800px;margin:0 auto;}
h1{font-family:'Fraunces',serif;font-size:2rem;margin-bottom:4px;}
.sub{color:var(--text-muted);font-size:.82rem;margin-bottom:28px;}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:28px;}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;text-align:center;}
.kpi-val{font-family:'Fraunces',serif;font-size:1.8rem;color:var(--accent);}
.kpi-label{font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
h2{font-family:'Fraunces',serif;font-size:1.1rem;margin:24px 0 10px;}
table{width:100%;border-collapse:collapse;font-size:.82rem;background:var(--surface);border-radius:var(--radius);overflow:hidden;}
th{text-align:left;padding:8px 12px;border-bottom:2px solid var(--border);color:var(--text-muted);font-size:.68rem;text-transform:uppercase;letter-spacing:1px;}
td{padding:8px 12px;border-bottom:1px solid var(--border);}
tr:last-child td{border-bottom:none;}
.bar-wrap{display:flex;align-items:center;gap:8px;}
.bar{height:5px;background:var(--accent);border-radius:3px;min-width:2px;}
.game-row{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px;}
.game-thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;}
.game-info{flex:1;}
.game-name{font-weight:600;font-size:.85rem;}
.game-meta{font-size:.7rem;color:var(--text-muted);}
.game-champ{font-size:.7rem;color:var(--accent2);}
.theme-toggle{position:fixed;top:16px;right:16px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:6px 12px;cursor:pointer;color:var(--text);font-size:.8rem;}
.light{--bg:#e0d9ce;--surface:#ece6db;--surface2:#dcd6c8;--border:#c8c0b0;--text:#2a2520;--text-muted:#7a7068;}
</style>
</head>
<body>
<button class="theme-toggle" onclick="document.body.classList.toggle('light')">🌙 Thème</button>
<h1>📊 Statistiques</h1>
<div class="sub">GameDay · Panda Gaming</div>

<div class="kpis">
  <div class="kpi"><div class="kpi-val">${seancesInfo?.total||0}</div><div class="kpi-label">Séances</div></div>
  <div class="kpi"><div class="kpi-val">${totalParties}</div><div class="kpi-label">Parties</div></div>
  <div class="kpi"><div class="kpi-val">${mostPlayed.length}</div><div class="kpi-label">Jeux</div></div>
  <div class="kpi"><div class="kpi-val">${players.length}</div><div class="kpi-label">Joueurs</div></div>
</div>

<h2>🏆 Classement joueurs</h2>
<table>
  <thead><tr><th>#</th><th>Joueur</th><th>Parties</th><th>Victoires</th><th>% Victoires</th></tr></thead>
  <tbody>
    ${players.map((p,i) => `<tr>
      <td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${p.parties}</td>
      <td>${p.victoires}</td>
      <td><div class="bar-wrap"><div class="bar" style="width:${p.pct}px"></div>${p.pct}%</div></td>
    </tr>`).join('')}
  </tbody>
</table>

<h2>🎲 Jeux les plus joués</h2>
${mostPlayed.map((g,i) => `<div class="game-row">
  ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" class="game-thumb" onerror="this.style.display='none'">` : ''}
  <div class="game-info">
    <div class="game-name">${esc(g.game_name)}</div>
    <div class="game-meta">${g.nb} partie${g.nb>1?'s':''}</div>
    ${g.champion ? `<div class="game-champ">🏆 ${esc(g.champion)}</div>` : ''}
  </div>
  <div style="font-size:1.1rem">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div>
</div>`).join('')}
</body>
</html>`);
});


module.exports = router;
