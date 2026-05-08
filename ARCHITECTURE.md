# GameDay V5 — Architecture technique

Organisateur de journées jeux de société. Application web mono-page (SPA) avec backend Node.js et base de données PostgreSQL.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Serveur | Node.js + Express |
| Base de données | PostgreSQL 16 (via pg + pool) |
| Sessions | connect-pg-simple (sessions en base PostgreSQL) |
| Frontend | HTML/CSS/JS vanilla (pas de framework) |
| Auth | Sessions Express + bcrypt |
| IA | API Anthropic Claude (optionnel) |
| BGG | API publique BoardGameGeek |
| Tests | Playwright (e2e) |
| Déploiement | Docker Compose (app + postgres) |

---

## Structure des fichiers

```
gameday/
├── server.js                  — Point d'entrée : configure Express, monte les routes
├── src/
│   ├── database.js            — Pool PostgreSQL, helpers query/get/all/run, schéma, migrations
│   ├── bgg.js                 — Intégration BoardGameGeek (sync collection, search)
│   ├── backup.js              — Sauvegarde automatique de la base de données
│   ├── email.js               — Utilitaires SMTP (createTransporter, getEmailSetting)
│   ├── upload.js              — Configuration multer pour les uploads photos/vidéos
│   ├── sse.js                 — Server-Sent Events (notifications temps réel)
│   ├── middleware/
│   │   └── auth.js            — requireAuth, requireAdmin, requirePerm, canDo
│   └── routes/
│       ├── auth.js            — Login, logout, register, /api/me, profil, reset password
│       ├── sessions.js        — CRUD séances, participants, simulation de votes
│       ├── proposals.js       — CRUD propositions de jeux
│       ├── rankings.js        — Votes et classements
│       ├── categories.js      — CRUD catégories de jeux
│       ├── bgg.js             — Routes BGG (sync, search, enrich, collection)
│       ├── settings.js        — Thème global, SMTP, forgot/reset password
│       ├── invites.js         — Liens d'invitation
│       ├── programme.js       — Slots, génération IA, publication programme
│       ├── archives.js        — Compte-rendu, médias, scores, stats
│       ├── admin.js           — Utilisateurs, backup, permissions, admin-reset
│       ├── doodle.js          — Sondages de disponibilité
│       ├── planning_algo.js   — Algorithme de planification des créneaux
│       └── player_assign.js   — Algorithme d'assignation des joueurs aux tables
├── public/
│   ├── index.html             — Squelette HTML de la SPA
│   ├── manuel.html            — Documentation utilisateur
│   ├── css/
│   │   └── style.css          — Tous les styles (thème clair/sombre via CSS variables)
│   └── js/
│       ├── api.js             — Fonction api(), showToast(), helpers utilitaires
│       ├── theme.js           — Gestion thème, applyFeatures(), setTheme(), éditeur CSS
│       ├── app.js             — State global, init(), onLoggedIn(), showPage()
│       ├── auth.js            — doLogin(), doRegister(), doLogout()
│       ├── home.js            — Page accueil, liste des séances, makeSessionCard()
│       ├── session.js         — Chargement séance, participants, tabs
│       ├── proposals.js       — Panel propositions, collection BGG, ajout manuel
│       ├── vote.js            — Panel vote, drag & drop, submitRanking()
│       ├── results.js         — Panel résultats, calcul scores
│       ├── profile.js         — Page profil, sync BGG, changement pseudo/mot de passe
│       ├── programme.js       — Panel programme, slots, génération IA
│       ├── convention.js      — Mode convention, réservation de tables
│       ├── admin.js           — Page admin, permissions, éditeur thème
│       ├── admin_media.js     — Gestion médias admin
│       ├── archive.js         — Panel archive, photos, scores, stats
│       ├── lightbox.js        — Galerie photos plein écran
│       └── doodle.js          — Page sondages de disponibilité
├── migrations/
│   └── sqlite_to_postgres.sql — Script de migration depuis une base SQLite v4
├── tests/
│   ├── helpers.js             — Fonctions partagées : login(), createTestSession()
│   ├── auth.spec.js           — Tests authentification
│   ├── session.spec.js        — Tests séances
│   ├── proposals.spec.js      — Tests propositions
│   ├── vote.spec.js           — Tests votes
│   ├── programme.spec.js      — Tests programme
│   ├── admin.spec.js          — Tests administration
│   └── global.teardown.js     — Nettoyage séances [TEST] après chaque run
├── docker-compose.yml         — App + PostgreSQL
└── Dockerfile
```

---

## Comment fonctionne la SPA

Toutes les "pages" sont des `<div id="page-xxx">` dans `index.html`. La navigation ne recharge jamais la page — `showPage(id)` masque/affiche les divs.

```
init()              → vérifie la session
  → onLoggedIn()    → charge l'accueil et les données globales
    → showPage()    → affiche la bonne page
      → loadHome() / loadSession() / loadAdmin() / etc.
```

**Variables globales importantes** (définies dans `app.js`) :
- `currentUser` — utilisateur connecté `{ id, username, is_admin, bgg_username }`
- `currentSession` — séance actuellement ouverte (null si on est sur l'accueil)
- `siteFeatures` — features activées `{ bgg, ai, email_reset }`
- `sitePermissions` — niveaux de permission par action
- `allSiteUsers` — liste de tous les membres du site

---

## Système de permissions

Trois niveaux par action :
- `0` — Tous les membres
- `1` — Créateur / Proposant (propriétaire de la ressource)
- `2` — Admin uniquement

Les permissions sont configurables dans l'interface admin et stockées dans la table `permissions`.
Le middleware `requirePerm(action, getOwnerId)` dans `src/middleware/auth.js` gère la vérification.

---

## Base de données

PostgreSQL 16. La connexion est gérée via un pool `pg` dans `src/database.js`.

Les helpers `db.get()`, `db.all()`, `db.run()`, `db.transaction()` encapsulent les appels pool pour une API homogène dans toutes les routes.

Le schéma est initialisé au démarrage via `initSchema()` (idempotent — `CREATE TABLE IF NOT EXISTS`).

Tables principales : `users`, `sessions`, `session_participants`, `session_private_members`, `categories`, `proposals`, `rankings`, `programme_slots`, `slot_tables`, `convention_bookings`, `settings`, `permissions`, `invites`, `reset_tokens`, `doodles`, `doodle_dates`, `doodle_votes`, `archive_games`, `archive_media`, `archive_user_cr`, `archive_game_cr`, `session_notes`.

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | ✅ | URL PostgreSQL (`postgresql://user:pass@host:5432/db`) |
| `SESSION_SECRET` | ✅ prod | Clé de chiffrement des sessions |
| `ADMIN_PASSWORD` | ✅ prod | Mot de passe du compte admin |
| `ANTHROPIC_API_KEY` | ❌ | Active la génération IA du programme |
| `BGG_TOKEN` | ❌ | Token Bearer BGG (requis depuis juillet 2025) |
| `DB_SSL` | ❌ | `true` pour SSL PostgreSQL (hébergeurs cloud) |
| `SMTP_HOST/PORT/USER/PASS` | ❌ | Active le reset de mot de passe par email |
| `APP_URL` | ❌ | URL publique du site (pour les liens email) |
| `ADMIN_RESET_TOKEN` | ❌ | Token pour reset admin via URL |

---

## Lancer le projet

```bash
# Avec Docker (recommandé)
cp .env.test .env
docker compose up -d

# Sans Docker (PostgreSQL requis)
npm install
cp .env.test .env
npm start

# Tests e2e
npx playwright install chromium
npm test

# Régénérer le bundle JS après modification frontend
npm run build
```
