FROM node:20-alpine

WORKDIR /app

# Installer les dépendances de build pour better-sqlite3
RUN apk add --no-cache python3 make g++

# Copier package.json et installer les dépendances
COPY package*.json ./
RUN npm install

# Copier le reste du projet
COPY . .

# Créer le dossier data
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]
