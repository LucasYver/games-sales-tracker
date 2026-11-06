---
name: let-crons-catch-up
description: >-
  Never run, propose or recommend a backfill or a bulk rebuild in
  game-sales-tracker: the crons catch up on their own. Use when estimates,
  snapshots, ML rows or signals are behind after a deploy, when a change only
  reaches a game at its next rebuild, when reading rebuildStaleEstimates or a
  script such as backfill-ml-estimates, or when about to suggest a backfill, a
  bulk rebuild or a mass recompute as a next step.
---

# Let the crons catch up

The owner decided this on 2026-11-01, tired of hearing the same suggestion in every
conversation. Data that is behind is not a problem to solve when a cron will reach
it. Do not run a backfill, and do not propose one.

## The rule

- Do not run a backfill script or a bulk rebuild, even as a small trial with
  `--limit` or `--dry-run`.
- Do not suggest one: not in a recommendation, an option, a next step, a question
  or a button.
- Do not present waiting for the cron as a cost or as the slower option.

The only exception is the owner asking for it, in their own message. That request
covers that run only, not later ones.

## What to do instead

When a change is reaching games gradually, say so once, in plain words:

- that the cron is carrying it out, and that nothing is broken;
- which games have it now and which are still waiting, from real counts;
- when it should finish, from the observed pace, stated as an estimate.

Then move on. Check for a real fault only: rebuilt games that still lack the change,
or a pipeline whose `lastError` or `failureCount` shows failures. Use the skill
`debug-ingestion-pipeline` for that.

## How estimates catch up

- `/api/cron/estimate-rebuild` runs daily and calls `rebuildStaleEstimates`. It takes
  the games whose signals moved since their last rebuild, oldest first, at most once
  per UTC week.
- A new estimation rule, or a new model, reaches a game at its next rebuild. A game
  can keep its old figure for about two weeks after a deploy. That is expected.
- `sales_estimate.computedAt` is the date of the last capture moment, not the time
  of the rebuild. For the real time, read `lastSuccessAt` in `game_ingestion_state`
  with `pipeline = 'ESTIMATE_REBUILD'`.

The ML rollout of 2026-10-29 is the example: on 2026-11-01, 203 of about 1,500
eligible games had an `ml-ensemble` row, and every eligible game rebuilt since
2026-10-30 had one. Nothing was wrong.

## What this does not cover

Fixing one game's data, such as rejecting a wrong milestone, stays allowed. So does
explaining what a script does when the owner asks. Writing a new backfill script
falls under the rule above: only if the owner asks.
