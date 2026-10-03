---
name: manage-vercel-cron
description: >-
  Add or change a scheduled job in game-sales-tracker. Use when the user
  mentions a cron, Vercel schedule, polling cadence, CRON_SECRET, or a
  recurring ingestion/rebuild job. Wires vercel.json, CronController,
  RefreshService, ingestion state, and the admin pipeline dashboard.
---

# Manage a Vercel cron

Production jobs are HTTP GET routes. Vercel calls them. There is no
`@nestjs/schedule` cron. Do not add one.

Path shape: `/api/cron/<name>`. Nest `setGlobalPrefix('api')` plus
`@Controller('cron')`. The `/api` rewrite in `vercel.json` does not strip
that prefix.

## Checklist

```
- [ ] vercel.json `crons[]`: path + schedule
- [ ] CronController GET, `@HttpCode(200)`, delegates to RefreshService
- [ ] RefreshService method: catch per item, log counts, respect the budget
- [ ] Per-game work: INGESTION_PIPELINES + IngestionStateService.track
- [ ] Due selection is stalest-first for the cadence
- [ ] Admin INGESTION_CRONS schedule matches vercel.json, when the dashboard shows this job
- [ ] Missing credential skips the run; it does not fail every game
```

`CronController` already has `VercelCronGuard`. Do not add another guard.
`CRON_SECRET` unset or a wrong `Authorization: Bearer` returns 401. Fail-closed.

## Budget and resume

`backend/api/index.ts` sets `maxDuration: 800`. Each job must stop earlier.

`RefreshService.RUN_BUDGET_MS` is 11 minutes. Pass that budget into the
ingestion method. On exit, log `processed`, `failed`, and `leftover`.

A killed invocation must make progress next time:

- Stamp state with `ingestionState.track(gameId, pipeline, fn)`.
- Select work with `selectDueForCadence` (or `selectDue`). Never-attempted
  games sort first.
- `track` writes `lastAttemptAt` **before** the call. A failure still
  consumes the current cadence slot (`ingestion/ingestion-cadence.ts`).
  Do not retry inside the same run.

`pipeline` on `game_ingestion_state` is a `varchar`, not a Postgres enum.
Adding a value to `INGESTION_PIPELINES` in
`entities/game-ingestion-state.entity.ts` does not need a migration.

## What to skip

- Free-to-play (`isFree`) for sales-related jobs.
- Steam jobs: games with no `game_source` STEAM row.
- Store ratings / console prices: games with no PS or Xbox platform.
- Milestone harvest is not "every paid game". See
  `isEligibleForAutomaticHarvest` (`CORE`, or `EXTENDED` with
  `recentVelocityPercentile <= 0.1`) plus `isDueForRefresh`.

Whole-catalog jobs that do not loop games (`game-rank`, and discovery's
own IGDB pass) are not rows in `INGESTION_CRONS`. Do not add them there
unless the dashboard query in `AdminService.stats` can count their cycle
the same way as the others.

## Dashboard copy

When the job is per-game and should appear on `/admin`, add one object to
`INGESTION_CRONS` in `admin.service.ts`. `cronPath` and `schedule` must
equal the `vercel.json` entry. `cycle` must match
`ingestion-cadence.ts` (`hour` | `day` | `week` | `month`). Copying a
schedule into `ARCHITECTURE.md` is wrong; that file points at
`vercel.json`.

## Local trigger

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3001/api/cron/<name>
```

Confirm leftover games are picked up on a second call, and that a missing
API key logs a skip instead of filling `lastError`.
