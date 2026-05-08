# GameDay V5

Organisateur de journées jeux de société — propositions, votes, génération de programme IA, archives et mode convention.

Développé pour [pandagaming.ch](https://pandagaming.ch) · Licence AGPL v3

---

## Table des matières

- [Démarrage rapide](#démarrage-rapide)
- [Déploiement Docker (recommandé)](#déploiement-docker-recommandé)
- [Déploiement serveur dédié](#déploiement--serveur-dédié)
- [Premier lancement](#premier-lancement)
- [Fonctionnalités](#fonctionnalités)
- [Variables d'environnement](#variables-denvironnement)
- [Régénérer le bundle JS](#régénérer-le-bundle-js)
- [Récupération du compte admin](#récupération-du-compte-admin)
- [Migration depuis SQLite](#migration-depuis-sqlite)
- [Tests](#tests)
- [Architecture](#architecture)
- [Licence](#licence)

---

## Démarrage rapide

```bash
cp .env.test .env
# Éditer .env avec vos valeurs
docker compose up -d
```

Accessible sur `http://localhost:3000`. PostgreSQL et l'application démarrent ensemble — le schéma est créé automatiquement au premier lancement.

---

## Déploiement Docker (recommandé)

### Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) ou Docker + Docker Compose (Linux)

### Installation

```bash
cd gameday_v5_deploy
cp .env.test .env
# Éditer .env : SESSION_SECRET, ADMIN_PASSWORD, ANTHROPIC_API_KEY...
docker compose up -d
docker compose logs -f gameday
```

### Commandes utiles

```bash
docker compose down                        # Arrêter
docker compose restart gameday             # Redémarrer l'app
docker compose up -d --build               # Reconstruire après modif code
docker compose logs --tail=50 gameday      # Voir les logs
```

### Copier un fichier modifié sans rebuild

```powershell
docker compose cp src/bgg.js gameday:/app/src/bgg.js
docker compose restart gameday
```

---

## Déploiement — serveur dédié

### Prérequis

- Node.js v20+
- PostgreSQL 14+

### Installation

```bash
rsync -av --exclude='node_modules' ./ user@serveur:/chemin/gameday/
cd /chemin/gameday && npm install --omit=dev && npm run build
npm install -g pm2
pm2 start server.js --name gameday
pm2 save && pm2 startup
```

### Reverse proxy nginx

```nginx
server {
    listen 80;
    server_name votre-domaine.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        client_max_body_size 500M;
    }
}
```

---

## Premier lancement

Un compte **admin** est créé automatiquement au démarrage avec le mot de passe défini dans `ADMIN_PASSWORD`.

**Connexion :** `admin` / votre mot de passe

**Inviter des utilisateurs :** Admin → Liens d'invitation → Générer un lien

---

## Fonctionnalités

| Feature | Description |
|---------|-------------|
| **Séances** | Mode normal ou convention |
| **Propositions** | Depuis collection BGG ou manuellement |
| **Votes** | Drag & drop, flèches mobile, scores Borda |
| **Programme** | Créneaux, tables numérotées, horaires en cascade |
| **Programme IA** | Génération via Claude (`ANTHROPIC_API_KEY` requis) |
| **Mode convention** | Réservation de tables, vue organisateur avec déplacement de joueurs |
| **Archives** | Compte-rendu, photos, vidéos, scores |
| **Doodle** | Sondages de disponibilité |
| **BGG** | Sync collections, recherche, descriptions traduites |
| **Page publique** | Programme + archive sans compte |

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | ✅ | URL PostgreSQL (ex: `postgresql://user:pass@host:5432/gameday`) |
| `SESSION_SECRET` | ✅ prod | Clé de chiffrement des sessions |
| `ADMIN_PASSWORD` | ✅ prod | Mot de passe admin (défaut : `admin`) |
| `ANTHROPIC_API_KEY` | ❌ | Active la génération IA du programme |
| `BGG_TOKEN` | ❌ | Token BGG Bearer (requis depuis juillet 2025) |
| `DB_SSL` | ❌ | `true` pour activer SSL PostgreSQL |
| `ADMIN_RESET_TOKEN` | ❌ | Token de récupération admin |
| `PORT` | ❌ | Port d'écoute (défaut : `3000`) |
| `SMTP_HOST` | ❌ | Serveur SMTP |
| `SMTP_PORT` | ❌ | Port SMTP (défaut : `587`) |
| `SMTP_SECURE` | ❌ | `true` pour SSL/TLS |
| `SMTP_USER` | ❌ | Identifiant SMTP |
| `SMTP_PASS` | ❌ | Mot de passe SMTP |
| `SMTP_FROM` | ❌ | Adresse expéditeur |
| `APP_URL` | ❌ | URL publique (liens emails) |

---

## Régénérer le bundle JS

Le frontend utilise `public/js/_all.js` — à régénérer après chaque modification JS :

```bash
npm run build
```

> Oublier cette étape est la cause la plus fréquente de dysfonctionnements frontend après un déploiement.

---

## Récupération du compte admin

1. Ajouter dans `.env` : `ADMIN_RESET_TOKEN=un-token-secret`
2. Redémarrer le serveur
3. Accéder à `/admin-reset?token=un-token-secret`

---

## Migration depuis SQLite

Si vous avez une base SQLite d'une version antérieure (v4), un script de migration est fourni dans `migrations/sqlite_to_postgres.sql`.

```bash
# 1. Démarrer les containers
docker compose up -d

# 2. Copier et injecter le script (attendre ~10s que le schéma soit créé)
docker compose cp migrations/sqlite_to_postgres.sql postgres:/tmp/migration.sql
docker compose exec postgres psql -U gameday -d gameday -f /tmp/migration.sql
```

> ⚠️ Le script commence par un `TRUNCATE` — il efface les données existantes avant d'importer.

---

## Tests

```bash
npx playwright install chromium
npm test
```

---

## Architecture

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour la description complète.

```
server.js              Point d'entrée
src/
  database.js          Connexion PostgreSQL + schéma + migrations auto
  bgg.js               Client BGG (sync collections)
  routes/
    auth.js            Authentification
    sessions.js        CRUD séances
    proposals.js       Propositions
    rankings.js        Votes
    programme.js       Programme + IA + réservations convention
    archives.js        Compte-rendu, médias, stats
    admin.js           Administration
    bgg.js             Routes BGG
    player_assign.js   Algorithme d'assignation des joueurs
    planning_algo.js   Algorithme de planification
public/
  js/                  Modules frontend (→ _all.js via npm run build)
  css/style.css
  index.html           SPA
migrations/
  sqlite_to_postgres.sql   Migration depuis une base SQLite v4
```

---

## Licence

AGPL v3 — voir [LICENSE](./LICENSE)
