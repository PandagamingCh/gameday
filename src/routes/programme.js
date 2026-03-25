// ─────────────────────────────────────────────────────────────
// routes/programme.js — Programme de la journée et génération IA
//
// Routes :
//   GET    /api/sessions/:id/programme      Récupère les créneaux
//   POST   /api/sessions/:id/programme      Crée un créneau manuellement
//   PATCH  /api/sessions/:id/programme/validate    Publie le programme
//   PATCH  /api/sessions/:id/programme/unvalidate  Dépublie le programme
//   POST   /api/programme/slots             Crée un slot
//   PATCH  /api/programme/slots/:id         Modifie un slot
//   DELETE /api/programme/slots/:id         Supprime un slot
//   PATCH  /api/programme/reorder           Réordonne les slots
//   POST   /api/programme/generate          (IA) Génère le programme complet
//   POST   /api/programme/estimate          (IA) Estime la durée d'un créneau
//   GET    /programme/:sessionId            Page publique du programme (HTML)
// ─────────────────────────────────────────────────────────────

'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin, requirePerm } = require('../middleware/auth');
const fetch = require('node-fetch');

// ── PROGRAMME IA ────────────────────────────────────────────

// POST /api/programme/generate
router.post('/api/programme/generate', requireAuth, requirePerm('programme_generate', req => { const s = db.prepare('SELECT created_by FROM sessions WHERE id=?').get(parseInt(req.body.sessionId)); return s?.created_by; }), async (req, res) => {
  const { sessionId, startTime, endTime, hasLunch, lunchTime, lunchDurationMinutes, nbPlayers, nbTables, freeText, mode, nbTogether, nbParallel } = req.body;
  const maxTables = parseInt(nbTables) || 3;

  // Vérifier la clé API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "CLÉ_MANQUANTE", message: "Aucune clé API Anthropic configurée. Ajoutez ANTHROPIC_API_KEY dans votre .env pour activer la génération automatique. Vous pouvez créer le programme manuellement via l'onglet Programme." });
  }

  // Récupérer toutes les données nécessaires
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: "Seance introuvable" });

  const categories = db.prepare('SELECT * FROM categories WHERE session_id = ? ORDER BY sort_order').all(sessionId);
  const participants = db.prepare(`
    SELECT u.id, u.username FROM session_participants sp
    JOIN users u ON u.id = sp.user_id WHERE sp.session_id = ?
  `).all(sessionId);
  const proposals = db.prepare('SELECT * FROM proposals WHERE session_id = ?').all(sessionId);
  const rankings = db.prepare('SELECT * FROM rankings WHERE session_id = ?').all(sessionId);

  if (!proposals.length && !rankings.length) return res.status(400).json({ error: "Aucun jeu proposé ni voté — ajoutez des jeux dans l'onglet Proposer avant de générer." });

  // Calculer les scores Borda par catégorie
  const scores = {};
  proposals.forEach(p => scores[p.id] = 0);
  const rankingsByUser = {};
  rankings.forEach(r => {
    if (!rankingsByUser[`${r.user_id}_${r.category_id}`]) rankingsByUser[`${r.user_id}_${r.category_id}`] = [];
    rankingsByUser[`${r.user_id}_${r.category_id}`].push(r);
  });
  Object.values(rankingsByUser).forEach(userRanks => {
    const n = userRanks.length;
    userRanks.forEach(r => { if (scores[r.proposal_id] !== undefined) scores[r.proposal_id] += (n - r.rank + 1); });
  });

  // Pour chaque jeu, calculer quels joueurs voulaient y jouer (ranked ≤ 3)
  const gameVoters = {};
  proposals.forEach(p => gameVoters[p.id] = []);
  rankings.forEach(r => {
    if (r.rank <= 3) {
      const player = participants.find(p => p.id === r.user_id);
      if (player && !gameVoters[r.proposal_id].find(v => v.id === player.id)) {
        gameVoters[r.proposal_id].push(player);
      }
    }
  });

  // Construire le contexte pour Claude
  const gamesList = categories.map(cat => {
    const catProposals = proposals
      .filter(p => p.category_id === cat.id)
      .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));

    if (!catProposals.length) return '';

    const gamesText = catProposals.map((p, i) => {
      const time = p.min_time && p.min_time !== '0'
        ? (p.min_time === p.max_time ? `${p.min_time}min` : `${p.min_time}-${p.max_time}min`)
        : 'durée inconnue';
      const players = p.min_players && p.max_players
        ? `${p.min_players}-${p.max_players} joueurs`
        : 'nb joueurs inconnu';
      const voters = gameVoters[p.id].map(v => v.username).join(', ') || 'aucun vote top 3';
      const teacherInfo = p.teacher ? ` — teacher: ${p.teacher} (doit être dans les joueurs de sa table)` : ' — teacher: aucun';
      const teachDurInfo = p.teach_duration ? ` — durée teaching: ${p.teach_duration}min` : '';
      // Indication de scaling durée par nombre de joueurs
      const scalingHint = p.min_time && p.max_time && p.min_players && p.max_players
        ? ` (durée augmente avec nb joueurs)`
        : '';
      return `  ${i + 1}. "${p.name}" — ${time}${scalingHint} — ${players} — score: ${scores[p.id] || 0}pts — intéressés: ${voters}${teacherInfo}${teachDurInfo}`;
    }).join('\n');

    const catHint = /tous|groupe|ensemble|all|together/i.test(cat.name + ' ' + (cat.subtitle || ''))
      ? ' → JEU SUR 1 SEULE TABLE (tous ensemble)'
      : /parallèle|3-4|petit|small|few/i.test(cat.name + ' ' + (cat.subtitle || ''))
      ? ' → JEU EN TABLES PARALLÈLES'
      : '';
    return `Catégorie "${cat.name}" (${cat.subtitle || ''})${catHint}:\n${gamesText}`;
  }).filter(Boolean).join('\n\n');

  const lunchInfo = hasLunch
    ? `Une pause déjeuner est prévue à ${lunchTime} (durée: ${lunchDurationMinutes} minutes).`
    : 'Pas de pause déjeuner.';

  const participantNames = participants.map(p => p.username).join(', ');

  const totalPlayers = nbPlayers || participants.length;

  // ── Prompt selon le mode ──────────────────────────────
  const isFreeMode = mode === 'free' && freeText;

  const jsonFormatInstructions = `
**Format de réponse:**
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, sans balises markdown.
Format exact:
{
  "slots": [
    {
      "start_time": "10:00",
      "game_name": "Jeu Table A",
      "duration_min": 90,
      "players": "Alice, Bob, Charlie",
      "game_name_b": "Autre Jeu Table B",
      "duration_min_b": 90,
      "players_b": "Dave, Eve, Frank",
      "game_name_c": "",
      "duration_min_c": 0,
      "players_c": "",
      "note": "conseil optionnel",
      "is_break": false
    },
    {
      "start_time": "12:30",
      "game_name": "Pause déjeuner",
      "duration_min": 60,
      "players": "tous",
      "game_name_b": "",
      "duration_min_b": 0,
      "players_b": "",
      "game_name_c": "",
      "duration_min_c": 0,
      "players_c": "",
      "note": "",
      "is_break": true
    }
  ],
  "unscheduled": ["Jeu 1", "Jeu 2"]
}
- Toujours inclure les champs game_name_b, players_b, game_name_c, players_c (vides si non utilisés)
- is_break: true uniquement pour les pauses
- players: noms séparés par virgule, ou "tous"
- note: conseil court ou vide
`;

  const tableConfigExamples = maxTables >= 3
    ? `Exemples de configurations possibles pour ${totalPlayers} joueurs :
  - 1 table de ${totalPlayers} (tous ensemble) — pour les jeux qui supportent ce nombre
  - 2 tables (ex: ${Math.ceil(totalPlayers/2)} + ${Math.floor(totalPlayers/2)}) — pour les jeux à effectif limité
  - 3 tables (ex: ${Math.ceil(totalPlayers/3)} + ${Math.floor(totalPlayers/3)} + ${Math.floor(totalPlayers/3)}) — pour les jeux à petit effectif (3-4 joueurs)`
    : maxTables === 2
    ? `Exemples de configurations possibles pour ${totalPlayers} joueurs :
  - 1 table de ${totalPlayers} (tous ensemble) — pour les jeux qui supportent ce nombre
  - 2 tables (ex: ${Math.ceil(totalPlayers/2)} + ${Math.floor(totalPlayers/2)}) — pour les jeux à effectif limité`
    : `1 seule table de ${totalPlayers} joueurs.`;

  const exampleA = participantNames.split(', ').slice(0, Math.ceil(totalPlayers/2)).join(', ');
  const exampleB = participantNames.split(', ').slice(Math.ceil(totalPlayers/2)).join(', ');

  const sharedRules = `
RÈGLES ABSOLUES — chaque violation est une erreur grave :
1. TOUS les joueurs (${participantNames}) doivent apparaître dans chaque créneau non-pause, répartis sur les tables
2. Un joueur ne peut être que sur UNE SEULE table par créneau
3. Le teacher est OBLIGATOIREMENT dans la liste players de sa table
4. Écart max 1 joueur entre tables parallèles (${totalPlayers} joueurs sur 2 tables = ${Math.ceil(totalPlayers/2)}+${Math.floor(totalPlayers/2)}, JAMAIS ${totalPlayers-1}+1)
5. Respecter strictement min/max joueurs de chaque jeu
6. Tables parallèles = durées similaires (même ordre de grandeur)
7. Un joueur absent d'un créneau = ERREUR`;

  const jsonExample = `
FORMAT JSON OBLIGATOIRE — réponds UNIQUEMENT avec ce JSON, zéro texte autour :
{
  "slots": [
    {
      "start_time": "10:00",
      "game_name": "Jeu tous ensemble",
      "duration_min": 90,
      "players": "${participantNames}",
      "teacher": "Alice",
      "game_name_b": "", "duration_min_b": 0, "players_b": "", "teacher_b": "",
      "game_name_c": "", "duration_min_c": 0, "players_c": "", "teacher_c": "",
      "note": "", "is_break": false
    },
    {
      "start_time": "11:30",
      "game_name": "Jeu Table A",
      "duration_min": 90,
      "players": "${exampleA}",
      "teacher": "Bob",
      "game_name_b": "Jeu Table B", "duration_min_b": 75, "players_b": "${exampleB}", "teacher_b": "Charlie",
      "game_name_c": "", "duration_min_c": 0, "players_c": "", "teacher_c": "",
      "note": "", "is_break": false
    },
    {
      "start_time": "13:00",
      "game_name": "Pause déjeuner",
      "duration_min": 60,
      "players": "tous",
      "teacher": "",
      "game_name_b": "", "duration_min_b": 0, "players_b": "", "teacher_b": "",
      "game_name_c": "", "duration_min_c": 0, "players_c": "", "teacher_c": "",
      "note": "", "is_break": true
    }
  ],
  "unscheduled": ["Jeu non programmé"]
}`;

  const prompt = isFreeMode
  ? `Tu crées un programme de journée jeux de société.

PARTICIPANTS (${totalPlayers}) : ${participantNames}
JOURNÉE : ${session.name} — ${session.date}

DEMANDE DE L'ORGANISATEUR :
${freeText}

JEUX DISPONIBLES (par ordre de vote) :
${gamesList}
${sharedRules}

RÈGLES SUPPLÉMENTAIRES :
- Si restrictions joueur/jeu mentionnées → les respecter strictement
- Teacher sur 2 tables sans 2 teachers → 1 seule table pour ce jeu
- Max 3 fois teacher pour un même joueur sur la journée
${jsonExample}`
  : `Tu crées un programme de journée jeux de société.

PARTICIPANTS (${totalPlayers}) : ${participantNames}
JOURNÉE : ${session.name} — ${session.date} — ${startTime} → ${endTime}
${lunchInfo ? `PAUSE : ${lunchInfo}` : ''}
TABLES MAX PAR CRÉNEAU : ${maxTables}
${parseInt(nbTogether) > 0 ? `CRÉNEAUX TOUS ENSEMBLE (obligatoire) : ${nbTogether}` : ''}
${parseInt(nbParallel) > 0 ? `CRÉNEAUX EN PARALLÈLE (obligatoire) : ${nbParallel}` : ''}

JEUX DISPONIBLES (par ordre de vote) :
${gamesList}

LOGIQUE DE CONFIGURATION :
- Jeu supporte ${totalPlayers}+ joueurs → 1 table, tous ensemble
- Jeu max 3-5 joueurs → ${maxTables} tables en parallèle
- Commence par les jeux les mieux votés
- Alterne jeux longs et courts
- Prévois durée jeu + durée teaching si indiquée
- Jeux non programmables → mettre dans "unscheduled"
${sharedRules}
${jsonExample}
- Ne jamais dépasser ${maxTables} table(s) simultanée(s)`;

  // ── Pré-calcul des contraintes ────────────────────────────
  const allParticipantNames = participants.map(p => p.username);
  const teacherByGame = {};
  proposals.forEach(p => { if (p.teacher) teacherByGame[p.name.toLowerCase()] = p.teacher; });

  // Calcul du timing disponible
  const [sh, sm] = (startTime || '10:00').split(':').map(Number);
  const [eh, em] = (endTime || '18:00').split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm) - (hasLunch ? (parseInt(lunchDurationMinutes) || 60) : 0);

  // Contraintes pré-calculées à injecter dans le prompt
  const preComputed = `
**Données pré-calculées pour t'aider :**
- Temps de jeu disponible : ${totalMinutes}min
- Participants (${allParticipantNames.length}) : ${allParticipantNames.join(', ')}
- Teachers confirmés : ${Object.entries(teacherByGame).map(([g,t]) => `${t} → "${g}"`).join(', ') || 'aucun'}
- Répartition idéale pour ${allParticipantNames.length} joueurs :
  - 2 tables : ${Math.ceil(allParticipantNames.length/2)} + ${Math.floor(allParticipantNames.length/2)} joueurs
  - 3 tables : ${Math.ceil(allParticipantNames.length/3)} + ${Math.floor(allParticipantNames.length/3)} + ${Math.floor(allParticipantNames.length/3)} joueurs
`;

  // ── Fonction de vérification des règles ──────────────────
  function verifySlots(slots) {
    const violations = [];
    slots.forEach((s, i) => {
      if (s.is_break) return;
      const hasB = !!(s.game_name_b?.trim());
      const hasC = !!(s.game_name_c?.trim());
      const tables = [
        { game: s.game_name, players: s.players, teacher: s.teacher },
        ...(hasB ? [{ game: s.game_name_b, players: s.players_b, teacher: s.teacher_b }] : []),
        ...(hasC ? [{ game: s.game_name_c, players: s.players_c, teacher: s.teacher_c }] : []),
      ];

      // R1 : teacher dans les joueurs
      tables.forEach((t, ti) => {
        if (!t.teacher) return;
        const playerList = (t.players || '').split(',').map(p => p.trim().toLowerCase());
        const isTous = !t.players || t.players.toLowerCase() === 'tous';
        if (!isTous && !playerList.includes(t.teacher.toLowerCase())) {
          violations.push(`Créneau ${s.start_time} table ${['A','B','C'][ti]} : "${t.teacher}" est teacher de "${t.game}" mais n'est pas dans les joueurs (${t.players})`);
        }
      });

      // R2 : joueur sur 2 tables
      if (hasB || hasC) {
        const allAssigned = tables.flatMap(t => {
          const isTous = !t.players || t.players.toLowerCase() === 'tous';
          return isTous ? allParticipantNames : (t.players || '').split(',').map(p => p.trim()).filter(Boolean);
        });
        const counts = {};
        allAssigned.forEach(n => counts[n.toLowerCase()] = (counts[n.toLowerCase()] || 0) + 1);
        Object.entries(counts).forEach(([name, count]) => {
          if (count > 1) violations.push(`Créneau ${s.start_time} : "${name}" apparaît sur ${count} tables simultanées`);
        });

        // R9 : répartition équitable (écart max 1)
        const sizes = tables.map(t => {
          const isTous = !t.players || t.players.toLowerCase() === 'tous';
          return isTous ? allParticipantNames.length : (t.players || '').split(',').filter(Boolean).length;
        });
        if (Math.max(...sizes) - Math.min(...sizes) > 1) {
          violations.push(`Créneau ${s.start_time} : répartition déséquilibrée (${sizes.join('+')} joueurs) — écart max 1`);
        }

        // R7 : tous les joueurs jouent
        const assigned = new Set(tables.flatMap(t => {
          const isTous = !t.players || t.players.toLowerCase() === 'tous';
          return isTous ? allParticipantNames.map(n => n.toLowerCase()) : (t.players || '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
        }));
        const missing = allParticipantNames.filter(n => !assigned.has(n.toLowerCase()));
        if (missing.length) violations.push(`Créneau ${s.start_time} : joueurs absents — ${missing.join(', ')}`);
      }
    });
    return violations;
  }

  // ── Appel IA avec boucle de correction ───────────────────
  try {
    const fetch = require('node-fetch');

    async function callAI(promptText) {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: isFreeMode ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
          max_tokens: isFreeMode ? 4000 : 2000,
          messages: [{ role: 'user', content: promptText }]
        })
      });
      if (!aiRes.ok) {
        const err = await aiRes.json();
        throw new Error(err.error?.message || `Erreur API ${aiRes.status}`);
      }
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || '{}';
      let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) clean = jsonMatch[0];
      return JSON.parse(clean);
    }

    // Injecter les données pré-calculées dans le prompt
    const fullPrompt = prompt.replace('**Jeux disponibles', preComputed + '\n**Jeux disponibles');

    // 1ère génération
    let parsed = await callAI(fullPrompt);
    let slots = parsed.slots || [];

    // Vérification et boucle de correction (max 2 itérations)
    for (let iter = 0; iter < 2; iter++) {
      const violations = verifySlots(slots);
      if (!violations.length) break;
      console.log(`Itération ${iter + 1} — ${violations.length} violation(s) détectée(s):`, violations);

      const correctionPrompt = `Tu as généré ce programme JSON :
${JSON.stringify({ slots }, null, 2)}

Les règles suivantes ne sont PAS respectées :
${violations.map((v, i) => `${i+1}. ${v}`).join('\n')}

Corrige UNIQUEMENT ces violations et retourne le programme JSON complet corrigé.
Rappel des règles absolues :
- Le teacher DOIT être dans les joueurs de sa table
- Un joueur ne peut être que sur UNE seule table par créneau
- Écart max 1 joueur entre les tables parallèles
- Tous les participants (${allParticipantNames.join(', ')}) doivent jouer à chaque créneau

${jsonFormatInstructions}`;

      const corrected = await callAI(correctionPrompt);
      slots = corrected.slots || slots;
    }

    const unscheduled = parsed.unscheduled || [];

    // Post-traitement : corriger la répartition des joueurs sur les tables parallèles

    // 1. Supprimer les créneaux invalides (sans jeu et sans pause)
    const validSlots = slots.filter(s => s.is_break || (s.game_name && s.game_name.trim()));
    slots.length = 0;
    validSlots.forEach(s => slots.push(s));

    // 2. Supprimer les doublons (même start_time + même game_name)
    const seen = new Set();
    const uniqueSlots = slots.filter(s => {
      const key = `${s.start_time}_${s.game_name}_${s.game_name_b || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    slots.length = 0;
    uniqueSlots.forEach(s => slots.push(s));
    // allParticipantNames et teacherByGame déjà déclarés plus haut

    function parsePlayerList(str) {
      if (!str || str.toLowerCase() === 'tous') return [...allParticipantNames];
      return str.split(',').map(s => s.trim()).filter(Boolean);
    }

    function distributeEquitably(names, nbTables) {
      const shuffled = [...names];
      const tables = Array.from({length: nbTables}, () => []);
      shuffled.forEach((name, i) => tables[i % nbTables].push(name));
      return tables;
    }

    slots.forEach(s => {
      if (s.is_break) return;

      const hasB = !!(s.game_name_b && s.game_name_b.trim());
      const hasC = !!(s.game_name_c && s.game_name_c.trim());
      const nbTables = hasC ? 3 : hasB ? 2 : 1;

      // Injecter le teacher depuis les proposals si Claude ne l'a pas mis
      if (!s.teacher && s.game_name) s.teacher = teacherByGame[s.game_name.toLowerCase()] || '';
      if (!s.teacher_b && s.game_name_b) s.teacher_b = teacherByGame[s.game_name_b.toLowerCase()] || '';
      if (!s.teacher_c && s.game_name_c) s.teacher_c = teacherByGame[s.game_name_c.toLowerCase()] || '';

      if (nbTables === 1) {
        // Table unique : tous les participants jouent, sans exception
        s.players = allParticipantNames.join(', ');
        // S'assurer que le teacher est bien là (il est dans allParticipantNames normalement)
        if (s.teacher && !allParticipantNames.map(n=>n.toLowerCase()).includes(s.teacher.toLowerCase())) {
          s.players = s.teacher + ', ' + s.players;
        }
        return;
      }

      // Tables parallèles : redistribution intelligente
      // Étape 1 : construire les contraintes teachers (chaque teacher DOIT être à sa table)
      const teachers = [s.teacher, hasB ? s.teacher_b : null, hasC ? s.teacher_c : null];
      const teacherAssigned = {}; // nom -> index de table
      teachers.forEach((t, i) => { if (t) teacherAssigned[t.toLowerCase()] = i; });

      // Étape 2 : répartir tous les participants en respectant les teachers
      const remaining = allParticipantNames.filter(n => teacherAssigned[n.toLowerCase()] === undefined);
      const tablePlayers = Array.from({length: nbTables}, (_, i) => {
        const t = teachers[i];
        return t ? [t] : [];
      });

      // Distribuer les autres équitablement
      remaining.forEach(name => {
        const minIdx = tablePlayers.reduce((mi, t, i) => t.length < tablePlayers[mi].length ? i : mi, 0);
        tablePlayers[minIdx].push(name);
      });

      s.players = tablePlayers[0].join(', ');
      if (hasB) s.players_b = tablePlayers[1].join(', ');
      if (hasC) s.players_c = tablePlayers[2].join(', ');
    });

    // Sauvegarder en base
    db.prepare('DELETE FROM programme_slots WHERE session_id = ?').run(sessionId);
    const ins = db.prepare('INSERT INTO programme_slots (session_id, sort_order, start_time, game_name, duration_est, players, note, is_break, game_name_b, players_b, game_name_c, players_c) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction((list) => {
      list.forEach((s, i) => ins.run(sessionId, i, s.start_time||'', s.game_name||'', s.duration_min||s.duration_est||null, s.players||'tous', s.note||'', s.is_break?1:0, s.game_name_b||'', s.players_b||'', s.game_name_c||'', s.players_c||''));
    })(slots);

    res.json({
      ok: true,
      slots,
      unscheduled,
      generatedAt: new Date().toISOString(),
      sessionName: session.name
    });

  } catch(e) {
    console.error('Erreur génération programme:', e.message);
    res.status(502).json({ error: 'Erreur lors de la génération : ' + e.message });
  }
});

// PATCH /api/sessions/:id/programme/validate
router.patch('/api/sessions/:id/programme/validate', requireAuth, requirePerm('programme_publish', req => { const s = db.prepare('SELECT created_by FROM sessions WHERE id=?').get(parseInt(req.params.id)); return s?.created_by; }), (req, res) => {
  const sessId = parseInt(req.params.id);
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessId);
  if (!sess) return res.status(404).json({ error: 'Séance introuvable' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (sess.created_by !== req.session.userId && !user?.is_admin) return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('UPDATE sessions SET programme_validated = 1 WHERE id = ?').run(sessId);
  res.json({ ok: true });
});

// PATCH /api/sessions/:id/programme/unvalidate
router.patch('/api/sessions/:id/programme/unvalidate', requireAuth, (req, res) => {
  const sessId = parseInt(req.params.id);
  db.prepare('UPDATE sessions SET programme_validated = 0 WHERE id = ?').run(sessId);
  res.json({ ok: true });
});

// GET /api/sessions/:id/programme
router.get('/api/sessions/:id/programme', requireAuth, (req, res) => {
  const slots = db.prepare('SELECT * FROM programme_slots WHERE session_id = ? ORDER BY start_time ASC, sort_order ASC').all(parseInt(req.params.id));
  res.json({ slots });
});

// POST /api/sessions/:id/programme — sauvegarder programme IA
router.post('/api/sessions/:id/programme', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { slots } = req.body;
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots requis' });
  db.prepare('DELETE FROM programme_slots WHERE session_id = ?').run(sessionId);
  const ins = db.prepare('INSERT INTO programme_slots (session_id, sort_order, start_time, game_name, duration_est, players, note, is_break, game_name_b, players_b, game_name_c, players_c) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction((list) => {
    list.forEach((s, i) => ins.run(sessionId, i, s.start_time||'', s.game_name||'', s.duration_min||s.duration_est||null, s.players||'tous', s.note||'', s.is_break?1:0, s.game_name_b||'', s.players_b||'', s.game_name_c||'', s.players_c||''));
  })(slots);
  res.json({ ok: true });
});

// POST /api/programme/estimate-slot — estimer durée d'un seul jeu
router.post('/api/programme/estimate-slot', requireAuth, async (req, res) => {
  const { gameName, nbPlayers } = req.body;
  if (!gameName) return res.status(400).json({ error: 'Nom du jeu manquant' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'CLÉ_MANQUANTE' });
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{ role: 'user', content:
        `Pour le jeu de société "${gameName}" joué à ${nbPlayers || 4} joueurs, donne uniquement la durée estimée en minutes (juste un nombre entier, rien d'autre). Si tu ne connais pas ce jeu, réponds "inconnu".`
      }]
    });
    const txt = msg.content[0]?.text?.trim() || '';
    const min = parseInt(txt);
    if (isNaN(min)) return res.json({ duration: null, unknown: true });
    res.json({ duration: min });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/programme/estimate — évaluer durée séance avec Claude
router.post('/api/programme/estimate', requireAuth, async (req, res) => {
  const { sessionId, startTime, endTime, hasLunch, lunchDurationMinutes, nbPlayers } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'CLÉ_MANQUANTE', message: 'Clé API Anthropic manquante.' });

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });

  const proposals = db.prepare(`
    SELECT p.name, p.min_players, p.max_players, p.min_time, p.max_time, p.bgg_id
    FROM proposals p WHERE p.session_id = ? ORDER BY p.name
  `).all(sessionId);

  const manualSlotsCheck = db.prepare('SELECT COUNT(*) as c FROM programme_slots WHERE session_id = ? AND is_break = 0').get(sessionId);
  if (!proposals.length && !manualSlotsCheck.c) return res.status(400).json({ error: 'Aucun jeu proposé ni créneau manuel — ajoutez des jeux d\'abord.' });

  // Calculer le temps dispo
  const [sh, sm] = (startTime || '10:00').split(':').map(Number);
  const [eh, em] = (endTime || '18:00').split(':').map(Number);
  const totalMin = (eh * 60 + em) - (sh * 60 + sm) - (hasLunch ? (lunchDurationMinutes || 60) : 0);

  // Récupérer aussi les créneaux manuels si dispo
  const manualSlots = db.prepare('SELECT * FROM programme_slots WHERE session_id = ? AND is_break = 0 ORDER BY sort_order').all(sessionId);

  let gamesDesc;
  if (manualSlots.length > 0) {
    // Utiliser les créneaux manuels avec leur nb_players
    gamesDesc = manualSlots.map(s => {
      const parts = [];
      if (s.game_name) {
        const nb = s.nb_players ? `${s.nb_players} joueurs` : `${nbPlayers || '?'} joueurs`;
        const dur = s.duration_max > s.duration_min ? `${s.duration_min}-${s.duration_max}min (renseigné)` : s.duration_min ? `${s.duration_min}min (renseigné)` : 'durée non renseignée';
        parts.push(`- ${s.game_name} (${nb}) : ${dur}`);
      }
      if (s.game_name_b) {
        const nb = s.nb_players_b ? `${s.nb_players_b} joueurs` : `${nbPlayers || '?'} joueurs`;
        const dur = s.duration_max_b > s.duration_min_b ? `${s.duration_min_b}-${s.duration_max_b}min (renseigné)` : s.duration_min_b ? `${s.duration_min_b}min (renseigné)` : 'durée non renseignée';
        parts.push(`  Table B: ${s.game_name_b} (${nb}) : ${dur}`);
      }
      return parts.join('\n');
    }).filter(Boolean).join('\n');
  } else {
    // Utiliser les propositions
    gamesDesc = proposals.map(p => {
      const players = p.min_players && p.max_players ? `${p.min_players}-${p.max_players} joueurs (boîte)` : '';
      const time = p.min_time && p.max_time ? `${p.min_time}-${p.max_time}min (boîte)` : p.min_time ? `${p.min_time}min (boîte)` : 'durée inconnue';
      return `- ${p.name}${players ? ' (' + players + ')' : ''} : ${time}`;
    }).join('\n');
  }

  const prompt = `Tu es un expert en jeux de société. Voici les jeux proposés pour une séance avec ${nbPlayers || 4} joueurs :

${gamesDesc}

Temps disponible : ${totalMin} minutes (de ${startTime} à ${endTime}${hasLunch ? `, pause déjeuner de ${lunchDurationMinutes}min incluse` : ''}).

Pour chaque jeu, estime la durée RÉELLE avec ${nbPlayers} joueurs (la durée boîte est souvent pour 2-4j, elle augmente avec plus de joueurs). Puis évalue si on peut tout jouer, ou propose une sélection réaliste.

Réponds en HTML simple avec cette structure exacte :
<h3>⏱ Estimation des durées</h3>
<div class="estim-game"><span>[Nom du jeu]</span><span>[X min estimés]</span></div>
... (un div par jeu)
<div class="estim-total">Total : [X min] sur [totalMin] disponibles</div>
<div class="estim-[ok|warn|over]">[Conclusion : réaliste / serré / trop chargé, avec conseil bref]</div>`;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ html: msg.content[0]?.text || '' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/programme/slots — ajouter un creneau
router.post('/api/programme/slots', requireAuth, requirePerm('programme_edit'), (req, res) => {
  try {
    const { sessionId, start_time, game_name, players, note, is_break, sort_order,
            game_name_b, players_b, game_name_c, players_c } = req.body;
    const { duration_est, nb_players, duration_est_b, nb_players_b, teacher, teacher_b,
            duration_est_c, nb_players_c, teacher_c,
            thumbnail, thumbnail_b, thumbnail_c } = req.body;
    const r = db.prepare(`INSERT INTO programme_slots
      (session_id, sort_order, start_time, game_name, duration_est, nb_players, players, teacher, note, is_break,
       game_name_b, duration_est_b, nb_players_b, players_b, teacher_b,
       game_name_c, duration_est_c, nb_players_c, players_c, teacher_c,
       thumbnail, thumbnail_b, thumbnail_c)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sessionId, sort_order||0, start_time||'', game_name||'', duration_est??null, nb_players??null,
           players||'', teacher||'', note||'', is_break?1:0,
           game_name_b||'', duration_est_b??null, nb_players_b??null, players_b||'', teacher_b||'',
           game_name_c||'', duration_est_c??null, nb_players_c??null, players_c||'', teacher_c||'',
           thumbnail||'', thumbnail_b||'', thumbnail_c||'');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch(e) {
    console.error('POST /api/programme/slots error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/programme/slots/:id — modifier un creneau
router.patch('/api/programme/slots/:id', requireAuth, requirePerm('programme_edit'), (req, res) => {
  const { start_time, game_name, duration_est, nb_players, players, teacher, note, is_break, sort_order,
          game_name_b, duration_est_b, nb_players_b, players_b, teacher_b,
          game_name_c, duration_est_c, nb_players_c, players_c, teacher_c,
          thumbnail, thumbnail_b, thumbnail_c } = req.body;
  db.prepare(`UPDATE programme_slots SET
    start_time=?, game_name=?, duration_est=?, nb_players=?, players=?, teacher=?, note=?, is_break=?, sort_order=?,
    game_name_b=?, duration_est_b=?, nb_players_b=?, players_b=?, teacher_b=?,
    game_name_c=?, duration_est_c=?, nb_players_c=?, players_c=?, teacher_c=?,
    thumbnail=?, thumbnail_b=?, thumbnail_c=? WHERE id=?`)
    .run(start_time||'', game_name||'', duration_est??null, nb_players??null, players||'', teacher||'', note||'', is_break?1:0, sort_order||0,
         game_name_b||'', duration_est_b??null, nb_players_b??null, players_b||'', teacher_b||'',
         game_name_c||'', duration_est_c??null, nb_players_c??null, players_c||'', teacher_c||'',
         thumbnail||'', thumbnail_b||'', thumbnail_c||'',
         parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/programme/slots/:id — supprimer un creneau
router.delete('/api/programme/slots/:id', requireAuth, requirePerm('programme_edit'), (req, res) => {
  db.prepare('DELETE FROM programme_slots WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// PATCH /api/programme/reorder — reordonner
router.patch('/api/programme/reorder', requireAuth, requirePerm('programme_edit'), (req, res) => {
  const { slots } = req.body;
  const upd = db.prepare('UPDATE programme_slots SET sort_order=? WHERE id=?');
  db.transaction((list) => list.forEach(s => upd.run(s.sort_order, s.id)))(slots);
  res.json({ ok: true });
});

// Tri des scores décroissant avec médailles
function sortScoresDesc(str) {
  if (!str) return str;
  const parts = str.split(',').map(p => {
    const m = p.trim().match(/^(.+?):\s*(.+)$/);
    if (!m) return { raw: p.trim(), num: NaN };
    return { name: m[1].trim(), val: m[2].trim(), num: parseFloat(m[2]) };
  });
  if (parts.every(p => !isNaN(p.num))) parts.sort((a,b) => b.num - a.num);
  const medals = ['🥇 ','🥈 ','🥉 '];
  return parts.map((p,i) => p.val !== undefined ? (medals[i]||'') + p.name + ': ' + p.val : p.raw).join(', ');
}

// GET /programme/:sessionId — page publique du programme (sans auth)
router.get('/programme/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).send('<h1>Programme introuvable</h1>');
  if (!session.programme_validated) return res.status(404).send('<h1>Programme non encore publié</h1>');
  const slots = db.prepare('SELECT * FROM programme_slots WHERE session_id = ? ORDER BY start_time ASC, sort_order ASC').all(sessionId);
  if (!slots.length) return res.status(404).send('<h1>Aucun programme pour cette séance</h1>');

  // Construire un index nom→thumbnail depuis les propositions et collections BGG
  const proposals = db.prepare('SELECT name, thumbnail FROM proposals WHERE session_id = ?').all(sessionId);
  const bggGames = db.prepare("SELECT name, thumbnail FROM bgg_games WHERE thumbnail != ''").all();
  const thumbIndex = {};
  bggGames.forEach(g => { if (g.thumbnail) thumbIndex[g.name.toLowerCase()] = g.thumbnail; });
  proposals.forEach(p => { if (p.thumbnail) thumbIndex[p.name.toLowerCase()] = p.thumbnail; });

  // Charger les participants pour résoudre "tous"
  const participants = db.prepare(`SELECT u.username FROM session_participants sp JOIN users u ON u.id = sp.user_id WHERE sp.session_id = ?`).all(sessionId);
  const allNames = participants.map(p => p.username).join(', ');
  function resolvePlayers(players) {
    if (!players || players.toLowerCase() === 'tous') return allNames || 'tous';
    return players;
  }

  function resolveThumb(slotThumb, name) {
    if (slotThumb) return slotThumb;
    return thumbIndex[name?.toLowerCase()] || '';
  }

  const slotsHtml = slots.map(s => {
    const hasTableB = s.game_name_b && s.game_name_b.trim();
    const hasTableC = s.game_name_c && s.game_name_c.trim();
    const multiTable = hasTableB || hasTableC;
    const thumb = resolveThumb(s.thumbnail, s.game_name);
    const thumbB = resolveThumb(s.thumbnail_b, s.game_name_b);
    const thumbC = resolveThumb(s.thumbnail_c, s.game_name_c);
    if (s.is_break) {
      return `<div class="slot break">
        <div class="slot-time">${esc(s.start_time)}</div>
        <div class="slot-body"><div class="slot-title break-title">☕ ${esc(s.game_name)}</div>${s.note ? `<div class="slot-note">${esc(s.note)}</div>` : ''}</div>
      </div>`;
    }
    const tableA = `<div class="table-block${multiTable ? ' multi' : ''}">
      ${multiTable ? '<div class="table-label">Table A</div>' : ''}
      <div class="slot-game-row">
        ${thumb ? `<img src="${esc(thumb)}" class="slot-cover" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="slot-title">${esc(s.game_name)}</div>
          <div class="slot-meta">${s.duration_est ? s.duration_est + 'min · ' : ''}${esc(resolvePlayers(s.players))}${s.teacher ? ' · 🎓 ' + esc(s.teacher) : ''}</div>
        </div>
      </div>
    </div>`;
    const tableB = hasTableB ? `<div class="table-block multi">
      <div class="table-label">Table B</div>
      <div class="slot-game-row">
        ${thumbB ? `<img src="${esc(thumbB)}" class="slot-cover" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="slot-title">${esc(s.game_name_b)}</div>
          <div class="slot-meta">${s.duration_est_b ? s.duration_est_b + 'min · ' : ''}${esc(resolvePlayers(s.players_b))}${s.teacher_b ? ' · 🎓 ' + esc(s.teacher_b) : ''}</div>
        </div>
      </div>
    </div>` : '';
    const tableC = hasTableC ? `<div class="table-block multi">
      <div class="table-label">Table C</div>
      <div class="slot-game-row">
        ${thumbC ? `<img src="${esc(thumbC)}" class="slot-cover" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="slot-title">${esc(s.game_name_c)}</div>
          <div class="slot-meta">${s.duration_est_c ? s.duration_est_c + 'min · ' : ''}${esc(resolvePlayers(s.players_c))}${s.teacher_c ? ' · 🎓 ' + esc(s.teacher_c) : ''}</div>
        </div>
      </div>
    </div>` : '';
    return `<div class="slot">
      <div class="slot-time">${esc(s.start_time)}</div>
      <div class="slot-body">${tableA}${tableB}${tableC}${s.note ? `<div class="slot-note">💬 ${esc(s.note)}</div>` : ''}</div>
    </div>`;
  }).join('');

  function esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const html = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Programme — ${esc(session.name)}</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
a{text-decoration:none;color:inherit}
:root,[data-theme="light"]{--bg:#e0d9ce;--card:#ece6db;--card2:#d8d2c6;--text:#1a1a2e;--text2:#555;--text3:#888;--accent:#4a6fa5;--border:#c8c2b6;--break-bg:#f0ead8;--break-border:#c8a878;}
[data-theme="dark"]{--bg:#0f0e0b;--card:#1a1814;--card2:#222019;--text:#e8e4d8;--text2:#a09880;--text3:#666;--accent:#8ba3c7;--border:#2a2820;--break-bg:#1e1c14;--break-border:#3a3420;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px 16px;max-width:700px;margin:0 auto;transition:background .2s,color .2s}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}
.title-block h1{font-size:1.6rem;color:var(--text);margin-bottom:4px}
.subtitle{color:var(--text2);font-size:.9rem}
.theme-btn{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:.85rem;color:var(--text);transition:all .15s}
.theme-btn:hover{border-color:var(--accent)}
.actions{display:flex;gap:8px;margin-bottom:20px}
.print-btn{background:var(--accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.85rem}
.print-btn:hover{opacity:.85}
.slot{display:flex;gap:14px;margin-bottom:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 16px}
.slot.break{background:var(--break-bg);border-color:var(--break-border);border-style:dashed}
.slot-time{font-size:.95rem;font-weight:700;color:var(--accent);min-width:44px;flex-shrink:0;padding-top:2px}
.slot-body{flex:1;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
.table-block{flex:1;min-width:160px}
.table-block.multi{flex:1;min-width:140px;background:var(--card2);border-radius:6px;padding:6px 8px}
.table-label{font-size:.65rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.slot-game-row{display:flex;gap:8px;align-items:flex-start}
.slot-cover{width:42px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0}
.slot-title{font-size:.9rem;font-weight:600;color:var(--text)}
.break-title{color:var(--text2)}
.slot-meta{font-size:.75rem;color:var(--text2);margin-top:2px}
.slot-note{font-size:.72rem;color:var(--text3);font-style:italic;margin-top:4px;width:100%}
.footer{font-size:.7rem;color:var(--text3);margin-top:24px;text-align:center}
@media print{.print-btn,.theme-btn{display:none}body{background:#fff;padding:12px}h1{font-size:1.3rem}.slot{box-shadow:none}}
</style>
</head>
<body>
<div class="topbar">
  <div class="title-block">
    <h1>🎲 ${esc(session.name)}</h1>
    <div class="subtitle">Programme de la journée — ${esc(session.date || '')}</div>
  </div>
  <button class="theme-btn" onclick="toggleTheme()" id="themeBtn">🌙 Sombre</button>
</div>
<div class="actions">
  <button class="print-btn" onclick="window.print()">🖨️ Imprimer / PDF</button>
</div>
${slotsHtml}
<p class="footer">Généré par GameDay · pandagaming.ch</p>
<script>
function toggleTheme(){
  const html=document.documentElement;
  const isDark=html.getAttribute('data-theme')==='dark';
  html.setAttribute('data-theme',isDark?'light':'dark');
  document.getElementById('themeBtn').textContent=isDark?'🌙 Sombre':'☀️ Clair';
  localStorage.setItem('gd_prog_theme',isDark?'light':'dark');
}
const saved=localStorage.getItem('gd_prog_theme');
if(saved){document.documentElement.setAttribute('data-theme',saved);document.getElementById('themeBtn').textContent=saved==='dark'?'☀️ Clair':'🌙 Sombre';}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});


module.exports = router;
