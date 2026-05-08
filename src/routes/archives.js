// ─────────────────────────────────────────────────────────────
// routes/archives.js — Compte-rendu, médias, scores et stats
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const upload = require('../upload');
const fs = require('fs');
const path = require('path');

// ── ARCHIVES ─────────────────────────────────────────────────

// GET /archive/:sessionId — page publique archive d'une séance (sans auth)
router.get('/archive/:sessionId', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const session = await db.get('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (!session) return res.status(404).send('<h1>Archive introuvable</h1>');

  const archive = null; // session_archive supprimée en v5, CRs dans archive_user_cr
  const games = await db.all('SELECT * FROM archive_games WHERE session_id = $1 ORDER BY sort_order', [sessionId]);
  let allMedia = [];
  try {
    allMedia = await db.all('SELECT * FROM archive_media WHERE session_id = $1 AND is_public != 0 ORDER BY sort_order', [sessionId]);
  } catch(e) {
    allMedia = await db.all('SELECT *, \'photo\' as type FROM archive_photos WHERE session_id = $1 ORDER BY sort_order', [sessionId]);
  }

  // Charger les CR par utilisateur (séance)
  let userCRs = [];
  try {
    userCRs = await db.all(`
      SELECT cr.content, cr.updated_at, u.username
      FROM archive_user_cr cr JOIN users u ON u.id = cr.user_id
      WHERE cr.session_id = $1 AND cr.content != ''
    `, [sessionId]);
  } catch(e) {}

  // Charger les CR par utilisateur (par jeu)
  let gameCRs = [];
  try {
    if (games.length) {
      const ids = games.map(g => g.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      gameCRs = await db.all(`
        SELECT cr.game_id, cr.content, cr.updated_at, u.username
        FROM archive_game_cr cr JOIN users u ON u.id = cr.user_id
        WHERE cr.game_id IN (${placeholders}) AND cr.content != ''
      `, ids);
    }
  } catch(e) {}

  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function sortScoresDesc(scoresStr) {
    if (!scoresStr || !scoresStr.trim()) return '';
    const parts = scoresStr.split(',').map(s => s.trim()).filter(Boolean);
    const parsed = parts.map(p => {
      const m = p.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)$/);
      return m ? { name: m[1].trim(), score: parseFloat(m[2]), raw: p } : { name: p, score: -Infinity, raw: p };
    });
    parsed.sort((a, b) => b.score - a.score);
    return parsed.map(p => p.raw).join(', ');
  }

  function renderCRContent(text) {
    if (!text) return '';
    return esc(text).replace(/!\[gif\]\((https?:\/\/[^)]+)\)/g,
      '<img src="$1" alt="gif" style="max-width:200px;max-height:150px;border-radius:6px;display:block;margin:4px 0">');
  }

  function mediaHtml(items, height='200px') {
    return items.map((m) => {
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

  const sessionMedia = allMedia.filter(m => !m.game_id);
  const userCRsHtml = userCRs.length
    ? `<div class="notes-box"><div class="notes-label">📝 Comptes-rendus</div>${userCRs.map(cr => `
        <div class="user-cr">
          <div class="user-cr-author">👤 ${esc(cr.username)}</div>
          <div class="notes-text">${renderCRContent(cr.content)}</div>
        </div>`).join('')}</div>` : '';
  const notesHtml = archive?.compte_rendu
    ? `<div class="notes-box"><div class="notes-label">📝 Notes générales</div><div class="notes-text">${renderCRContent(archive.compte_rendu)}</div></div>` : '';
  const sessionMediaHtml = sessionMedia.length
    ? `<div class="media-row">${mediaHtml(sessionMedia)}</div>` : '';

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
      ${g.compte_rendu ? `<div class="game-cr">${renderCRContent(g.compte_rendu)}</div>` : ''}
      ${gameCRs.filter(cr => cr.game_id === g.id).map(cr => `
        <div class="game-cr-user">
          <span class="user-cr-author">👤 ${esc(cr.username)}</span>
          <span class="game-cr-text">${renderCRContent(cr.content)}</span>
        </div>`).join('')}
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
:root,[data-theme="light"]{--bg:#e0d9ce;--card:#ece6db;--card2:#d8d2c6;--text:#1a1a2e;--text2:#4a4a6a;--text3:#888;--accent:#4a6fa5;--border:#c8c2b6;}
[data-theme="dark"]{--bg:#0f0e0b;--card:#1a1814;--card2:#222019;--text:#e8e4d8;--text2:#a09880;--text3:#666;--accent:#8ba3c7;--border:#2a2820;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px 16px;max-width:720px;margin:0 auto}
.notes-box{background:var(--card);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px}
.notes-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:6px}
.notes-text{font-size:.88rem;line-height:1.65;color:var(--text2);white-space:pre-wrap}
.user-cr{margin-top:10px;padding-top:8px;border-top:1px solid var(--border)}
.user-cr:first-child{margin-top:0;padding-top:0;border-top:none}
.user-cr-author{font-size:.75rem;font-weight:600;color:var(--accent);margin-bottom:4px}
.game-cr-user{margin-top:10px;padding:10px 14px;background:var(--card2);border-radius:8px;font-size:.85rem}
.game-cr-text{display:block;margin-top:6px;line-height:1.6;color:var(--text2);white-space:pre-wrap}
.media-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.media-thumb-wrap{position:relative;}
.media-play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);color:#fff;font-size:2rem;border-radius:8px;transition:background .15s;}
.media-thumb-wrap:hover .media-play-overlay{background:rgba(0,0,0,.5);}
.media-item{flex:0 0 auto;width:calc(33.333% - 6px);display:flex;flex-direction:column;}
.media-item img{width:100%;border-radius:8px;object-fit:cover;aspect-ratio:4/3;display:block;cursor:zoom-in;transition:opacity .15s}
.media-item img:hover{opacity:.88}
.video-item{width:100%}
.media-leg{font-size:.72rem;color:var(--text2);margin-top:5px;text-align:center;font-style:italic;line-height:1.3;}
.games-title{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:12px}
.game-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px}
.game-header{display:flex;gap:12px;align-items:flex-start;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--border)}
.game-thumb{width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0}
.game-thumb-ph{width:56px;height:56px;border-radius:8px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0}
.game-name{font-size:1rem;font-weight:700;line-height:1.2}
.game-win{font-size:.78rem;color:var(--accent);font-weight:600;margin-top:4px}
.game-meta{font-size:.72rem;color:var(--text3);margin-top:3px}
.game-cr{font-size:.85rem;color:var(--text2);line-height:1.65;margin-bottom:14px;white-space:pre-wrap}
.game-card .media-row{margin-top:16px;margin-bottom:0;padding-top:14px;border-top:1px dashed var(--border)}
@media(max-width:480px){.media-item{width:calc(50% - 4px)}}
</style>
</head>
<body>
<nav style="position:sticky;top:0;z-index:100;background:var(--card);border-bottom:1px solid var(--border);padding:0 16px;margin-bottom:24px;">
  <div style="max-width:720px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:10px 0;">
    <a href="/" style="font-size:1.3rem;font-weight:700;color:var(--text);text-decoration:none">Game<em style="font-weight:300;font-style:italic;opacity:.6">Day</em></a>
    <div style="display:flex;gap:8px;align-items:center">
      <a href="/" style="font-size:.72rem;border:1px solid var(--border);border-radius:6px;padding:4px 10px;color:var(--text2);text-decoration:none">🏠 Accueil</a>
      <button onclick="toggleTheme()" id="themeBtn" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:.85rem;">🌙</button>
    </div>
  </div>
</nav>
<div style="margin-bottom:20px">
  <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:4px">📚 ${esc(session.name)}</h1>
  <div style="color:var(--text3);font-size:.85rem">${esc(session.date || '')}</div>
</div>

${userCRsHtml}
${notesHtml}
${sessionMediaHtml}
${gamesHtml ? `<div class="games-title">Comptes rendus par jeu</div>${gamesHtml}` : ''}
${!hasContent ? '<p style="color:var(--text3);font-size:.85rem;font-style:italic">Aucun contenu pour cette séance.</p>' : ''}

<p style="font-size:.68rem;color:var(--text3);margin-top:28px;text-align:center">GameDay · pandagaming.ch</p>
<div id="lightbox" onclick="closeLb()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:10px">
  <button id="lbPrev" onclick="lbPrev(event)" style="display:none;position:fixed;left:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#fff;cursor:pointer;z-index:10001;padding:12px"><svg width="60" height="60" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <img id="lightboxImg" src="" style="max-width:80vw;max-height:82vh;border-radius:8px;display:none">
  <iframe id="lightboxIframe" src="" frameborder="0" allowfullscreen style="display:none;width:80vw;max-width:900px;height:50vw;max-height:506px;border-radius:8px" onclick="event.stopPropagation()"></iframe>
  <video id="lightboxVid" src="" controls playsinline style="display:none;max-width:80vw;max-height:82vh;border-radius:8px" onclick="event.stopPropagation()"></video>
  <div id="lbCaption" style="color:#ccc;font-size:.85rem;text-align:center;max-width:80vw"></div>
  <div id="lbCounter" style="color:#888;font-size:.72rem"></div>
  <button id="lbNext" onclick="lbNext(event)" style="display:none;position:fixed;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#fff;cursor:pointer;z-index:10001;padding:12px"><svg width="60" height="60" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</div>
<script>
var _lbItems=[],_lbIdx=0;
function _collectMedia(){var items=[];document.querySelectorAll('.media-item[data-lburl]').forEach(function(el){var cap=el.querySelector('.media-leg');items.push({url:el.dataset.lburl,mode:el.dataset.lbmode||'img',caption:cap?cap.textContent:''});});return items;}
function openLightbox(url,mode){_lbItems=_collectMedia();if(_lbItems.length===0)_lbItems=[{url:url,mode:mode,caption:''}];_lbIdx=_lbItems.findIndex(function(it){return it.url===url;});if(_lbIdx<0)_lbIdx=0;_lbShow();document.getElementById('lightbox').style.display='flex';}
function _lbShow(){var it=_lbItems[_lbIdx];var img=document.getElementById('lightboxImg');var ifr=document.getElementById('lightboxIframe');var vid=document.getElementById('lightboxVid');img.style.display='none';ifr.style.display='none';ifr.src='';vid.pause&&vid.pause();vid.style.display='none';vid.src='';if(it.mode==='embed'){ifr.src=it.url;ifr.style.display='block';}else if(it.mode==='mp4'||it.url.match(/\.mp4|\.webm|\.mov/i)){vid.src=it.url;vid.style.display='block';}else{img.src=it.url;img.style.display='block';}document.getElementById('lbCaption').textContent=it.caption||'';document.getElementById('lbCounter').textContent=_lbItems.length>1?(_lbIdx+1)+' / '+_lbItems.length:'';document.getElementById('lbPrev').style.display=_lbIdx>0?'flex':'none';document.getElementById('lbNext').style.display=_lbIdx<_lbItems.length-1?'flex':'none';}
function lbPrev(e){e.stopPropagation();if(_lbIdx>0){_lbIdx--;_lbShow();}}
function lbNext(e){e.stopPropagation();if(_lbIdx<_lbItems.length-1){_lbIdx++;_lbShow();}}
function closeLb(){document.getElementById('lightboxIframe').src='';var v=document.getElementById('lightboxVid');v.pause&&v.pause();v.src='';document.getElementById('lightbox').style.display='none';}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')lbPrev(e);if(e.key==='ArrowRight')lbNext(e);});
function toggleTheme(){const h=document.documentElement,dark=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',dark?'light':'dark');document.getElementById('themeBtn').textContent=dark?'🌙':'☀️';localStorage.setItem('gd_arch_theme',dark?'light':'dark');}
const t=localStorage.getItem('gd_arch_theme');if(t){document.documentElement.setAttribute('data-theme',t);document.getElementById('themeBtn').textContent=t==='dark'?'☀️':'🌙';}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /api/sessions/:id/archive
router.get('/api/sessions/:id/archive', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const games = await db.all('SELECT * FROM archive_games WHERE session_id = $1 ORDER BY sort_order', [sessionId]);
  const allMedia = await db.all('SELECT * FROM archive_media WHERE session_id = $1 ORDER BY sort_order', [sessionId]);
  const gamesWithMedia = games.map(g => ({ ...g, photos: allMedia.filter(m => m.game_id === g.id) }));
  const sessionMedia = allMedia.filter(m => !m.game_id);

  let userCRs = [], gameCRs = [];
  userCRs = await db.all(`
    SELECT cr.session_id, cr.user_id, cr.content, cr.updated_at, u.username
    FROM archive_user_cr cr JOIN users u ON u.id = cr.user_id
    WHERE cr.session_id = $1
  `, [sessionId]);
  if (games.length) {
    const ids = games.map(g => g.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    gameCRs = await db.all(`
      SELECT cr.game_id, cr.user_id, cr.content, cr.updated_at, u.username
      FROM archive_game_cr cr JOIN users u ON u.id = cr.user_id
      WHERE cr.game_id IN (${placeholders})
    `, ids);
  }
  res.json({ archive: null, games: gamesWithMedia, photos: sessionMedia, userCRs, gameCRs });
});

// POST /api/sessions/:id/archive
router.post('/api/sessions/:id/archive', requireAuth, requirePerm('report_notes'), async (req, res) => {
  res.json({ ok: true });
});

// POST /api/sessions/:id/archive/games
router.post('/api/sessions/:id/archive/games', requireAuth, requirePerm('report_scores'), async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { game_name, bgg_id, thumbnail, vainqueur, scores, sort_order, joueurs, compte_rendu } = req.body;
  if (!game_name) return res.status(400).json({ error: 'Nom requis' });
  const r = await db.run(
    'INSERT INTO archive_games (session_id, game_name, bgg_id, thumbnail, vainqueur, scores, sort_order, joueurs, compte_rendu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [sessionId, game_name, bgg_id||'', thumbnail||'', vainqueur||'', scores||'', sort_order||0, joueurs||'', compte_rendu||'']
  );
  res.json({ ok: true, id: r.lastInsertRowid });
});

// PATCH /api/archive/games/:id
router.patch('/api/archive/games/:id', requireAuth, async (req, res) => {
  const { game_name, bgg_id, thumbnail, vainqueur, scores, joueurs, compte_rendu } = req.body;
  await db.run(
    `UPDATE archive_games SET game_name=$1, bgg_id=$2, thumbnail=$3, vainqueur=$4, scores=$5, joueurs=$6, compte_rendu=$7 WHERE id=$8`,
    [game_name||'', bgg_id||'', thumbnail||'', vainqueur||'', scores||'', joueurs||'', compte_rendu||'', parseInt(req.params.id)]
  );
  res.json({ ok: true });
});

// DELETE /api/archive/games/:id
router.delete('/api/archive/games/:id', requireAuth, async (req, res) => {
  await db.run('DELETE FROM archive_games WHERE id = $1', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// POST /api/archive/photos/upload
router.post('/api/archive/photos/upload', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const ext = req.file.mimetype.split('/')[1].replace('jpeg','jpg').replace('quicktime','mov');
  const newName = req.file.filename + '.' + ext;
  const oldPath = req.file.path;
  let subDir = 'misc';
  if (req.body.sessionId) {
    const sid = parseInt(req.body.sessionId);
    const sess = await db.get('SELECT name, date FROM sessions WHERE id = $1', [sid]);
    if (sess) {
      const slug = (sess.name || 'session').toLowerCase()
        .replace(/[àáâã]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i')
        .replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u').replace(/ç/g,'c')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,30);
      subDir = 'session-' + sid + '-' + slug;
    }
  }
  const dirPath = path.join(__dirname, '..', '..', 'public', 'uploads', subDir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const newPath = path.join(dirPath, newName);
  try { fs.renameSync(oldPath, newPath); } catch(e) { fs.copyFileSync(oldPath, newPath); fs.unlinkSync(oldPath); }
  const url = '/uploads/' + subDir + '/' + newName;
  res.json({ ok: true, url, type: req.file.mimetype.startsWith('video/') ? 'video' : 'photo' });
});

// POST /api/sessions/:id/archive/photos
router.post('/api/sessions/:id/archive/photos', requireAuth, requirePerm('report_media'), async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { url, caption, sort_order, game_id, type, thumbnail } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise' });
  const mediaType = type || (url.match(/youtube|youtu\.be|vimeo/) ? 'video' : 'photo');
  const r = await db.run(
    'INSERT INTO archive_media (session_id, url, caption, sort_order, game_id, type, thumbnail) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [sessionId, url, caption||'', sort_order||0, game_id||null, mediaType, thumbnail||'']
  );
  res.json({ ok: true, id: r.lastInsertRowid });
});

// PATCH /api/archive/photos/reorder (DOIT être avant /:id)
router.patch('/api/archive/photos/reorder', requireAuth, async (req, res) => {
  const { items } = req.body;
  await db.transaction(async (client) => {
    for (const m of (items || [])) {
      await client.query('UPDATE archive_media SET sort_order=$1 WHERE id=$2', [m.sort_order, m.id]);
    }
  });
  res.json({ ok: true });
});

// PATCH /api/archive/photos/:id
router.patch('/api/archive/photos/:id', requireAuth, async (req, res) => {
  const { caption, sort_order, is_public } = req.body;
  const id = parseInt(req.params.id);
  if (is_public !== undefined) {
    await db.run('UPDATE archive_media SET is_public=$1 WHERE id=$2', [is_public ? 1 : 0, id]);
  }
  await db.run('UPDATE archive_media SET caption=$1, sort_order=$2 WHERE id=$3', [caption||'', sort_order??0, id]);
  res.json({ ok: true });
});

// DELETE /api/archive/photos/:id
router.delete('/api/archive/photos/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const row = await db.get('SELECT url, thumbnail FROM archive_media WHERE id = $1', [id]);
  if (row) {
    for (const url of [row.url, row.thumbnail].filter(Boolean)) {
      if (url.startsWith('/uploads/')) {
        const fp = path.join(__dirname, '..', '..', 'public', url);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
      }
    }
  }
  await db.run('DELETE FROM archive_media WHERE id = $1', [id]);
  res.json({ ok: true });
});

// GET /api/stats
router.get('/api/stats', async (req, res) => {
  const year = req.query.year || null;
  const yearFilter = year ? `AND EXTRACT(YEAR FROM s.date::date)::text = '${year}'` : '';
  const yearFilter2 = year ? `AND EXTRACT(YEAR FROM s2.date::date)::text = '${year}'` : '';

  const mostPlayed = await db.all(`
    SELECT ag.game_name, COUNT(*) as nb_parties, MAX(ag.thumbnail) as thumbnail,
      (SELECT ag2.vainqueur FROM archive_games ag2 JOIN sessions s2 ON s2.id = ag2.session_id
       WHERE LOWER(TRIM(ag2.game_name)) = LOWER(TRIM(ag.game_name))
       AND ag2.vainqueur != '' AND s2.is_archived = 1 ${yearFilter2}
       GROUP BY ag2.vainqueur ORDER BY COUNT(*) DESC LIMIT 1) as champion
    FROM archive_games ag JOIN sessions s ON s.id = ag.session_id
    WHERE ag.game_name != '' AND s.is_private = 0 AND s.is_archived = 1 ${yearFilter}
    GROUP BY LOWER(TRIM(ag.game_name)), ag.game_name
    ORDER BY nb_parties DESC LIMIT 20
  `);

  const allGames = await db.all(`
    SELECT ag.*, s.id as sid, s.date as sdate
    FROM archive_games ag JOIN sessions s ON s.id = ag.session_id
    WHERE ag.game_name != '' AND s.is_private = 0 AND s.is_archived = 1 ${yearFilter}
  `);

  const playerMap = {};
  for (const g of allGames) {
    const joueurs = g.joueurs ? g.joueurs.split(',').map(j => j.trim()).filter(Boolean) : [];
    const allPlayers = joueurs.length ? joueurs : (g.vainqueur ? [g.vainqueur] : []);
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
    name: p.name, parties: p.parties, victoires: p.victoires, seances: p.sessions.size,
    pct_victoires: p.parties > 0 ? Math.round(p.victoires / p.parties * 100) : 0
  })).sort((a, b) => b.victoires - a.victoires);

  const championByGame = await db.all(`
    SELECT ag2.game_name, MAX(ag2.thumbnail) as thumbnail, ag2.vainqueur, COUNT(*) as nb_victoires
    FROM archive_games ag2 JOIN sessions s2 ON s2.id = ag2.session_id
    WHERE ag2.vainqueur != '' AND ag2.game_name != '' AND s2.is_private = 0 AND s2.is_archived = 1 ${yearFilter2}
    GROUP BY LOWER(TRIM(ag2.game_name)), ag2.game_name, LOWER(TRIM(ag2.vainqueur)), ag2.vainqueur
    ORDER BY LOWER(TRIM(ag2.game_name)), nb_victoires DESC
  `);
  const seen = new Set();
  const champions = championByGame.filter(r => {
    const key = r.game_name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const seancesInfo = await db.get(`
    SELECT COUNT(*) as total, MIN(date) as premiere, MAX(date) as derniere
    FROM sessions WHERE is_archived = 1 AND is_private = 0 ${yearFilter}
  `);

  const voted = await db.all(`
    SELECT LOWER(TRIM(p.name)) as nom, p.name, COUNT(DISTINCT r.session_id) as nb_votes, MAX(p.thumbnail) as thumbnail
    FROM proposals p JOIN rankings r ON r.proposal_id = p.id
    GROUP BY LOWER(TRIM(p.name)), p.name
  `);
  const playedRows = await db.all(`
    SELECT LOWER(TRIM(ag.game_name)) as nom FROM archive_games ag
    JOIN sessions s ON s.id = ag.session_id WHERE s.is_archived = 1
  `);
  const played = new Set(playedRows.map(g => g.nom));
  const neverPlayed = voted.filter(g => !played.has(g.nom)).sort((a,b) => b.nb_votes - a.nb_votes).slice(0,10);

  const allGamesWithScores = await db.all(`
    SELECT ag.game_name, ag.scores, ag.vainqueur, ag.thumbnail FROM archive_games ag
    JOIN sessions s ON s.id = ag.session_id
    WHERE ag.game_name != '' AND ag.scores != '' AND s.is_private = 0 AND s.is_archived = 1
  `);
  const gameScoreMap = {};
  for (const g of allGamesWithScores) {
    const key = g.game_name.toLowerCase().trim();
    if (!gameScoreMap[key]) gameScoreMap[key] = { game_name: g.game_name, thumbnail: g.thumbnail||'', players: {} };
    for (const part of g.scores.split(',')) {
      const m = part.trim().match(/^(.+?):\s*([\d\.]+)/);
      if (m) {
        const name = m[1].trim(), score = parseFloat(m[2]), pkey = name.toLowerCase();
        if (!gameScoreMap[key].players[pkey]) gameScoreMap[key].players[pkey] = { name, scores: [], wins: 0 };
        gameScoreMap[key].players[pkey].scores.push(score);
      }
    }
    if (g.vainqueur) {
      const pkey = g.vainqueur.toLowerCase().trim();
      if (!gameScoreMap[key].players[pkey]) gameScoreMap[key].players[pkey] = { name: g.vainqueur, scores: [], wins: 0 };
      gameScoreMap[key].players[pkey].wins++;
    }
  }
  const gameRankings = Object.values(gameScoreMap).map(g => ({
    game_name: g.game_name, thumbnail: g.thumbnail,
    players: Object.values(g.players).map(p => ({
      name: p.name, best: Math.max(...p.scores),
      avg: Math.round(p.scores.reduce((a,b) => a+b,0) / p.scores.length * 10) / 10,
      nb_parties: p.scores.length, wins: p.wins
    })).sort((a,b) => b.best - a.best)
  })).filter(g => g.players.length > 0).sort((a,b) => a.game_name.localeCompare(b.game_name));

  const yearsRows = await db.all(`
    SELECT DISTINCT EXTRACT(YEAR FROM date::date)::text as y FROM sessions
    WHERE is_private = 0 AND is_archived = 1 ORDER BY y DESC
  `);
  const years = yearsRows.map(r => r.y);

  res.json({ mostPlayed, playerStats, champions, seancesInfo, neverPlayed, gameRankings, years, currentYear: year });
});

router.get('/archive', async (req, res) => {
  const sessions = await db.all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM archive_games ag WHERE ag.session_id = s.id) as nb_jeux,
      (SELECT COUNT(*) FROM archive_media ap WHERE ap.session_id = s.id) as nb_photos
    FROM sessions s
    WHERE s.is_private = 0 AND EXISTS (SELECT 1 FROM archive_games WHERE session_id = s.id)
    ORDER BY s.date DESC, s.id DESC
  `);

  const stats = await (async () => {
    const mostPlayed = await db.all(`SELECT ag.game_name, COUNT(*) as nb FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name!='' AND s.is_archived=1 GROUP BY ag.game_name ORDER BY nb DESC LIMIT 5`);
    const champions = await db.all(`SELECT ag.vainqueur, COUNT(*) as nb FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.vainqueur!='' AND s.is_archived=1 GROUP BY ag.vainqueur ORDER BY nb DESC LIMIT 5`);
    return { mostPlayed, champions };
  })();

  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const sessionsHtml = (await Promise.all(sessions.map(async s => {
    const games = await db.all('SELECT * FROM archive_games WHERE session_id = $1 ORDER BY sort_order', [s.id]);
    const photos = await db.all('SELECT * FROM archive_media WHERE session_id = $1 AND game_id IS NULL ORDER BY sort_order', [s.id]);
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
      <div class="session-header" style="display:flex;align-items:flex-start;margin-bottom:12px">
        <div style="flex:1">
          <div class="session-title">${esc(s.name)}</div>
          <div class="session-date">${esc(s.date||'')} · ${games.length} jeu${games.length!==1?'x':''} joué${games.length!==1?'s':''}</div>
        </div>
        <a href="/archive/${s.id}" class="session-link">Voir la page →</a>
      </div>
      ${games.length ? `<div class="games-grid">${gamesHtml}</div>` : ''}
      ${s.compte_rendu ? `<div class="cr-block">📝 ${esc(s.compte_rendu)}</div>` : ''}
      ${photos.length ? `<div class="photos-grid">${photosHtml}</div>` : ''}
    </div>`;
  }))).join('');

  const statsHtml = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">🎲 Jeux les plus joués</div>
        ${stats.mostPlayed.map(g => `<div class="stat-item"><span>${esc(g.game_name)}</span><span>${g.nb}×</span></div>`).join('') || '<div style="font-size:.75rem;color:#888;font-style:italic">Pas encore de données</div>'}
      </div>
      <div class="stat-card">
        <div class="stat-title">🏆 Champions</div>
        ${stats.champions.map(g => `<div class="stat-item"><span>${esc(g.vainqueur)}</span><span>${g.nb} victoire${g.nb>1?'s':''}</span></div>`).join('') || '<div style="font-size:.75rem;color:#888;font-style:italic">Pas encore de données</div>'}
      </div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archives — GameDay</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}a{text-decoration:none;color:inherit}
:root,[data-theme="light"]{--bg:#e0d9ce;--card:#ece6db;--card2:#d8d2c6;--text:#1a1a2e;--text2:#555;--text3:#888;--accent:#4a6fa5;--accent2:#8b6f47;--border:#c8c2b6;}
[data-theme="dark"]{--bg:#0f0e0b;--card:#1a1814;--card2:#222019;--text:#e8e4d8;--text2:#a09880;--text3:#666;--accent:#8ba3c7;--accent2:#c8a060;--border:#2a2820;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px 16px;max-width:800px;margin:0 auto}
h2{font-size:1rem;font-weight:600;margin:24px 0 12px}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.stat-title{font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em}
.stat-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:.8rem}
.stat-item:last-child{border:none}
.session-block{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px}
.session-link{background:var(--accent);color:#fff;padding:6px 14px;border-radius:8px;font-size:.8rem;font-weight:600;flex-shrink:0;margin-left:12px;}
.session-title{font-size:1rem;font-weight:700}
.session-date{font-size:.75rem;color:var(--text2);margin-top:2px}
.games-grid{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.ag-item{display:flex;gap:10px;align-items:center;background:var(--card2);border-radius:8px;padding:7px 10px}
.ag-thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0}
.ag-thumb-ph{width:36px;height:36px;border-radius:6px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
.ag-name{font-size:.82rem;font-weight:600}.ag-win{font-size:.72rem;color:var(--accent2);margin-top:1px}.ag-scores{font-size:.7rem;color:var(--text3);margin-top:1px}
.cr-block{font-size:.78rem;color:var(--text2);background:var(--card2);border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.5;white-space:pre-wrap}
.photos-grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.photo-thumb{width:100px;height:80px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
.photo-caption{font-size:.65rem;color:var(--text3);max-width:100px;text-align:center}
</style>
</head>
<body>
<nav style="position:sticky;top:0;z-index:100;background:var(--card);border-bottom:1px solid var(--border);padding:0 16px;margin-bottom:24px;">
  <div style="max-width:720px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:10px 0;">
    <a href="/" style="font-size:1.3rem;font-weight:700;color:var(--text)">Game<em style="font-weight:300;font-style:italic;opacity:.6">Day</em></a>
    <div style="display:flex;gap:8px;align-items:center">
      <a href="/" style="font-size:.72rem;border:1px solid var(--border);border-radius:6px;padding:4px 10px;color:var(--text2)">🏠 Accueil</a>
      <button onclick="toggleTheme()" id="themeBtn" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:.85rem;">🌙</button>
    </div>
  </div>
</nav>
<h2 style="font-size:1.3rem;font-weight:700;margin-bottom:16px">📚 Archives GameDay</h2>
<h2>Statistiques</h2>
${statsHtml}
<h2>Séances</h2>
${sessionsHtml || '<p style="color:var(--text3);font-size:.85rem">Aucune archive pour l\'instant.</p>'}
<p style="font-size:.7rem;color:var(--text3);margin-top:24px;text-align:center">GameDay · pandagaming.ch</p>
<script>
function toggleTheme(){const h=document.documentElement,d=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',d?'light':'dark');document.getElementById('themeBtn').textContent=d?'🌙':'☀️';localStorage.setItem('gd_arch_theme',d?'light':'dark');}
const s=localStorage.getItem('gd_arch_theme');if(s){document.documentElement.setAttribute('data-theme',s);document.getElementById('themeBtn').textContent=s==='dark'?'☀️':'🌙';}
</script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /photo/:filename
router.get('/photo/:filename', async (req, res) => {
  const fn = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const url = '/uploads/' + fn;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Photo — GameDay</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#0f0e0b;display:flex;align-items:center;justify-content:center;flex-direction:column;}img{max-width:100vw;max-height:90vh;object-fit:contain;display:block;}.close{position:fixed;top:12px;right:16px;color:#aaa;font-size:1.8rem;cursor:pointer;text-decoration:none;line-height:1;}.close:hover{color:#fff;}</style></head><body><a class="close" onclick="window.close()" href="javascript:history.back()">×</a><img src="${url}" alt="Photo GameDay"></body></html>`);
});

// GET /stats
router.get('/stats', async (req, res) => {
  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const mostPlayed = await db.all(`SELECT game_name, COUNT(*) as nb, MAX(thumbnail) as thumbnail,
    (SELECT ag2.vainqueur FROM archive_games ag2 JOIN sessions s2 ON s2.id=ag2.session_id WHERE LOWER(TRIM(ag2.game_name))=LOWER(TRIM(ag.game_name)) AND ag2.vainqueur!='' AND s2.is_archived=1 GROUP BY ag2.vainqueur ORDER BY COUNT(*) DESC LIMIT 1) as champion
    FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name!='' AND s.is_archived=1 GROUP BY ag.game_name ORDER BY nb DESC LIMIT 10`);
  const allGames = await db.all(`SELECT ag.* FROM archive_games ag JOIN sessions s ON s.id=ag.session_id WHERE ag.game_name!='' AND s.is_archived=1`);
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
  const players = Object.values(playerMap).map(p => ({...p, pct: p.parties > 0 ? Math.round(p.victoires/p.parties*100) : 0})).sort((a,b) => b.victoires - a.victoires).slice(0, 10);
  const seancesInfo = await db.get(`SELECT COUNT(*) as total, MIN(date) as premiere, MAX(date) as derniere FROM sessions WHERE is_archived=1`);
  const totalParties = allGames.length;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statistiques — GameDay</title><style>:root{--bg:#1a1917;--surface:#242220;--border:#3a3835;--text:#f0ece4;--text-muted:#8a857c;--accent:#c17d3c;--accent2:#8fba6a;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:-apple-system,sans-serif;background:var(--bg);color:var(--text);padding:20px;max-width:800px;margin:0 auto;}h1{font-size:2rem;margin-bottom:4px;}h2{font-size:1.1rem;margin:24px 0 10px;}table{width:100%;border-collapse:collapse;font-size:.82rem;background:var(--surface);border-radius:10px;overflow:hidden;}th{text-align:left;padding:8px 12px;border-bottom:2px solid var(--border);color:var(--text-muted);font-size:.68rem;text-transform:uppercase;}td{padding:8px 12px;border-bottom:1px solid var(--border);}tr:last-child td{border-bottom:none;}.game-row{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px;}.game-thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;}.game-name{font-weight:600;font-size:.85rem;}.game-meta{font-size:.7rem;color:var(--text-muted);}.game-champ{font-size:.7rem;color:var(--accent2);}</style></head>
<body>
<h1>📊 Statistiques</h1>
<div style="color:var(--text-muted);font-size:.82rem;margin-bottom:28px">GameDay · Panda Gaming</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:28px">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;color:var(--accent)">${seancesInfo?.total||0}</div><div style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px">Séances</div></div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;color:var(--accent)">${totalParties}</div><div style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px">Parties</div></div>
</div>
<h2>🏆 Classement joueurs</h2>
<table><thead><tr><th>#</th><th>Joueur</th><th>Parties</th><th>Victoires</th><th>%</th></tr></thead><tbody>
${players.map((p,i) => `<tr><td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${p.parties}</td><td>${p.victoires}</td><td>${p.pct}%</td></tr>`).join('')}
</tbody></table>
<h2>🎲 Jeux les plus joués</h2>
${mostPlayed.map((g,i) => `<div class="game-row">${g.thumbnail?`<img src="${esc(g.thumbnail)}" class="game-thumb" onerror="this.style.display='none'">`:''}<div style="flex:1"><div class="game-name">${esc(g.game_name)}</div><div class="game-meta">${g.nb} partie${g.nb>1?'s':''}</div>${g.champion?`<div class="game-champ">🏆 ${esc(g.champion)}</div>`:''}</div><div>${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div></div>`).join('')}
</body></html>`);
});

// GET /api/giphy?q=
router.get('/api/giphy', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Requête vide' });
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GIPHY_API_KEY non configurée' });
  try {
    const fetch = require('node-fetch');
    const url = 'https://api.giphy.com/v1/gifs/search?api_key=' + encodeURIComponent(apiKey)
      + '&q=' + encodeURIComponent(q) + '&limit=12&rating=g&lang=fr';
    const r = await fetch(url);
    const data = await r.json();
    const gifs = (data.data || []).map(g => ({ url: g.images.original.url, preview: g.images.fixed_height_small.url, title: g.title }));
    res.json({ gifs });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/sessions/:id/archive/cr
router.post('/api/sessions/:id/archive/cr', requireAuth, requirePerm('report_notes'), async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { content } = req.body;
  try {
    await db.run(`
      INSERT INTO archive_user_cr (session_id, user_id, content, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT(session_id, user_id)
      DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `, [sessionId, userId, content || '']);
  } catch(e) { return res.status(500).json({ error: e.message }); }
  req.app.locals.broadcast?.(sessionId, 'archive.updated', { type: 'cr', userId });
  res.json({ ok: true });
});

// POST /api/archive/games/:id/cr
router.post('/api/archive/games/:id/cr', requireAuth, requirePerm('report_notes'), async (req, res) => {
  const gameId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { content } = req.body;
  const game = await db.get('SELECT session_id FROM archive_games WHERE id = $1', [gameId]);
  try {
    await db.run(`
      INSERT INTO archive_game_cr (game_id, user_id, content, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT(game_id, user_id)
      DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `, [gameId, userId, content || '']);
  } catch(e) { return res.status(500).json({ error: e.message }); }
  if (game) req.app.locals.broadcast?.(game.session_id, 'archive.updated', { type: 'gameCr', gameId, userId });
  res.json({ ok: true });
});

module.exports = router;