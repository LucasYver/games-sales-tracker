# Game Sales Tracker — Architecture & What We Built

## Purpose

A public SaaS prototype that aggregates video game sales figures from multiple
sources (official publisher reports, Wikipedia, specialist press, Steam signals,
store ratings) and exposes the most reliable estimate for each title, per
platform, with a confidence score.

---

## Monorepo Structure

```
game-sales-tracker/
├── backend/          NestJS API (TypeScript, TypeORM, PostgreSQL)
├── frontend/         Next.js 16 (App Router, TypeScript, Tailwind, Shadcn/ui)
└── docker-compose.yml  PostgreSQL 15 + Redis (ports 5433 / 6380 to avoid conflicts)
```

---

## Backend

### Database entities

| Entity | Purpose |
|---|---|
| `Game` | Core catalog entry. Holds name, slug, cover, platforms, release date, developer, publisher, genres, `igdbId`, 3 per-platform calibrated Boxleiter multipliers. |
| `GameSource` | Maps a game to an external ID on a given source system (Steam appId, IGDB id…). |
| `SignalSnapshot` | Time-series of raw public signals: Steam reviews, PS Store rating count, Xbox Store rating count. |
| `SalesEstimate` | Computed Boxleiter estimate (low / high / confidence / method) per platform, stored on each computation cycle. |
| `Milestone` | A dated declared or extracted sales-related figure with full provenance: platform, source tier, units, `reportedAt`, source URL, verbatim quote, numeric `confidenceScore` (0–100, informational). Flag `isEngagement` marks players-reached figures (excluded from calibration). Replaces the legacy `SalesRecord` entity; the database table was renamed from `sales_record` to `milestone`. |
| `TrustedSource` | Curated whitelist of media outlets / analysts / X accounts that feed the LLM extraction pipeline. |
| `ProcessedArticle` | Deduplication table of already-processed article URLs. |

### Source tiers (most → least reliable)

```
OFFICIAL   Publisher IR / financial report
WIKIPEDIA  Citation-backed figure extracted from Wikipedia
ANNOUNCEMENT  Social / PR press release
MEDIA      Trusted media outlet / analyst report
ESTIMATE   Boxleiter / ratings-based model output
```

### Signal metrics

| Metric | Source |
|---|---|
| `STEAM_REVIEWS` | Steam storefront review API |
| `STEAM_CONCURRENT` | Steam `GetNumberOfCurrentPlayers` — raw daily reading |
| `STEAM_PEAK_CCU` | Running all-time max of `STEAM_CONCURRENT`, written only on a new high. Used as a second independent PC estimate, intersected with the reviews-based Boxleiter range. |
| `PS_RATINGS` | PlayStation Store scraping |
| `XBOX_RATINGS` | Xbox Store scraping |

The only two data providers are **Steam** and **IGDB**. SteamSpy has been
removed (its owner estimate duplicated our own Boxleiter model). We track
**PC, PlayStation and Xbox only** — Switch and mobile are excluded for lack of
a reliable sales signal.

### Estimation pipeline (Boxleiter)

Each supported platform has its own signal → units model:

| Platform | Signal | Default range | Plausible bounds |
|---|---|---|---|
| PC | Steam reviews | 25–70× | 5–500× |
| PlayStation | PS Store rating count | 40–100× | 8–600× |
| Xbox | Xbox Store rating count | 35–90× | 6–600× |

**Calibration**: when at least one **dated milestone** exists for a
platform (any source — OFFICIAL, ANNOUNCEMENT, MEDIA, WIKIPEDIA), we
pick the latest `reportedAt` and pair it with the closest signal
snapshot within 365 days to derive the per-game multiplier. The result
is persisted on `Game` (`calibratedMultiplier`, `calibratedPsMultiplier`,
`calibratedXboxMultiplier`). All calibrated estimates use the single
uniform ±30 % spread (`CALIBRATED_MULTIPLIER_SPREAD = 0.3`); the
milestone's `confidenceScore` is surfaced to operators but does not
affect calibration. See `ESTIMATION.md` §1 for the full algorithm.

**PC second opinion (peak CCU intersection)**: on PC, the reviews-based
Boxleiter range is intersected with a parallel range derived from the all-
time peak concurrent player count (`STEAM_PEAK_CCU` signal × `PC_CCU_*`
multiplier). When both ranges overlap, the intersection is a strictly
tighter joint estimate (method tagged `…+ccu-intersect`). When they
disagree (typical for Game Pass / live-service titles whose review:player
ratio diverges from the catalog norm), the reviews-based range is kept
but confidence is downgraded to `LOW` and the method tagged
`…+ccu-conflict` to surface the disagreement.

**PC guardrail (Option A)**: when console declared figures show that PC is < 20%
of the total, the Boxleiter PC estimate is excluded from `estimatedToday` to
avoid grossly understating console-heavy titles.

**Reconciliation**: for each platform with both a declared figure and an
estimate, we classify agreement as `strong / weak / conflict` and adjust the
headline confidence accordingly. A `GLOBAL` declared figure (e.g. "30M copies
worldwide") acts as a floor and a freshness-aware cap on the summed estimate.

**Freshness cap**: `estimatedToday` is bounded by a piecewise-linear sales decay
curve (industry benchmark: 13% in week 1, 33% Q1, 58% Y1, 75% Y2, 100% Y5).
All constants live in `backend/src/games/sales-modeling.constants.ts`.

### Data ingestion

#### Catalog discovery (IGDB-driven, hybrid IGDB + Steam)
IGDB is the discovery backbone because it's the only source that can rank games
by cross-platform popularity and filter by release date / platform (the Steam
Web API offers no review-based ranking). `IgdbClient.discoverCandidates()` runs
three queries, deduplicated by IGDB id:
- **A — established hits**: `total_rating_count >= 80`, released since 2012,
  on PC/PS/Xbox, ranked by popularity.
- **B — landmark classics**: pre-2012 titles with `total_rating_count >= 500`
  (Skyrim, GTA IV, Mass Effect 2…).
- **C — fresh releases**: last 180 days, no rating bar.

Admission rule (`admitCandidate`): a candidate is tracked when
`total_rating_count >= 80` **OR** its live Steam review count `>= 2500` (the
Steam lookup is done only for sub-threshold candidates, so brand-new hits like
Battlefield 6 are caught before IGDB accumulates ratings). All thresholds live
in `backend/src/ingestion/discovery.constants.ts`.

Admitted games with a Steam app go through the full Steam ingest path;
console-only games are created from IGDB data and seeded with PS/Xbox store
ratings. Free-to-play titles are blocked.

#### Steam (per-app signals & metadata)
- Per-app Steam storefront API: metadata + total review count (the PC Boxleiter
  signal). No API key required for these endpoints.
- **Deduplication**: `GameSource(STEAM, appId)` as pivot.

#### IGDB enrichment
- Per-game lookup via Steam app ID (2-step: `/external_games` → `/games`)
  with fallback to name search.
- Enriches: `igdbId`, `platforms` (real list), `coverUrl`, `summary`,
  `releaseDate`, `developer`, `publisher`, `genres`.
- **Backfill**: admin endpoint `POST /admin/backfill/igdb` runs the full
  catalog at ~4 req/s (Twitch rate limit) with progress polled from the UI.

#### Wikipedia
- Wikipedia API (search → page text).
- OpenAI (GPT-4o-mini) extracts sales figures grounded on verbatim quotes.
- Global total takes priority over per-platform sum.
- Rate-limit (429) handled with exponential backoff; no figure extracted
  without a confirmed date.

#### Trusted media sources (RSS + on-site search)
- Curated registry in `sources.seed.ts` (seeded idempotently at boot).
- Continuous RSS polling every 30 min → LLM extraction → `Milestone(MEDIA)`.
- On-site search templates used by the manual discovery flow.

#### Tavily (backlog discovery)
- Fires only for historical content (pre-RSS era) when manually triggered
  (`refreshGame`).
- `TAVILY_EXCLUDED_DOMAINS` blocks aggregators, forums, UGC sites.
- Same grounded LLM extraction as RSS; undated figures are rejected.

#### LLM extraction rules (both Wikipedia and articles)
- `temperature: 0`, JSON schema output.
- Rejects: monetary figures (`$3.9M`), periodic/fiscal-year figures (`FY2024`),
  player/download/subscriber counts, subscription-service engagement.
- `isPeriodicQuote()` regex filter in `sales-figure.utils.ts` acts as a safety
  net after LLM extraction.

### Scheduler (crons)

| Cron | Job |
|---|---|
| 02:00 daily | `discoverIgdbGames()` — add new titles (IGDB + Steam admission) |
| 03:00 daily | Refresh all known Steam apps (signals + estimates) |
| Every 30 min | `pollFeeds()` — ingest new articles from RSS |

### Admin API (`/admin`, protected by `X-Admin-Token` header)

| Endpoint | Description |
|---|---|
| `GET /admin/stats` | Dashboard totals |
| `GET /admin/games` | Filterable paginated list |
| `GET /admin/games/:id` | Full detail (sources, milestones, estimates, signals) |
| `DELETE /admin/games/:id` | Cascade delete |
| `GET /admin/milestones` | Filterable (source, platform, undated, suspect) |
| `DELETE /admin/milestones/:id` | Single delete |
| `GET /admin/trusted-sources` | Registry list |
| `DELETE /admin/trusted-sources/:id` | Remove source |
| `GET /admin/issues` | 6 issue buckets (undated, suspect quotes, calibration outliers, stale, no signal, inactive sources) |
| `POST /admin/games/:id/import-ccu-history` | Scrape SteamCharts for the all-time peak CCU and seed a `STEAM_PEAK_CCU` snapshot at the peak's historical month (closes the gap for hits that spiked before we started polling) |
| `POST /admin/backfill/igdb` | Start full-catalog IGDB backfill |
| `GET /admin/backfill/igdb` | Backfill progress |

Token configured via `ADMIN_TOKEN` env var; fail-closed if unset.

---

## Frontend

### Public site (`/[locale]/`)

| Route | Content |
|---|---|
| `/` | Hero + search bar + filterable / sortable paginated game list |
| `/game/[slug]` | Headline estimate with confidence badge, sales history timeline, methodology card, refresh button |

**Internationalization**: `next-intl` with `fr` and `en` locales.

**SEO**: dynamic `generateMetadata`, Open Graph, JSON-LD `VideoGame` schema,
`sitemap.ts`, `robots.ts`.

**Theme**: Inter (body) + JetBrains Mono (code), custom primary color
`oklch(0.52 0.21 275)` (indigo/violet) via Shadcn CSS variables.

**Source masking**: no source URL, badge, or verbatim quote is shown to end
users. A `MethodologyCard` provides a generic explanation of the multi-source
approach.

### Back-office (`/admin`, English-only, excluded from i18n routing)

| Page | Content |
|---|---|
| `/admin/login` | Token input → HttpOnly session cookie (7 days) |
| `/admin` | Stats dashboard + IGDB backfill card with progress bar |
| `/admin/games` | Searchable / filterable table, all 3 calibrated multipliers, delete |
| `/admin/games/[id]` | Full detail: metadata, milestones, estimates, signals, external sources |
| `/admin/milestones` | Filter by source / platform / undated / suspect quote, delete |
| `/admin/trusted-sources` | Registry with RSS / search capabilities, delete |
| `/admin/issues` | 6 actionable groups: undated milestones, suspect quotes, calibration outliers, stale (30 days without Steam signal), zero-signal games, inactive trusted sources |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch / IGDB API credentials |
| `STEAM_API_KEY` | Optional — some Steam endpoints work unauthenticated |
| `OPENAI_API_KEY` | GPT-4o-mini for LLM extraction |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `TAVILY_API_KEY` | Backlog article discovery |
| `ADMIN_TOKEN` | Back-office shared secret |
| `CORS_ORIGINS` | Comma-separated allowed origins |

---

## Key design decisions

- **LLM as reader, not inventor**: OpenAI is used only to extract figures
  already present verbatim in a fetched page. `temperature: 0`, strict JSON
  schema, grounding check enforced at prompt level and backed by regex filters.
- **Whitelist trust model**: a `Milestone` from media/press is only accepted
  when the source URL matches a host registered in `TrustedSource`. This
  prevents arbitrary web content from polluting the dataset.
- **No VGChartz**: removed for unreliability. Domain is blocked from Tavily
  results.
- **No subscription sales**: PSN/Game Pass/Ubisoft+ engagement figures are
  explicitly rejected by LLM prompt and `isPeriodicQuote` regex.
- **No free-to-play**: Steam F2P titles are skipped at ingestion and blocked
  from future discovery. Reviews ≠ sales for F2P.
- **Calibration is conservative**: a per-game multiplier is only stored when
  the signal snapshot is within `CALIBRATION_WINDOW_DAYS = 365` days of the
  milestone's `reportedAt` and the resulting multiplier is within plausible
  bounds (5–500× for PC, etc.). Latest-dated milestone wins, regardless of
  source — the milestone's `confidenceScore` is purely informational.
- **Honest confidence**: the confidence badge is downgraded when Boxleiter PC
  conflicts with console declared figures, or when the PC estimate represents
  < 20% of the total.
