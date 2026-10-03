# Game Sales Tracker — architecture

> Verified against commit `5f0cae0` (2026-10-03).
>
> Map of the system. Estimation formulas live in `ESTIMATION.md`.
> The matcher lives in `DATA_DRIVEN_PROFILES.md`. Schedules live in
> `vercel.json`, not in this file. When a list here and the code disagree,
> the code wins — then fix this file.

## Purpose

Estimate video-game unit sales from public signals, per platform, as a
range. The number the site shows (`headline` / `estimatedToday`) is always
that model. Dated publisher, Wikipedia, and press figures are stored as
milestones and shown as a cross-check. They do not calibrate a per-game
multiplier.

## Layout

```
game-sales-tracker/
├── backend/             NestJS API (TypeScript, TypeORM, PostgreSQL 16)
├── frontend/            Next.js 16 (App Router, next-intl, Tailwind, shadcn/ui)
├── docker-compose.yml   PostgreSQL 16 + Redis (ports 5433 / 6380)
└── vercel.json          Production routes and cron schedules
```

Redis is started locally and is not used by the backend. PostgreSQL is
the only datastore. Local credentials and the migration workflow:
`.cursor/skills/database-connection/SKILL.md`.

## Backend

NestJS modules under `backend/src/`. Entry points worth knowing:

| Area | File |
| ---- | ---- |
| Public API | `games/games.controller.ts` |
| Ingestion API | `ingestion/ingestion.controller.ts` |
| Admin API | `admin/admin.controller.ts` (`X-Admin-Token`) |
| Vercel crons | `scheduler/cron.controller.ts` + `scheduler/refresh.service.ts` |
| Estimation | `estimation/estimation.service.ts` |
| Matcher | `reference-profiles/` |
| Schema | `entities/` + `db/migrations/` (explicit registry in `db/migrations/index.ts`) |

`synchronize` is off. Schema changes ship as TypeORM migrations
(`.cursor/rules/typeorm-migrations.mdc`). Boot applies pending migrations
on `DATABASE_URL_DIRECT`, then `DATABASE_URL`.

### Entities

| Entity | Table | Role |
| ------ | ----- | ---- |
| `Game` | `game` | Catalog row: identity, platforms, genres, Steam tags, franchise / live-service flags, free-to-play, catalog tier. |
| `GameSource` | `game_source` | External id (Steam app, IGDB, store, Twitch). |
| `GamePlatformReleaseDate` | `game_platform_release_date` | Per-platform launch date used by estimation. |
| `GameIngestionState` | `game_ingestion_state` | Per-pipeline attempt / success, so budgeted crons resume stalest-first. |
| `GameRank` | `game_rank` | Home-grown review-velocity rank. |
| `Publisher` | `publisher` | Publisher identity used by the matcher. |
| `Genre` | `genre` | IGDB genre dictionary. Not an estimation profile. |
| `SignalSnapshot` | `signal_snapshot` | Dated public counts (reviews, CCU, ratings, followers, Twitch, leak, playtime). |
| `PriceSnapshot` | `price_snapshot` | Regional store price. Display only. |
| `AchievementSnapshot` | `achievement_snapshot` | Exophase / Steam unlock sample. Collected, not estimated from. |
| `SalesEstimate` | `sales_estimate` | Append-only per-method range, plus the `aggregated` row. |
| `EstimateSnapshot` | `estimate_snapshot` | Append-only headline range (`estimatedToday`) and reconciliation JSON. |
| `EstimationMethod` | `estimation_method` | Method code, family, weight, enabled flag. |
| `Milestone` | `milestone` | Dated declared figure with provenance. Soft-deleted via `rejectedAt`. |
| `TrustedSource` | `trusted_source` | Outlet registry for article extraction. `feedUrl` is reference data; RSS is not polled. |
| `ProcessedArticle` | `processed_article` | URL dedup for extraction. |
| `ReferenceProfile` | `reference_profile` | Observed vector for one matcher anchor. |

`SalesRecord` was renamed to `Milestone`. `GenreProfile` and the per-game
calibration columns are gone.

### Signals that feed the model

| Metric | Used for |
| ------ | -------- |
| `STEAM_REVIEWS` | PC Boxleiter. Synthetic rows are ignored. |
| `STEAM_CONCURRENT` | Launch-window peak for the PC first-week method. |
| `PS_RATINGS` / `XBOX_RATINGS` | Console Boxleiter. Xbox is the worldwide Display Catalog count. |
| `STEAM_PLAYERS_LEAK` | July 2018 ground truth for anchors and holdout. Not a live estimate input. |

Followers, Twitch viewers, prices, reviewer playtime, and peak-CCU history
are collected for charts, rank, or matching features. They are not multiplied
into units by themselves. The full enum is `entities/enums.ts` (`SignalMetric`).

### Ingestion

Discovery is IGDB-led (`ingestion/discovery.constants.ts`): catalog vs core
rating thresholds, a Steam review floor for recent releases, PC / PlayStation
/ Xbox only. Switch and mobile are not estimated.

Other clients in `ingestion/`:

- Steam store, reviews, CCU, prices, tags.
- PlayStation and Xbox ratings and prices.
- Twitch viewers.
- games-popularity.com followers (`GAMES_POPULARITY_API_KEY`).
- Wikipedia and backlog search (Perplexity by default, Tavily optional).
- Exophase achievements.
- LLM extraction (`llm/llm-extractor.service.ts`): grounded tool call on
  fetched text. `OPENAI_MODEL` in `backend/.env.example` is `gpt-4o-mini`.
  If that variable is unset, the code falls back to `gpt-5.6-luna`.

Trusted-source matching still gates article milestones. RSS polling was
removed; discovery of articles is search plus on-site templates.

### Scheduler

Production crons are HTTP routes in `vercel.json`, authorized with
`CRON_SECRET` (`scheduler/vercel-cron.guard.ts`). Each run has a wall-clock
budget and continues from the stalest games on the next invocation. Do not
copy the cron expressions into this file.

Rough groups: hourly CCU and Twitch, several-times-daily reviews / store
ratings / milestone harvest / prices / followers, nightly IGDB discovery,
weekly estimate rebuild and rank, slower playtime and achievement passes.

### Admin

`/admin` is English-only, behind `ADMIN_TOKEN` (fail-closed when unset).
Pages: dashboard, games, milestones, trusted sources, publishers, genres,
reference profiles, ranks. The controller is the endpoint list; the UI
covers refresh, CSV import, histogram / SteamCharts backfill, follower
backfill, estimate rebuild, and matcher inspection.

## Frontend

`frontend/src/app/`. Locales `fr` and `en` via `next-intl`. Admin is outside
the locale prefix.

| Route | Role |
| ----- | ---- |
| `/[locale]` | Search and filterable catalog |
| `/[locale]/ranking` | Review-velocity ranking |
| `/[locale]/game/[slug]` | Headline estimate, history, signals, regional prices |
| `/admin/*` | Back-office |

The public game page shows `headline` (the model range). `totalSales` is
the reported milestone when one exists. Source URLs and verbatim quotes are
not shown on the public page.

Default API base: `NEXT_PUBLIC_API_URL` or `http://localhost:3001/api`
(`frontend/src/lib/api.ts`). Fonts are Inter and JetBrains Mono.

## Environment

Copy `backend/.env.example`. Required for local API after a dump restore:
`DATABASE_URL`, plus `PORT` / `CORS_ORIGINS` if you leave the defaults.
`DATABASE_URL_DIRECT` is for migrations when `DATABASE_URL` is a
transaction-mode pooler. Every other key degrades to "skip that client".

## Design choices still in force

- The model never invents a sales figure from model memory. The LLM only
  extracts a number that appears in fetched text.
- A press milestone is accepted when its URL matches `TrustedSource`.
- VGChartz is not a source.
- Subscription "players reached" figures are stored as `isEngagement` and
  excluded from the headline and from anchors.
- Free-to-play titles are not estimated.
- Similarity replaces hand-written genre buckets. See `ESTIMATION.md`.
