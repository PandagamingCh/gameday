# Tests E2E — GameDay V3.5

Tests end-to-end avec Playwright. Simulent un vrai utilisateur dans un navigateur.

## Installation

```bash
npm install
npx playwright install chromium
```

## Configuration

```bash
cp tests/.env.test.example .env.test
```

Éditez `.env.test` avec vos credentials :
```
TEST_BASE_URL=http://localhost:3000
TEST_ADMIN_USER=Panda
TEST_ADMIN_PASS=votre-mot-de-passe
```

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
