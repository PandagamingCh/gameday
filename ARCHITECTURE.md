# GameDay V3 — Architecture technique

Organisateur de journées jeux de société. Application web mono-page (SPA) avec backend Node.js.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Serveur | Node.js + Express |
| Base de données | SQLite (via better-sqlite3) |
| Frontend | HTML/CSS/JS vanilla (pas de framework) |
| Auth | Sessions Express + bcrypt |
| IA | API Anthropic Claude (optionnel) |
| BGG | API publique BoardGameGeek |
| Tests | Playwright (e2e) |

---

## Structure des fichiers

```
gameday/
├── server.js                  — Point d'entrée : configure Express, monte les routes
├── src/
│   ├── database.js            — Connexion SQLite, migrations, ensureAdmin()
│   ├── bgg.js                 — Intégration BoardGameGeek (sync collection, search)
│   ├── backup.js              — Sauvegarde automatique de la base de données
│   ├── email.js               — Utilitaires SMTP (createTransporter, getEmailSetting)
│   ├── upload.js              — Configuration multer pour les uploads photos/vidéos
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
│       └── doodle.js          — Sondages de disponibilité
├── public/
│   ├── index.html             — Squelette HTML de la SPA (toutes les pages sont dans ce fichier)
│   ├── css/
│   │   └── style.css          — Tous les styles (thème clair/sombre via CSS variables)
│   └── js/
│       ├── api.js             — Fonction api(), showToast(), helpers utilitaires
│       ├── theme.js           — Gestion thème, applyFeatures(), setTheme(), éditeur CSS
│       ├── app.js             — State global, init(), onLoggedIn(), showPage() — chargé en dernier
│       ├── auth.js            — doLogin(), doRegister(), doLogout()
│       ├── home.js            — Page accueil, liste des séances, makeSessionCard()
│       ├── session.js         — Chargement séance, participants, tabs
│       ├── proposals.js       — Panel propositions, collection BGG, ajout manuel
│       ├── vote.js            — Panel vote, drag & drop, submitRanking()
│       ├── results.js         — Panel résultats, calcul scores
│       ├── profile.js         — Page profil, sync BGG, changement pseudo/mot de passe
│       ├── programme.js       — Panel programme, slots, génération IA
│       ├── admin.js           — Page admin, permissions, éditeur thème
│       ├── archive.js         — Panel archive, photos, scores, stats
│       ├── lightbox.js        — Galerie photos plein écran
│       └── doodle.js          — Page sondages de disponibilité
├── tests/
│   ├── helpers.js             — Fonctions partagées : login(), createTestSession(), openManualForm()
│   ├── auth.spec.js           — Tests authentification
│   ├── session.spec.js        — Tests séances
│   ├── proposals.spec.js      — Tests propositions
│   ├── vote.spec.js           — Tests votes
│   ├── programme.spec.js      — Tests programme
│   ├── admin.spec.js          — Tests administration
│   └── global.teardown.js     — Nettoyage séances [TEST] après chaque run
└── data/
    └── gameday.db             — Base SQLite (NE PAS versionner)
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

Les migrations sont dans `src/database.js`. Chaque migration est idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` protégé par try/catch).

Tables principales : `users`, `sessions`, `session_members`, `categories`, `proposals`, `rankings`, `programme_slots`, `settings`, `permissions`, `invites`, `doodles`, `archive_games`, `archive_photos`.

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SESSION_SECRET` | ✅ prod | Clé de chiffrement des sessions |
| `ADMIN_PASSWORD` | ✅ prod | Mot de passe du compte admin |
| `ANTHROPIC_API_KEY` | ❌ | Active la génération IA du programme |
| `SMTP_HOST/PORT/USER/PASS` | ❌ | Active le reset de mot de passe par email |
| `APP_URL` | ❌ | URL publique du site (pour les liens email) |
| `ADMIN_RESET_TOKEN` | ❌ | Token pour reset admin via URL |

---

## Lancer le projet

```bash
# Développement
npm install
cp .env.example .env   # remplir les valeurs
node server.js

# Tests e2e
cp tests/.env.test.example .env.test
npm test

# Production (Docker)
docker compose up -d
```
