# Game Sales Tracker

Plateforme qui **estime les ventes de jeux vidéo** en agrégeant des signaux
publics, parce que les éditeurs divulguent rarement leurs chiffres unitaires.

Au lieu d’afficher un nombre exact inventé, le modèle :

1. Collecte des **snapshots de signaux** datés (avis Steam, notes PS/Xbox, etc.).
2. Applique un **multiplicateur Boxleiter** calibré (copies vendues par avis).
3. Retourne une **fourchette + niveau de confiance**.
4. Conserve les **chiffres officiels** à part, comme vérité terrain pour la calibration.

## Prérequis

| Outil | Version | Rôle |
| ----- | ------- | ---- |
| [Node.js](https://nodejs.org/) | 20+ (22 recommandé) | Backend NestJS + frontend Next.js |
| [Docker](https://www.docker.com/) | récent | PostgreSQL 16 + Redis en local |
| `psql` | optionnel | Restaurer le dump (sinon via `docker exec`, voir ci-dessous) |

Ports utilisés en local :

| Service | Port |
| ------- | ---- |
| Frontend | `3000` |
| Backend API | `3001` (`/api`) |
| PostgreSQL | `5433` |
| Redis | `6380` |

## Installation

### 1. Cloner le dépôt

```bash
git clone <url-du-repo> games-sales-tracker
cd games-sales-tracker
```

### 2. Démarrer PostgreSQL et Redis

```bash
docker compose up -d
```

Cela lance Postgres (`gamesales` / `gamesales` / base `gamesales` sur le port
**5433**) et Redis sur **6380**.

### 3. Restaurer le dump de prod (obligatoire pour avoir des données)

Le schéma et le catalogue de jeux ne se bootstrapent pas à partir de zéro :
**il faut importer un dump SQL** pour travailler avec des données réalistes
(jeux, signaux, estimations, milestones, etc.).

Le fichier attendu se trouve dans `backend/dumps/` (ex. `prod-2026-08-22.sql`,
~330 Mo). Ce dossier est gitignoré — récupérez le dump auprès d’un collègue ou
générez-le depuis la prod avec `pg_dump` (connexion directe Neon, pas le
pooler).

**Première installation** — volume Postgres vierge, restauration directe :

```bash
# Retire la directive \restrict (pg_dump 18 / Neon) incompatible avec psql 16
sed '/^\\restrict/d' backend/dumps/prod-2026-08-22.sql \
  | docker exec -i gamesales-postgres psql -U gamesales -d gamesales
```

La restauration prend quelques minutes. Des warnings sur le schéma `neon_auth`
(Neon) en local sont normaux et sans impact.

**Réimporter un dump** (remplacer toutes les données locales) :

```bash
docker compose down -v          # supprime le volume Postgres
docker compose up -d
sed '/^\\restrict/d' backend/dumps/prod-2026-08-22.sql \
  | docker exec -i gamesales-postgres psql -U gamesales -d gamesales
```

Alternative si `psql` est installé sur la machine (`brew install libpq`) :

```bash
sed '/^\\restrict/d' backend/dumps/prod-2026-08-22.sql \
  | psql "postgresql://gamesales:gamesales@localhost:5433/gamesales"
```

### 4. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

Le backend démarre sur **http://localhost:3001/api**.

Le `.env.example` pointe déjà vers la base Docker locale :

```
DATABASE_URL="postgresql://gamesales:gamesales@localhost:5433/gamesales"
```

Au boot, TypeORM applique les migrations en attente puis initialise l’extension
`pg_trgm` et l’index de recherche trigram sur `game.name`.

### 5. Frontend

Dans un second terminal :

```bash
cd frontend
npm install
npm run dev
```

Le frontend est disponible sur **http://localhost:3000**. Par défaut il appelle
l’API locale (`http://localhost:3001/api`) — aucun `.env` n’est requis pour le
dev local.

### 6. Vérifier

1. Ouvrir http://localhost:3000
2. Chercher un jeu connu (ex. « Hades », « Elden Ring »)
3. La fiche jeu doit afficher estimations, historique de signaux et milestones

Recherche typo-tolérante via PostgreSQL `pg_trgm` : `witchr` → The Witcher 3,
`eldn ring` → ELDEN RING.

## Variables d’environnement (backend)

Copier `backend/.env.example` → `backend/.env`. Seuls `DATABASE_URL` (et
`PORT` / `CORS_ORIGINS`) sont **obligatoires** pour le dev local après
restauration du dump.

| Variable | Obligatoire | Rôle |
| -------- | ----------- | ---- |
| `DATABASE_URL` | oui | Connexion Postgres runtime |
| `DATABASE_URL_DIRECT` | prod seulement | Connexion directe pour les migrations (Neon sans `-pooler`) |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | non | Import catalogue IGDB ([Twitch dev console](https://dev.twitch.tv/console/apps)) |
| `OPENAI_API_KEY` | non | Extraction de chiffres depuis texte (Wikipedia, presse) |
| `TAVILY_API_KEY` / `PERPLEXITY_API_KEY` | non | Découverte d’articles backlog |
| `GAMES_POPULARITY_API_KEY` | non | Backfill followers Steam + top-seller rank |
| `ADMIN_TOKEN` | non | Accès back-office `/admin` (vide = désactivé) |

Sans clés API, l’app fonctionne avec les données déjà présentes dans le dump ;
seuls l’ingestion live et certains crons sont ignorés.

## Stack

| Couche | Tech |
| ------ | ---- |
| Backend | NestJS (TypeScript) + TypeORM |
| Base | PostgreSQL 16 |
| Frontend | Next.js 16 (App Router) + Tailwind CSS |
| Infra locale | Docker Compose (Postgres + Redis) |
| Sources | IGDB, Steam, scraping PS/Xbox Store |

## Structure du projet

```
games-sales-tracker/
├── backend/              API NestJS + ingestion + estimation
│   ├── dumps/            Dumps SQL prod (gitignoré)
│   └── src/
│       ├── entities/     Entités TypeORM
│       ├── db/migrations/ Migrations TypeORM
│       ├── games/        Recherche + fiches jeux
│       ├── ingestion/    Clients IGDB / Steam / stores
│       ├── estimation/   Modèle Boxleiter calibré
│       ├── scheduler/    Crons (refresh signaux, backlog…)
│       └── scripts/      Scripts one-shot (backfill, diagnostic…)
├── frontend/             UI Next.js (recherche + fiche jeu + admin)
└── docker-compose.yml    Postgres (5433) + Redis (6380)
```

Documentation complémentaire : `ARCHITECTURE.md`, `ESTIMATION.md`.

## API (aperçu)

| Méthode | Endpoint | Description |
| ------- | -------- | ----------- |
| GET | `/api/games/search?q=` | Recherche dans le catalogue local |
| GET | `/api/games/:slug` | Détail jeu + dernière estimation + historique |
| GET | `/api/games/popular` | Jeux populaires (page d’accueil) |
| POST | `/api/ingestion/steam` | Ingérer un app Steam (`{ "appId": 1145360 }`) |
| POST | `/api/ingestion/igdb` | Importer depuis IGDB (`{ "query": "Hades" }`) |

Exemple — ingérer Hades sans clé IGDB :

```bash
curl -X POST http://localhost:3001/api/ingestion/steam \
  -H 'Content-Type: application/json' \
  -d '{"appId": 1145360}'
```

## Commandes utiles

```bash
# Backend (depuis backend/)
npm run start:dev          # dev avec hot-reload
npm run migration:show     # migrations appliquées / en attente
npm run test               # tests unitaires

# Frontend (depuis frontend/)
npm run dev                # dev Next.js
npm run build              # build production

# Infra (depuis la racine)
docker compose up -d       # démarrer Postgres + Redis
docker compose down -v     # arrêter + effacer les données Postgres
```

## Note sur la précision

Un jeu tout juste sorti a peu de signaux : l’estimation est volontairement
affichée avec **faible confiance et une fourchette large**.

Les **jeux free-to-play** (flag Steam `is_free`) n’ont pas d’estimation de
ventes : les avis ne sont pas un proxy fiable quand il n’y a pas d’unité vendue.

La crédibilité vient de l’honnêteté sur l’incertitude, pas d’un chiffre précis
que personne ne possède réellement.
