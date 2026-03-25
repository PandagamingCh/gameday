# GameDay V4

Organisateur de journées jeux de société — propositions de jeux, votes, génération de programme.

Développé pour [pandagaming.ch](https://pandagaming.ch) · Licence AGPL v3

---

## Table des matières

- [Démarrage rapide](#démarrage-rapide)
- [Déploiement — hébergeur mutualisé Node.js](#déploiement--hébergeur-mutualisé-nodejs)
- [Déploiement — serveur dédié](#déploiement--serveur-dédié)
- [Premier lancement](#premier-lancement)
- [Fonctionnalités](#fonctionnalités)
- [Variables d'environnement](#variables-denvironnement)
- [Récupération du compte admin](#récupération-du-compte-admin)
- [Tests](#tests)
- [Architecture](#architecture)
- [Sécurité](#sécurité)
- [Licence](#licence)

---

## Démarrage rapide

### Avec Docker

```bash
cp .env.example .env        # remplir SESSION_SECRET et ADMIN_PASSWORD
docker compose up -d
```

### Sans Docker

```bash
npm install
cp .env.example .env        # remplir SESSION_SECRET et ADMIN_PASSWORD
node server.js
```

L'application est accessible sur `http://localhost:3000`

---

## Déploiement — hébergeur mutualisé Node.js

Pour les hébergeurs qui proposent Node.js en gestion simplifiée (pas d'accès root,
gestionnaire de processus intégré).

### 1. Préparer les fichiers

```bash
# En local — créer une archive sans node_modules ni base de données
zip -r gameday.zip . --exclude "node_modules/*" --exclude "data/*.db"
```

### 2. Déposer les fichiers

Transférez l'archive sur le serveur via FTP/SFTP ou l'interface web de l'hébergeur,
puis décompressez-la dans le dossier de votre application Node.js.

### 3. Installer les dépendances

Via SSH ou le terminal de l'hébergeur :

```bash
npm install --omit=dev
```

### 4. Configurer les variables d'environnement

Selon l'hébergeur, les variables se définissent soit :
- Dans un fichier `.env` à la racine du projet
- Dans l'interface de gestion (panneau de contrôle → variables d'environnement)

Variables obligatoires en production :
```env
SESSION_SECRET=une-longue-chaine-aleatoire-et-secrete
ADMIN_PASSWORD=votre-mot-de-passe-admin
```

### 5. Configurer le point d'entrée

Dans l'interface de l'hébergeur, indiquez `server.js` comme fichier de démarrage.

### 6. Mettre à jour le site

```bash
# Déposer les nouveaux fichiers (sans toucher au dossier data/)
# Puis redémarrer l'application depuis l'interface de l'hébergeur
```

> **Important :** ne jamais supprimer le dossier `data/` — il contient la base de données.

---

## Déploiement — serveur dédié

Pour un VPS ou serveur dédié avec accès SSH complet.

### 1. Transférer les fichiers

```bash
rsync -av --exclude='node_modules' --exclude='data/*.db' ./ user@serveur:/chemin/vers/gameday/
```

### 2. Installer les dépendances

```bash
cd /chemin/vers/gameday
npm install --omit=dev
```

### 3. Configurer l'environnement

```bash
cp .env.example .env
nano .env
```

### 4. Lancer avec PM2

[PM2](https://pm2.keymetrics.io) maintient le serveur en vie et le redémarre automatiquement.

```bash
npm install -g pm2
pm2 start server.js --name gameday
pm2 save        # sauvegarde pour redémarrage au reboot
pm2 startup     # configure le démarrage automatique
```

Commandes utiles :
```bash
pm2 logs gameday       # voir les logs en temps réel
pm2 restart gameday    # redémarrer après une mise à jour
pm2 stop gameday       # arrêter
```

### 5. Reverse proxy nginx

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
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 500M;   # pour les uploads photos/vidéos
    }
}
```

### 6. Mettre à jour

```bash
rsync -av --exclude='node_modules' --exclude='data/' ./ user@serveur:/chemin/vers/gameday/
pm2 restart gameday
```

---

## Premier lancement

Au démarrage, un compte **admin** est créé automatiquement avec le mot de passe
défini dans `ADMIN_PASSWORD` (défaut : `admin`).

**Connectez-vous avec :** `admin` / votre mot de passe

**Pour inviter des utilisateurs :**
1. Connectez-vous en tant qu'admin
2. Allez dans **Admin** → **Liens d'invitation**
3. Générez un lien et partagez-le

Les nouveaux utilisateurs s'inscrivent uniquement via un lien d'invitation valide.

---

## Fonctionnalités

| Feature | Description |
|---------|-------------|
| **Séances** | Créer et gérer des journées jeux |
| **Propositions** | Proposer des jeux depuis sa collection BGG ou manuellement |
| **Votes** | Classer les jeux par ordre de préférence (drag & drop) |
| **Programme** | Générer et publier le planning de la journée |
| **Programme IA** | Génération automatique via Claude (nécessite `ANTHROPIC_API_KEY`) |
| **Archives** | Compte-rendu, photos, scores des parties jouées |
| **Doodle** | Sondages de disponibilité pour planifier la date |
| **BGG** | Synchronisation automatique des collections BoardGameGeek |

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SESSION_SECRET` | ✅ en prod | Clé de chiffrement des sessions (chaîne aléatoire longue) |
| `ADMIN_PASSWORD` | ✅ en prod | Mot de passe du compte admin (défaut : `admin`) |
| `ANTHROPIC_API_KEY` | ❌ optionnel | Active la génération IA du programme |
| `ADMIN_RESET_TOKEN` | ❌ optionnel | Token pour récupérer l'accès admin (voir ci-dessous) |
| `SMTP_HOST` | ❌ optionnel | Serveur SMTP pour le reset de mot de passe par email |
| `SMTP_PORT` | ❌ optionnel | Port SMTP (défaut : 587) |
| `SMTP_SECURE` | ❌ optionnel | `true` pour SSL/TLS |
| `SMTP_USER` | ❌ optionnel | Identifiant SMTP |
| `SMTP_PASS` | ❌ optionnel | Mot de passe SMTP |
| `SMTP_FROM` | ❌ optionnel | Adresse expéditeur des emails |
| `APP_URL` | ❌ optionnel | URL publique du site (pour les liens dans les emails) |
| `PORT` | ❌ optionnel | Port d'écoute (défaut : 3000) |

---

## Récupération du compte admin

Si vous perdez l'accès au compte admin :

1. Ajoutez dans `.env` (ou les variables d'environnement de l'hébergeur) :
   ```env
   ADMIN_RESET_TOKEN=un-token-secret-de-votre-choix
   ```
2. Redémarrez le serveur
3. Accédez à `https://votre-site/admin-reset?token=un-token-secret-de-votre-choix`
4. Définissez un nouveau mot de passe

---

## Tests

Les tests end-to-end utilisent [Playwright](https://playwright.dev) et nécessitent
une instance GameDay en cours d'exécution.

```bash
# Configuration
cp tests/.env.test.example .env.test
# Éditez .env.test avec l'URL et les credentials de votre instance de test

# Installer Playwright
npm install
npx playwright install chromium

# Lancer les tests
npm test
```

Les tests couvrent : authentification, séances, propositions, votes, programme, administration.

---

## Architecture

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour la description complète de la structure du code,
le fonctionnement de la SPA, le système de permissions et la base de données.

---

## Sécurité

```bash
npm audit fix
```

À lancer après l'installation pour corriger les vulnérabilités connues.

---

## Licence

AGPL v3 — voir [LICENSE](./LICENSE)
