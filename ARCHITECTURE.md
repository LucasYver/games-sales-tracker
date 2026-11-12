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
that model: the platform sum, or for established games the worldwide ML
estimate trained in `ml/` (see `ESTIMATION.md` §6). Games released before
2017 show no estimate. Dated publisher,
Wikipedia, and press figures are stored as milestones and shown as a
cross-check. They do not calibrate a per-game
multiplier.

## Layout

```
game-sales-tracker/
├── backend/             NestJS API (TypeScript, TypeORM, PostgreSQL 16)
├── frontend/            Next.js 16 (App Router, next-intl, Tailwind, shadcn/ui)
├── ml/                  Python lab: read-only snapshots, backtest, model bench, frozen models (ml/README.md)
├── data/                CSV inputs of the import scripts (Alinea, 2018 Steam leak)
├── docker-compose.yml   PostgreSQL 16 (port 5433)
└── vercel.json          Production routes and cron schedules
```

PostgreSQL is the only datastore. Local credentials and the migration workflow:
`.cursor/skills/database-connection/SKILL.md`.

## Backend

NestJS modules under `backend/src/`. Entry points worth knowing:

| Area | File |
| ---- | ---- |
| Public API | `games/games.controller.ts` |
| Ingestion API | `ingestion/ingestion.controller.ts` |
| Admin API | `admin/admin.controller.ts` (`X-Admin-Session`) |
| Public blog | `blog/blog.controller.ts` (published posts only) |
| Vercel crons | `scheduler/cron-jobs.ts` (job list) + `scheduler/cron.controller.ts` + `scheduler/refresh.service.ts`; manual runs from `/admin/crons` via `scheduler/admin-cron.controller.ts` |
| Estimation | `estimation/estimation.service.ts`; worldwide ML estimate in `estimation/ml/` |
| Matcher | `reference-profiles/` |
| Schema | `entities/` + `db/migrations/` (explicit registry in `db/migrations/index.ts`) |

`synchronize` is off. Schema changes ship as TypeORM migrations
(`.cursor/rules/typeorm-migrations.mdc`). Boot applies pending migrations
on `DATABASE_URL_DIRECT`, then `DATABASE_URL`.

### Entities

| Entity | Table | Role |
| ------ | ----- | ---- |
| `Game` | `game` | Catalog row: identity, platforms, genres, Steam tags, franchise / live-service flags, IGDB series and companies, free-to-play, catalog tier. |
| `GameSource` | `game_source` | External id (Steam app, IGDB, store, Twitch, Instant Gaming affiliate product). |
| `GamePlatformReleaseDate` | `game_platform_release_date` | Per-platform launch date used by estimation. |
| `GameIngestionState` | `game_ingestion_state` | Per-pipeline attempt / success, so budgeted crons resume stalest-first. |
| `GameRank` | `game_rank` | Home-grown review-velocity rank. |
| `Publisher` | `publisher` | One row per publishing company a game names, created on first sight (`game.publisherId`): public publisher pages, matcher publisher axis, blog rankings. |
| `Developer` | `developer` | One row per studio a game names, created on first sight (`game.developerId`): public studio pages. |
| `Genre` | `genre` | IGDB genre dictionary. Not an estimation profile. |
| `SignalSnapshot` | `signal_snapshot` | Dated public counts (reviews, CCU, ratings, followers, Twitch, leak, playtime). |
| `PriceSnapshot` | `price_snapshot` | Regional store price. Display only. |
| `AchievementSnapshot` | `achievement_snapshot` | Most common achievement per capture (Steam; Exophase when enabled). Collected, not estimated from. |
| `SalesEstimate` | `sales_estimate` | Append-only per-method range, plus the `aggregated` row. |
| `EstimateSnapshot` | `estimate_snapshot` | Append-only headline range (`estimatedToday`), its displayed figure and reconciliation JSON. |
| `EstimationMethod` | `estimation_method` | Method code, family, weight, enabled flag. |
| `Milestone` | `milestone` | Dated declared figure with provenance. Soft-deleted via `rejectedAt`. |
| `TrustedSource` | `trusted_source` | Outlet registry for article extraction. `feedUrl` is reference data; RSS is not polled. |
| `ProcessedArticle` | `processed_article` | URL dedup for extraction. |
| `ReferenceProfile` | `reference_profile` | Observed vector for one matcher anchor. |
| `AdminUser` | `admin_user` | Allowlisted back-office account (email + scrypt hash). No public signup. |
| `ProviderCooldown` | `provider_cooldown` | Cross-invocation skip window for an external provider (Perplexity out of credit). |
| `BlogPost` | `blog_post` | AI-assisted article (`kind`: sales article, news item, launch report, ranking). `DRAFT` until an admin publishes. One sales article per game; the other kinds are unique by `topicKey`. Live while `publishedAt` is set; an update in review keeps the public version in `liveSnapshot`. |
| `BlogPostTranslation` | `blog_post_translation` | Native FR/EN body, slug, SEO fields, editor issues. |

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
- Wikipedia and backlog search (Perplexity first; Tavily on credit
  cooldown / missing key / error). Credit exhaustion trips a 24h
  `provider_cooldown` so harvest does not re-probe a dead balance.
- Steam review languages (`Game.reviewLanguages`), counted by the monthly
  reviewer-playtime cron on the reviews it already reads. Display only.
- IGDB facts, read by the nightly IGDB refresh (`IgdbRefreshService`) and
  shown on the game pages only, never fed to the estimate: release type and
  parent game (`gameType`, `igdbParentGameId`), game modes, player-reported
  time to beat (`games/igdb-facts.ts`, admin only), and store links from
  `external_games` (PlayStation and Xbox ids for the store lookup, Epic and
  GOG pages, Game Pass cloud).
- Steam achievements. Exophase is off by default (`EXOPHASE_ENABLED`): it
  blocks automated requests.
- LLM extraction (`llm/llm-extractor.service.ts`): grounded structured call
  on fetched text. `OPENAI_MODEL` in `backend/.env.example` is `gpt-4o-mini`.
  If that variable is unset, the code falls back to `gpt-5.6-luna`. `gpt-6*`
  models go through the Responses API (strict JSON schema, reasoning `low` by
  default) and log input/output tokens per call; older models keep the chat
  function-tool call.

Trusted-source matching still gates article milestones. RSS polling was
removed; articles are discovered by web search only. `searchUrlTemplate`
on `trusted_source` is stored and editable but no code queries it.

Milestone harvest (`IngestionService.harvestGameMilestones`) runs Wikipedia
then backlog search. It does not rebuild estimates; the `estimate-rebuild`
cron does. Per-game cadence is age-based (`scheduler/refresh-interval.ts`),
keyed on `game.lastMilestoneHarvestedAt`.

### Scheduler

Production crons are HTTP routes in `vercel.json`, authorized with
`CRON_SECRET` (`scheduler/vercel-cron.guard.ts`). Each run has a wall-clock
budget and continues from the stalest games on the next invocation. Do not
copy the cron expressions into this file.

Rough groups: hourly CCU and Twitch, several-times-daily reviews / store
ratings / milestone harvest / prices / followers, nightly IGDB discovery,
weekly estimate rebuild and rank, slower playtime and achievement passes.
The nightly discovery run also re-reads IGDB for part of the catalog, oldest
check first. It moves the release dates of games not launched yet (a delay,
an early launch) or with no date; released games keep theirs. Public franchise pages group games by the IGDB series
(`seriesSlug`), falling back to the title-derived `franchiseSlug`. A game has
one developer and one publisher (`developer` / `publisher`), read by the
public pages, the studio and publisher pages, the matcher, the ML and the blog: an admin
correction, else IGDB's credit (written by ingestion and this nightly pass),
else the Steam store name kept in `steamDeveloper` / `steamPublisher`. Each
name is linked to its `publisher` / `developer` row (`publisherId` /
`developerId`, `games/company-registry.ts`), created the first time a game
names that company; studio pages group games by `developerId` and publisher
pages by `publisherId`. The matcher and
the ML keep the title-derived `franchiseSlug`.
Sunday `blog-draft` writes at most one draft — an update of a live article or
ranking whose sourced figures changed first, else a new one — or mails a digest
if one is already waiting. Daily `blog-news` writes at most one news item and
one launch report. Neither publishes.

### Admin

`/admin` is English-only. Login is email/password against the `admin_user`
allowlist; sessions are HMAC-signed with `ADMIN_SESSION_SECRET` and stored in
an HttpOnly cookie (`X-Admin-Session`). Fail-closed when the secret is unset.
Bootstrap the first user with `ADMIN_BOOTSTRAP_EMAIL` /
`ADMIN_BOOTSTRAP_PASSWORD` or `npm run admin:create-user`. Account creation
sends a Chart Room–styled welcome email via Resend when `RESEND_API_KEY` is
set. Pages: dashboard (catalog growth and sales-figure coverage from
`AdminDashboardService`), games, crons (progress + manual run), milestones, trusted
sources, publishers, genres, reference profiles, ranks, blog. Draft-ready and leftover-draft digest
mails reuse Resend, as does the daily alert sent while Steam reviews are not
being collected (`steamReviewsHealth`, also a banner on the crons page). The
controller is the endpoint list; the UI covers
refresh, CSV import, histogram / SteamCharts backfill, follower backfill,
estimate rebuild, and matcher inspection.

## Frontend

`frontend/src/app/`. Locales `en`, `fr`, `es` and `ru` via `next-intl`. Admin is
outside the locale prefix. The blog exists in `en` and `fr` only (`hasBlog` in
`i18n/routing.ts`): one paid AI write per language, so `/es/blog` and `/ru/blog`
are 404s, left out of the header and the sitemap.

| Route | Role |
| ----- | ---- |
| `/[locale]` | Search and filterable catalog |
| `/[locale]/game/[slug]` | Headline estimate, history, signals, regional prices |
| `/[locale]/blog` | Published official-sales articles (human-reviewed) |
| `/[locale]/blog/[slug]` | One article, FR/EN, no model estimates |
| `/[locale]/privacy` | Privacy page: audience measurement, ads, contact |
| `/[locale]/about` | About page: what the site is, sources, who runs it, funding (static, no backend call) |
| `/[locale]/contact` | Contact page: `mailto:` link to the address in `frontend/src/lib/contact.ts` (static, no backend call) |
| `/[locale]/methodology` | Public explanation of the estimates (all locales, no backend call), linked from the game headline and the footer |
| `/admin/*` | Back-office |

Share images (`opengraph-image.tsx`, shared code in `lib/og.tsx`): one default
card per locale built at deploy time, plus on-demand cards for game pages
(cover, name, headline figure) and blog articles (title, cover), cached a day
on the CDN. Pages that set their own `openGraph.type` list the default card
through `lib/og-meta.ts`, since they lose the inherited one.

The public game page shows `headline` (the model range). `totalSales` is
the reported milestone when one exists. Source URLs and verbatim quotes are
not shown on the public page.

Default API base: `NEXT_PUBLIC_API_URL` or `http://localhost:3001/api`
(`frontend/src/lib/api.ts`). The sitemap is split (`app/sitemap/[file]/route.ts`, served at `/sitemap/{id}.xml`: 0 = home, blog and posts, then 1,000 games per file) behind an index at `/sitemap.xml` (`app/sitemap.xml/route.ts`); it reads `GET /games/sitemap` and `GET /blog/sitemap`. New game pages (nightly, after the `game-discovery` cron) and newly published posts go to IndexNow for Bing and other participating engines, not Google (`backend/src/common/indexnow.ts`, key file in `frontend/public/`). Game pages link to Instant Gaming with our affiliate code when the nightly discovery cron matched a product (skill `manage-catalog-discovery`); clicks are the Vercel Analytics custom event `instant_gaming_click`. Fonts are DM Sans and IBM Plex Mono, with IBM Plex Sans on `/ru` because DM Sans has no Cyrillic.

Ads are off unless `NEXT_PUBLIC_ADSENSE_CLIENT` is set (`frontend/src/lib/ads.ts`): it loads the AdSense script on public pages and serves `/ads.txt`. `NEXT_PUBLIC_ADSENSE_GAME_SLOT` adds the unit at the bottom of game pages. `NEXT_PUBLIC_CONTACT_EMAIL` overrides the contact address shown on the about, contact and privacy pages (default in `frontend/src/lib/contact.ts`). All three are read at build time, so changing one needs a redeploy.

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
