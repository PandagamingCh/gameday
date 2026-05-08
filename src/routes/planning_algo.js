// ─────────────────────────────────────────────────────────────
// planning_algo.js — Pré-assignation déterministe des jeux aux créneaux
//
// Input:
//   proposals   : [{id, name, min_players, max_players, min_time, max_time, teacher, score}]
//   params      : {nbTables, nbTogether, nbParallel, totalPlayers, totalMinutes}
//
// Output:
//   { slots: [{type:'parallel'|'together', games:[{name,teacher,duration}]}, ...], unscheduled: [...] }
// ─────────────────────────────────────────────────────────────

function buildPlanning(proposals, params) {
  const { nbTables, nbTogether, nbParallel, totalPlayers, totalMinutes, rankings, participants } = params;

  // ── 1. Trier par score décroissant ────────────────────────
  const sorted = [...proposals].sort((a, b) => (b.score || 0) - (a.score || 0));

  // ── 2. Grouper les jeux par teacher ──────────────────────
  const gamesByTeacher = {};
  sorted.forEach(g => {
    if (g.teacher) {
      if (!gamesByTeacher[g.teacher]) gamesByTeacher[g.teacher] = [];
      gamesByTeacher[g.teacher].push(g);
    }
  });

  // ── 3. Calculer les top votes par joueur ─────────────────
  // Pour chaque joueur, quel jeu a-t-il voté #1 ?
  const top1ByPlayer = {}; // username -> proposal_id
  if (rankings && participants) {
    participants.forEach(p => {
      const userRanks = rankings.filter(r => r.user_id === p.id).sort((a, b) => a.rank - b.rank);
      if (userRanks.length > 0) top1ByPlayer[p.username] = userRanks[0].proposal_id;
    });
  }

  // Pour un jeu donné, quels teachers sont "bloqués" parce que des joueurs veulent y jouer en #1 ?
  // Règle : si un joueur NON-teacher a voté ce jeu #1 → bloquer son propre jeu teacher dans ce créneau
  // Exception : si ce joueur EST lui-même teacher d'un jeu → il sera sur son jeu de toute façon, ignorer
  const teacherNames = new Set(sorted.map(g => g.teacher).filter(Boolean));

  function getBlockedTeachersForGame(game) {
    const blocked = new Set();
    Object.entries(top1ByPlayer).forEach(([username, propId]) => {
      if (propId === game.id && username !== game.teacher) {
        // Ce joueur (non-teacher de ce jeu) veut y jouer → bloquer son propre jeu teacher dans ce créneau
        // On bloque le username comme teacher (son jeu teacher ne peut pas être dans ce créneau)
        blocked.add(username);
      }
    });
    return blocked;
  }

  // ── 3. Filtrer les jeux compatibles selon le type de créneau ──
  function isCompatibleTogether(game) {
    return parseInt(game.max_players) >= totalPlayers;
  }

  function isCompatibleParallel(game, playersPerTable) {
    return parseInt(game.max_players) >= Math.floor(playersPerTable) &&
           parseInt(game.min_players) <= Math.ceil(playersPerTable);
  }

  function estimateDuration(game, nbPlayers) {
    const min = parseInt(game.min_time) || 60;
    const max = parseInt(game.max_time) || min;
    const minP = parseInt(game.min_players) || 1;
    const maxP = parseInt(game.max_players) || minP;
    if (maxP === minP) return min;
    // Interpolation linéaire entre min et max durée
    const ratio = Math.min(1, (nbPlayers - minP) / Math.max(1, maxP - minP));
    return Math.round(min + ratio * (max - min));
  }

  // ── 4. Assigner les jeux aux créneaux ─────────────────────
  const slots = [];
  const usedGameIds = new Set();
  const teacherUsedInSlot = []; // tableau par index de créneau

  const playersPerTable = totalPlayers / nbTables;
  const totalSlots = nbTogether + nbParallel;

  // Initialiser les créneaux
  for (let i = 0; i < totalSlots; i++) {
    const isTogether = i < nbTogether;
    slots.push({
      type: isTogether ? 'together' : 'parallel',
      games: [],
      teachersUsed: new Set()
    });
  }

  // Remplir les créneaux parallèles en priorité (plus contraignants)
  // Stratégie : pour chaque créneau, choisir les meilleurs jeux disponibles
  // sans conflit de teacher dans le même créneau

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const slot = slots[slotIdx];
    const needed = slot.type === 'together' ? 1 : nbTables;

    for (let tableIdx = 0; tableIdx < needed; tableIdx++) {
      // Trouver le meilleur jeu disponible pour cette table/créneau
      for (const game of sorted) {
        if (usedGameIds.has(game.id)) continue;

        // Vérifier compatibilité joueurs
        if (slot.type === 'together' && !isCompatibleTogether(game)) continue;
        if (slot.type === 'parallel' && !isCompatibleParallel(game, playersPerTable)) continue;

        // Vérifier conflit teacher dans ce créneau
        if (game.teacher && slot.teachersUsed.has(game.teacher)) continue;

        // Vérifier que le teacher n'est pas déjà utilisé trop souvent (max 3x/journée)
        const teacherCount = slots.filter(s => s.games.some(g => g.teacher === game.teacher)).length;
        if (teacherCount >= 3) continue;

        // Vérifier que le teacher de ce jeu n'est pas bloqué par un joueur #1 déjà placé
        // Ex: si PM a voté Andromeda #1 et Andromeda est déjà dans ce créneau,
        // alors Shackleton (teacher PM) ne peut pas être dans ce créneau
        if (game.teacher) {
          const alreadyPlacedGames = slot.games;
          let teacherBlocked = false;
          for (const placed of alreadyPlacedGames) {
            const blockedTeachers = getBlockedTeachersForGame(placed);
            if (blockedTeachers.has(game.teacher)) { teacherBlocked = true; break; }
          }
          if (teacherBlocked) continue;
        }

        // ✅ Jeu compatible — l'assigner
        const nbPlayersForGame = slot.type === 'together' ? totalPlayers : Math.round(playersPerTable);
        const duration = estimateDuration(game, nbPlayersForGame);

        slot.games.push({
          id: game.id,
          name: game.name,
          teacher: game.teacher || '',
          duration,
          score: game.score || 0,
          min_players: game.min_players,
          max_players: game.max_players,
          thumbnail: game.thumbnail || ''
        });

        if (game.teacher) slot.teachersUsed.add(game.teacher);
        usedGameIds.add(game.id);
        break;
      }
    }
  }

  // ── 5. Collecter les jeux non planifiés ──────────────────
  const unscheduled = sorted.filter(g => !usedGameIds.has(g.id)).map(g => g.name);

  return { slots, unscheduled };
}

module.exports = { buildPlanning };
