# Tests E2E — GameDay V5

Tests end-to-end avec Playwright. Simulent un vrai utilisateur dans un navigateur.

## Installation

```bash
npm install
npx playwright install chromium
```

## Configuration

Le fichier `.env.test` à la racine du projet contient les credentials utilisés par les tests.
Les valeurs doivent correspondre aux comptes existants dans votre instance GameDay.

```bash
# Adapter les valeurs à votre configuration
TEST_BASE_URL=http://localhost:3000
TEST_ADMIN_USER=admin
TEST_ADMIN_PASS=        # = votre ADMIN_PASSWORD dans .env
TEST_USER=user          # un second compte non-admin existant
TEST_USER_PASS=         # mot de passe de ce compte
```

> **Important** : `TEST_ADMIN_PASS` doit correspondre à `ADMIN_PASSWORD` dans votre `.env`.
> Le second utilisateur (`TEST_USER`) doit être créé manuellement via un lien d'invitation avant de lancer les tests.

## Lancer les tests

```bash
# Tous les tests (headless)
npm test

# Interface graphique avec replay
npm run test:ui

# Voir le rapport après les tests
npm run test:report
```

## Fichiers

| Fichier | Ce qu'il teste |
|---------|---------------|
| `auth.spec.js` | Login, logout, session |
| `session.spec.js` | Créer, rejoindre, quitter une séance |
| `proposals.spec.js` | Proposer, modifier, supprimer un jeu |
| `vote.spec.js` | Voter, auto-inscription |
| `programme.spec.js` | Créneaux, publication, classements |
| `admin.spec.js` | Page admin, invitations, utilisateurs |
