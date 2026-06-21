# Game Sales Tracker

A prototype platform that **estimates video game sales** by aggregating public
signals, because publishers rarely disclose unit sales directly.

The core idea: there is no single API that returns "game X sold N copies".
So instead of pretending to know an exact number, we:

1. Collect dated **signal snapshots** (Steam reviews, SteamSpy owners).
2. Apply a calibrated **Boxleiter multiplier** (copies sold per Steam review).
3. Output an **estimate range + confidence level**, never a fake exact figure.
4. Keep rare **official figures** separately as ground truth for calibration.

## Stack

| Layer     | Tech                                      |
| --------- | ----------------------------------------- |
| Backend   | NestJS (TypeScript) + TypeORM             |
| Database  | PostgreSQL                                |
| Frontend  | Next.js (App Router) + Tailwind CSS       |
| Infra     | Docker Compose (Postgres + Redis)         |
| Sources   | IGDB (catalog), Steam Store API, SteamSpy |

> TypeORM runs with `synchronize: true` for prototype convenience (the schema is
> derived from the entities at startup). The `pg_trgm` extension and the trigram
> search index are ensured on boot by `DatabaseInitService`. Switch to TypeORM
> migrations before production.

## Project structure

```
game-sales-tracker/
├── backend/            NestJS API + TypeORM + ingestion + estimation
│   └── src/
│       ├── entities/     TypeORM entities + enums
│       ├── database/     TypeOrmModule config + trigram init
│       ├── games/        search + game detail endpoints
│       ├── ingestion/    IGDB / Steam / SteamSpy clients + service
│       ├── estimation/   Boxleiter estimation (calibrated)
│       ├── scheduler/    daily signal refresh (cron)
│       └── scripts/      bootstrap-games (curated catalog)
├── frontend/           Next.js UI (search + game page)
└── docker-compose.yml  Postgres + Redis
```

## Getting started

### 1. Start the database

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # already created with local defaults
npm install
npm run start:dev           # http://localhost:3001/api (auto-creates schema)
# In another shell, populate the catalog with ~85 real Steam games:
npm run bootstrap:games
```

To use real IGDB ingestion, fill `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`
in `.env` (create a Twitch app at https://dev.twitch.tv/console/apps).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

## API

| Method | Endpoint               | Description                              |
| ------ | ---------------------- | ---------------------------------------- |
| GET    | `/api/games/search?q=` | Search games in the local catalog        |
| GET    | `/api/games/:slug`     | Game detail + latest estimate + history  |
| POST   | `/api/ingestion/steam` | Ingest a Steam app (`{ "appId": 1145360 }`) |
| POST   | `/api/ingestion/igdb`  | Import from IGDB (`{ "query": "Hades" }`)   |

### Ingest a real game (no IGDB key needed)

```bash
# Hades (Steam app id 1145360)
curl -X POST http://localhost:3001/api/ingestion/steam \
  -H 'Content-Type: application/json' \
  -d '{"appId": 1145360}'
```

Then open the frontend and search for it.

## Search

Search runs against the local catalog using PostgreSQL trigram matching
(`pg_trgm` + `word_similarity`), so it is typo-tolerant and ranked by relevance:

- `witchr` → The Witcher 3: Wild Hunt
- `eldn ring` → ELDEN RING
- `cyberponk` → Cyberpunk 2077

To grow the catalog, ingest more Steam app ids (single endpoint or the
`bootstrap:games` script) or wire up IGDB import.

## Roadmap

- Console coverage: collect official figures into `OfficialSales` (manual at
  first, then financial-report parsing) — these calibrate the estimator.
- Background jobs with BullMQ + Redis instead of in-process cron.
- Multi-source estimate blending (reviews + owners + concurrent players).
- Auth + multi-tenant for the SaaS layer.

## A note on accuracy

A freshly released game has very little signal, so its estimate is shown with
**low confidence and a wide range** on purpose. The credibility of the platform
comes from being honest about uncertainty, not from displaying a precise number
nobody actually has.

**Free-to-play games** (detected via Steam's `is_free` flag) never get a sales
estimate: reviews are not a proxy for units sold when there is no unit to sell.
