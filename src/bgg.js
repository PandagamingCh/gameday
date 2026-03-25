const fetch = require('node-fetch');
const { db } = require('./database');

// Token BGG Bearer — obligatoire depuis juillet 2025
// Créer une application sur https://boardgamegeek.com/applications
const BGG_TOKEN = process.env.BGG_TOKEN || '';

function getHeaders() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/xml, text/xml, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  };
  if (BGG_TOKEN) {
    headers['Authorization'] = `Bearer ${BGG_TOKEN}`;
  }
  return headers;
}

// Parse BGG XML collection response (compatible v1 et v2)
function parseCollection(xmlText) {
  const games = [];
  const itemRegex = /<item[^>]+objectid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const bggId = match[1];
    const block = match[2];

    const name = (
      block.match(/<name[^>]*sortindex="1"[^>]*>([^<]+)<\/name>/) ||
      block.match(/<name[^>]*>([^<]+)<\/name>/)
    )?.[1]?.trim() || '';

    const year = block.match(/<yearpublished>([^<]+)<\/yearpublished>/)?.[1]?.trim() || '';
    const thumbnail = block.match(/<thumbnail>\s*(https?[^<]+)\s*<\/thumbnail>/)?.[1]?.trim() || '';

    const statsAttr = block.match(/<stats[^>]*minplayers="(\d+)"[^>]*maxplayers="(\d+)"[^>]*minplaytime="(\d+)"[^>]*maxplaytime="(\d+)"/);
    const minPlayers = statsAttr?.[1] || block.match(/<minplayers[^>]*>(\d+)/)?.[1] || '';
    const maxPlayers = statsAttr?.[2] || block.match(/<maxplayers[^>]*>(\d+)/)?.[1] || '';
    const minTime    = statsAttr?.[3] || block.match(/<minplaytime[^>]*>(\d+)/)?.[1] || '';
    const maxTime    = statsAttr?.[4] || block.match(/<maxplaytime[^>]*>(\d+)/)?.[1] || '';

    if (name) {
      games.push({ bggId, name, year, thumbnail, minPlayers, maxPlayers, minTime, maxTime });
    }
  }

  return games;
}

// Fetch avec retry sur 202 (file d'attente BGG) et gestion des erreurs
async function fetchWithRetry(url, maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 3500));

    let response;
    try {
      response = await fetch(url, { headers: getHeaders(), timeout: 20000 });
    } catch(e) {
      if (attempt === maxAttempts - 1) throw new Error('Impossible de joindre BGG : ' + e.message);
      continue;
    }

    console.log(`BGG → ${response.status} : ${url.substring(0, 80)}…`);

    if (response.status === 202) continue; // file d'attente, réessayer

    if (response.status === 401) {
      throw new Error('Token BGG invalide ou expiré (401). Vérifiez BGG_TOKEN dans docker-compose.yml — créez un token sur boardgamegeek.com/applications');
    }
    if (response.status === 403) {
      throw new Error('Accès refusé par BGG (403). Votre application n\'est peut-être pas encore approuvée.');
    }
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 8000));
      continue;
    }
    if (response.status === 404) throw new Error('Utilisateur BGG introuvable');
    if (!response.ok) throw new Error(`BGG a retourné une erreur ${response.status}`);

    return response;
  }

  throw new Error('BGG ne répond pas après plusieurs tentatives (202 persistant)');
}

// Fetch collection BGG pour un utilisateur
async function fetchBGGCollection(bggUsername) {
  const url = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(bggUsername)}&own=1&excludesubtype=boardgameexpansion`;
  const r = await fetchWithRetry(url);
  const xmlText = await r.text();

  if (!xmlText?.includes('<')) throw new Error('Réponse BGG vide ou invalide');
  if (xmlText.includes('Invalid username') || xmlText.includes('not found')) {
    throw new Error(`Utilisateur BGG "${bggUsername}" introuvable`);
  }
  if (xmlText.includes('<message>')) {
    const msg = xmlText.match(/<message>([^<]+)<\/message>/)?.[1] || 'Erreur BGG';
    if (msg.toLowerCase().includes('accepted')) return []; // collection en file d'attente = vide
    throw new Error(msg);
  }

  const games = parseCollection(xmlText);
  if (!games.length && xmlText.includes('<items ')) return []; // collection vide, pas d'erreur

  if (!games.length) {
    throw new Error('Aucun jeu trouvé — vérifiez que votre collection BGG est publique (Settings → Privacy → Collection → Public)');
  }

  return games;
}

// Synchroniser la collection en base
async function syncUserCollection(userId, bggUsername) {
  if (!bggUsername) return { count: 0, synced: false };

  const games = await fetchBGGCollection(bggUsername);
  if (!games.length) return { count: 0, synced: true };

  // Étape 2 : récupérer les notes et détails via /thing par batch de 20
  const ratingMap = {};
  const batchSize = 20;
  for (let i = 0; i < games.length; i += batchSize) {
    const batch = games.slice(i, i + batchSize);
    const ids = batch.map(g => g.bggId).join(',');
    try {
      const detailUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${ids}&stats=1`;
      const detailRes = await fetchWithRetry(detailUrl, 2);
      const detailXml = await detailRes.text();
      const itemRegex = /<item[^>]+id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRegex.exec(detailXml)) !== null) {
        const bggId = m[1];
        const block = m[2];
        const avgRaw = parseFloat(block.match(/<average[^>]*value="([^"]+)"/)?.[1] || '0');
        if (avgRaw > 0) ratingMap[bggId] = { rating: avgRaw.toFixed(1) };
        const weightRaw = parseFloat(block.match(/<averageweight[^>]*value="([^"]+)"/)?.[1] || '0');
        if (weightRaw > 0) {
          if (!ratingMap[bggId]) ratingMap[bggId] = {};
          ratingMap[bggId].weight = weightRaw.toFixed(2);
        }
        // Récupérer aussi min/max players et time si manquants
        const minP = block.match(/<minplayers[^>]*value="(\d+)"/)?.[1];
        const maxP = block.match(/<maxplayers[^>]*value="(\d+)"/)?.[1];
        const minT = block.match(/<minplaytime[^>]*value="(\d+)"/)?.[1];
        const maxT = block.match(/<maxplaytime[^>]*value="(\d+)"/)?.[1];
        const g = games.find(x => x.bggId === bggId);
        if (g) {
          if (minP) g.minPlayers = minP;
          if (maxP) g.maxPlayers = maxP;
          if (minT) g.minTime = minT;
          if (maxT) g.maxTime = maxT;
        }
      }
    } catch(e) { /* continue sans notes si erreur */ }
    if (i + batchSize < games.length) await new Promise(r => setTimeout(r, 1000));
  }

  const insert = db.prepare(`
    INSERT INTO bgg_games (user_id, bgg_id, name, year, thumbnail, min_players, max_players, min_time, max_time, bgg_rating, bgg_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    db.prepare('DELETE FROM bgg_games WHERE user_id = ?').run(userId);
    for (const g of games) {
      insert.run(userId, g.bggId, g.name, g.year, g.thumbnail,
        g.minPlayers, g.maxPlayers, g.minTime, g.maxTime,
        ratingMap[g.bggId]?.rating || null, ratingMap[g.bggId]?.weight || null);
    }
    db.prepare("UPDATE users SET bgg_synced_at = datetime('now') WHERE id = ?").run(userId);
  })();

  return { count: games.length, synced: true };
}

// Récupérer la collection en cache
function getUserCollection(userId) {
  return db.prepare(`
    SELECT bgg_id, name, year, thumbnail, min_players, max_players, min_time, max_time, bgg_rating, bgg_weight
    FROM bgg_games WHERE user_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(userId);
}

// (exports moved to bottom of file)

// Rechercher des jeux sur BGG par nom
async function searchBGG(query) {
  // Étape 1 : recherche par nom → liste d'IDs
  const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame&exact=0`;
  const searchRes = await fetchWithRetry(searchUrl, 2);
  const searchXml = await searchRes.text();

  // Extraire les IDs (max 8 pour limiter les appels)
  const ids = [];
  const idRegex = /<item[^>]+id="(\d+)"/g;
  let m;
  while ((m = idRegex.exec(searchXml)) !== null && ids.length < 8) {
    ids.push(m[1]);
  }

  if (!ids.length) return [];

  // Étape 2 : récupérer les détails (nom, joueurs, durée, image)
  const detailUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`;
  const detailRes = await fetchWithRetry(detailUrl, 2);
  const detailXml = await detailRes.text();

  const games = [];
  const itemRegex = /<item[^>]+id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
  while ((m = itemRegex.exec(detailXml)) !== null) {
    const bggId = m[1];
    const block = m[2];

    const name = block.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/)?.[1]
              || block.match(/<name[^>]*value="([^"]+)"/)?.[1] || '';
    const year = block.match(/<yearpublished[^>]*value="([^"]+)"/)?.[1] || '';
    const thumbnail = block.match(/<thumbnail>\s*(https?[^<]+)\s*<\/thumbnail>/)?.[1]?.trim() || '';
    const minPlayers = block.match(/<minplayers[^>]*value="(\d+)"/)?.[1] || '';
    const maxPlayers = block.match(/<maxplayers[^>]*value="(\d+)"/)?.[1] || '';
    const minTime    = block.match(/<minplaytime[^>]*value="(\d+)"/)?.[1] || '';
    const maxTime    = block.match(/<maxplaytime[^>]*value="(\d+)"/)?.[1] || '';

    const avgRatingRaw = parseFloat(block.match(/<average[^>]*value="([^"]+)"/)?.[1] || '0');
    const bggRating = avgRatingRaw > 0 ? avgRatingRaw.toFixed(1) : '';
    const avgWeightRaw = parseFloat(block.match(/<averageweight[^>]*value="([^"]+)"/)?.[1] || '0');
    const bggWeight = avgWeightRaw > 0 ? avgWeightRaw.toFixed(2) : '';
    if (name) {
      games.push({ bgg_id: bggId, name, year, thumbnail, min_players: minPlayers, max_players: maxPlayers, min_time: minTime, max_time: maxTime, bgg_rating: bggRating, bgg_weight: bggWeight });
    }
  }

  return games;
}


// Récupérer les détails d'un jeu par son ID BGG
async function fetchBGGThing(bggId) {
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
  const r = await fetchWithRetry(url, 3);
  const xml = await r.text();

  const block = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/)?.[1] || '';
  if (!block) throw new Error('Jeu introuvable sur BGG');

  const name = block.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/)?.[1]
            || block.match(/<name[^>]*value="([^"]+)"/)?.[1] || '';
  const year      = block.match(/<yearpublished[^>]*value="([^"]+)"/)?.[1] || '';
  const thumbnail = block.match(/<thumbnail>\s*(https?[^<]+)\s*<\/thumbnail>/)?.[1]?.trim() || '';
  const minPlayers = block.match(/<minplayers[^>]*value="(\d+)"/)?.[1] || '';
  const maxPlayers = block.match(/<maxplayers[^>]*value="(\d+)"/)?.[1] || '';
  const minTime    = block.match(/<minplaytime[^>]*value="(\d+)"/)?.[1] || '';
  const maxTime    = block.match(/<maxplaytime[^>]*value="(\d+)"/)?.[1] || '';

  const avgRatingRaw = parseFloat(block.match(/<average[^>]*value="([^"]+)"/)?.[1] || '0');
  const bggRating = avgRatingRaw > 0 ? avgRatingRaw.toFixed(1) : '';
  const avgWeightRaw = parseFloat(block.match(/<averageweight[^>]*value="([^"]+)"/)?.[1] || '0');
  const bggWeight = avgWeightRaw > 0 ? avgWeightRaw.toFixed(2) : '';

  if (!name) throw new Error('Impossible de lire les données BGG pour cet ID');

  return { bgg_id: bggId, name, year, thumbnail, min_players: minPlayers, max_players: maxPlayers, min_time: minTime, max_time: maxTime, bgg_rating: bggRating, bgg_weight: bggWeight };
}


// Récupérer la description d'un jeu BGG par son ID
async function fetchBGGDescription(bggId) {
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
  const r = await fetchWithRetry(url, 3);
  const xml = await r.text();
  const block = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/)?.[1] || '';
  if (!block) throw new Error('Jeu introuvable sur BGG');
  // Description HTML-encodée dans <description>
  const rawDesc = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
  // Décoder les entités HTML basiques
  const desc = rawDesc
    .replace(/&#10;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return desc;
}

module.exports = { fetchBGGCollection, syncUserCollection, getUserCollection, searchBGG, fetchBGGThing, fetchBGGDescription };
