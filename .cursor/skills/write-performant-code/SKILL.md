---
name: write-performant-code
description: >-
  Make every game-sales-tracker change fast by default without changing what
  it returns. Use when writing or changing a backend service method, a
  TypeORM query, raw SQL, a public API route, a Next.js page or its fetches,
  or a loading state, and when the user mentions performance, slowness,
  "c'est lent", latency, round trips or a page that takes a second. Covers
  parallel queries, the request path, indexes, Next.js fetch caching and
  how to prove an optimization changed nothing.
---

# Write performant code

Performance is part of the request, not a later pass. The owner expects
every change to be fast by default, to keep the exact behavior and output,
and to respect what the product asked for. A faster version that changes a
figure, an order or a visible state is a regression.

Cost rules live in `control-platform-costs`; read it too when a change adds
an index, a table, a cron or a query in a loop.

## Where the time goes

Measured on 2026-11-04:

- The backend runs on Vercel in `cdg1` (Paris) and Neon is in
  `eu-central-1` (Frankfurt), about 10 ms per round trip in production. Each
  sequential `await` on the database pays that once. From a laptop it is
  30 ms or more, so sequential queries look much worse locally.
- `signal_snapshot` holds about 3.9M rows and 1.5 GB. Any query that scans it
  in a request path costs about 0.7 s and real Neon compute. Its only index
  is `("gameId", metric, "capturedAt")`.
- Public pages cache backend calls through `fetch(..., { next: { revalidate } })`
  in `frontend/src/lib/api.ts`: 15 min for games and listings, 1 h for
  genres. A cache miss pays the full backend time.
- `next dev` compiles on demand and caches nothing. Never judge speed from
  dev mode alone; time the API with `curl -w "%{time_total}"`.

## Rules

### Backend queries

- **One wave per dependency level.** Once you have the id a query needs,
  start every independent query together in one `Promise.all`. Keep a
  dependent chain (A then B) as one async function inside that
  `Promise.all`, so it runs beside the others. `GamesService.getBySlug` is the
  reference: one lookup by slug, then a single parallel wave.
- The TypeORM pool (pg default, 10 connections) makes this real
  parallelism. Do not fan out more than about 15 queries per request.
- Never put a query inside a loop over games. Batch with `In(ids)` or one SQL
  statement.
- Select only the columns the response uses.
- Do not scan `signal_snapshot` or another snapshot table in a request path.
  Read per game through the `("gameId", metric, "capturedAt")` index, or
  propose a narrow index with its size (see below).

### Indexes

- Before adding one, run `EXPLAIN (ANALYZE, BUFFERS)` on the real query and
  read the plan. Look for `Seq Scan` on a large table and for
  `Buffers: read=`.
- Prefer a partial index on the rows the query reads (for example
  `WHERE metric = 'STEAM_REVIEWS'`) over a full one, and state its size.
- Migrations run in one transaction at boot (`migration-runner.ts`), so
  `CREATE INDEX CONCURRENTLY` cannot go in a migration. A plain
  `CREATE INDEX` locks writes on that table while it builds. Tell the owner
  before shipping an index on a snapshot table.

### Frontend

- Fetch in parallel with `Promise.all` in a page, never one `await` after
  another when the calls are independent.
- `generateMetadata` and the page must call the same fetch with the same
  arguments. A different URL means a second backend call per render.
- Keep the `revalidate` TTLs. Adding `cache: 'no-store'` or
  `force-dynamic` to a public page sends every view to the backend; do it
  only when the data must be live.
- Show a loading state for any navigation that waits on the server. The game
  page cannot have a `loading.tsx` (it turns unknown slugs into soft 404s);
  use `GamePageSkeleton` behind a `useTransition`, as `SearchBar` does.

## Prove it changed nothing

For a refactor that should only be faster:

1. Before editing, save the API responses for a varied set of inputs: a big
   game, a small one, a free game, an upcoming one, an unknown slug, and each
   query parameter variant (`store`, `country`, filters, pages).
2. After the change, restart the backend and compare byte for byte
   (`cmp`). Any difference must be explained or fixed.
3. Time before and after with several `curl` runs and report the medians.

Run read-only checks against Neon with `default_transaction_read_only=on`,
as the `backend-readonly` launch config does. Never write to the database to
test a speedup.

## Reporting

Report the before and after timings, what stayed identical and how it was
checked, and anything left slow with its cause and cost to fix.
