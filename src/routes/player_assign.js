'use strict';

// ── Algorithme hongrois (maximisation) ───────────────────────
function hungarian(cost) {
  const n = cost.length;
  const m = cost[0].length;
  const INF = 1e9;
  const size = Math.max(n, m);
  const mat = Array.from({length: size}, (_, i) =>
    Array.from({length: size}, (_, j) =>
      (i < n && j < m) ? -cost[i][j] : 0
    )
  );
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minVal = new Array(size + 1).fill(INF);
    const used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      let i0 = p[j0], delta = INF, j1 = -1;
      for (let j = 1; j <= size; j++) {
        if (!used[j]) {
          const cur = mat[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minVal[j]) { minVal[j] = cur; way[j] = j0; }
          if (minVal[j] < delta) { delta = minVal[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minVal[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { p[j0] = p[way[j0]]; j0 = way[j0]; } while (j0);
  }

  const result = new Array(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    if (p[j] > 0 && p[j] <= n && j <= m) result[p[j] - 1] = j - 1;
  }
  return result;
}

function assignPlayers(slots, players, rankings, participants, proposals) {
  // ── Maps utiles ───────────────────────────────────────────
  const usernameToId = {};
  participants.forEach(p => usernameToId[p.username] = p.id);

  const gameNameToId = {};
  const gameNameToMaxP = {};
  proposals.forEach(p => {
    const key = p.name.toLowerCase();
    gameNameToId[key] = p.id;
    gameNameToMaxP[key] = parseInt(p.max_players) || 4;
  });

  // Matching flexible sur le nom du jeu
  function findGameId(name) {
    const key = name.toLowerCase();
    if (gameNameToId[key]) return gameNameToId[key];
    for (const [k, id] of Object.entries(gameNameToId)) {
      if (k.startsWith(key.slice(0, 12)) || key.startsWith(k.slice(0, 12))) return id;
    }
    return null;
  }

  // Score Borda : rang 1 = score max, dernier = 0
  function bordaScore(username, gameName) {
    const uid = usernameToId[username];
    if (!uid) return 0;
    const gameId = findGameId(gameName);
    if (!gameId) return 0;
    const userRanks = rankings.filter(r => r.user_id === uid);
    const n = userRanks.length;
    const rank = userRanks.find(r => r.proposal_id === gameId);
    if (!rank) return 0;
    return n - rank.rank + 1;
  }

  function isLastChoice(username, gameName) {
    const uid = usernameToId[username];
    if (!uid) return false;
    const gameId = findGameId(gameName);
    if (!gameId) return false;
    const userRanks = rankings.filter(r => r.user_id === uid).sort((a,b) => b.rank - a.rank);
    return userRanks.length > 0 && userRanks[0].proposal_id === gameId;
  }

  return slots.map(slot => {
    if (slot.type === 'break') return slot;

    const tables = slot.games.map(game => ({
      game,
      maxPlayers: parseInt(game.max_players) || 4,
      assignedPlayers: []
    }));

    const unassigned = [...players];

    // ── Étape 1 : teachers ───────────────────────────────────
    tables.forEach(t => {
      if (!t.game.teacher) return;
      const idx = unassigned.indexOf(t.game.teacher);
      if (idx !== -1) {
        t.assignedPlayers.push(t.game.teacher);
        unassigned.splice(idx, 1);
      }
    });

    // ── Étape 2 : votants #1 (contrainte forte) ──────────────
    const top1Assigned = new Set(); // joueurs placés par leur vote #1
    tables.forEach(t => {
      const gameId = findGameId(t.game.name);
      if (!gameId) return;
      for (const player of [...unassigned]) {
        if (t.assignedPlayers.length >= t.maxPlayers) break;
        const uid = usernameToId[player];
        if (!uid) continue;
        const userRanks = rankings.filter(r => r.user_id === uid).sort((a,b) => a.rank - b.rank);
        if (userRanks.length > 0 && userRanks[0].proposal_id === gameId) {
          const idx = unassigned.indexOf(player);
          if (idx !== -1) {
            t.assignedPlayers.push(player);
            unassigned.splice(idx, 1);
            top1Assigned.add(player); // protéger de l'équilibrage
          }
        }
      }
    });

    // ── Étape 3 : algo hongrois pour les restants ────────────
    const capacities = tables.map(t => t.maxPlayers - t.assignedPlayers.length);

    // Créer des "slots de table" selon capacité
    const tableSlots = [];
    tables.forEach((t, ti) => {
      for (let k = 0; k < capacities[ti]; k++) {
        tableSlots.push({ tableIdx: ti, game: t.game });
      }
    });

    if (unassigned.length > 0 && tableSlots.length > 0) {
      const cost = unassigned.map(player =>
        tableSlots.map(ts => {
          let score = bordaScore(player, ts.game.name);
          if (isLastChoice(player, ts.game.name)) score -= 5;
          return Math.max(0, score);
        })
      );
      const assignment = hungarian(cost);
      assignment.forEach((slotIdx, playerIdx) => {
        if (slotIdx < 0 || slotIdx >= tableSlots.length) return;
        const tableIdx = tableSlots[slotIdx].tableIdx;
        tables[tableIdx].assignedPlayers.push(unassigned[playerIdx]);
      });
    }

    // ── Étape 4 : équilibrage (écart max 1) ──────────────────
    let changed = true, maxIter = 20;
    while (changed && maxIter-- > 0) {
      changed = false;
      const sizes = tables.map(t => t.assignedPlayers.length);
      const max = Math.max(...sizes), min = Math.min(...sizes);
      if (max - min <= 1) break;
      const bigIdx = sizes.indexOf(max);
      const smallIdx = sizes.indexOf(min);
      const movable = tables[bigIdx].assignedPlayers.find(p =>
        p !== tables[bigIdx].game.teacher &&
        !top1Assigned.has(p) && // ne pas déplacer les joueurs placés sur leur #1
        tables[smallIdx].assignedPlayers.length < tables[smallIdx].maxPlayers
      );
      if (movable) {
        tables[bigIdx].assignedPlayers = tables[bigIdx].assignedPlayers.filter(p => p !== movable);
        tables[smallIdx].assignedPlayers.push(movable);
        changed = true;
      }
    }

    // ── Résultat ─────────────────────────────────────────────
    const result = { ...slot };
    if (tables[0]) result.players   = tables[0].assignedPlayers.join(', ');
    if (tables[1]) result.players_b = tables[1].assignedPlayers.join(', ');
    if (tables[2]) result.players_c = tables[2].assignedPlayers.join(', ');
    return result;
  });
}

module.exports = { assignPlayers };
