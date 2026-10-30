---
name: control-platform-costs
description: >-
  Keep game-sales-tracker cheap to run. The owner pays for it personally and it
  earns nothing yet. Use before building or changing any feature, cron, API
  route, page, query, table, migration, backfill or AI call, and when the user
  mentions cost, Vercel usage, Neon storage, compute, OpenAI, Perplexity or
  Tavily spend. Estimates the cost on Vercel, Neon and paid AI or search APIs
  before the work ships.
---

# Control platform costs

The owner pays for this platform personally and it earns no revenue yet. Cost
is a product requirement, on the same level as correctness. Prefer the version
of a feature that does the job cheaply over the most complete one.

## Before building

Estimate what the change adds at full catalog scale, per day and per month.
Multiply by the whole catalog and the real cron schedule, not by one game.

```
- [ ] Vercel: invocations x duration, and how much work bypasses the cache
- [ ] Neon: rows and MB added per month, compute time kept awake
- [ ] AI and search: calls x cost per call, and what caps them
- [ ] One-off work (backfill, retrain) kept apart from the recurring cost
```

Tell the owner the estimate, in plain numbers, when a change adds a recurring
cost or a one-off cost that is more than trivial. Ask before shipping it if a
cheaper version would lose something they might care about. Name that cheaper
version, even when you recommend the other one.

A small change with no new cron, query loop, table, or paid call needs no
estimate. Do not pad reports with one.

## Vercel

- Prefer cached or static pages. Each `force-dynamic` public page, and each
  request that reaches the backend, is paid compute. Add one only when the data
  must be live.
- Cron budgets are ceilings, not targets. A job should stop when its work is
  done. Do not raise a schedule or a budget without need.
- Do not fan out one function call per game when a batch call or SQL does it.
- Image optimization stays off (`frontend/next.config.*`). Do not turn it on
  for the whole catalog.
- Each push to `master` is a production build. Group small changes.

## Neon

- Snapshot tables are the bulk of the database. Before adding a table or a
  metric, work out its rows per game per day, then multiply by the catalog.
- Store a new row only if it adds information. Prefer one row per meaningful
  period over one per poll, and consider a retention or downsampling rule at
  the time the table is created.
- Add only indexes a real query needs. Each one costs storage and write time.
- Select the columns and rows you need. Avoid unbounded scans in a request path
  or in a loop, and N+1 queries.
- Frequent small queries keep compute awake. Do not add polling or very short
  crons without a reason.

## AI and search APIs

- Use AI only where rules or SQL cannot do the job.
- Use the cheapest model that passes on real examples. A stronger model needs a
  reason. Keep models configurable through env vars, as the existing clients do.
- Bound every paid loop: a per-run cap, a smaller input, and reuse of stored
  results (see `processed_article`, `provider_cooldown`).
- Filter candidates before the paid call, so only worthwhile items reach it.
- Try a new paid call on a few games before running it on the catalog, and
  report the real cost of that sample.

## Before reporting done

State what the change costs per month, or say it adds nothing. If the cost
could not be measured, say so and say what was assumed. Say how to turn a new
recurring cost off.
