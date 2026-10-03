---
name: debug-ingestion-pipeline
description: >-
  Diagnose a game-sales-tracker cron or ingestion pipeline that stopped
  collecting, falls behind, or errors. Use when a signal is stale, a cron
  returns 401, leftover stays high, or game_ingestion_state shows failures.
  Reads lastAttemptAt, lastSuccessAt, lastError, credentials, and the
  cadence budget before changing code.
---

# Debug an ingestion pipeline

Read `DATABASE_URL` from `backend/.env`. Never hardcode it. Schedules are
in `vercel.json`. Per-game progress is `game_ingestion_state`.

## Classify before editing

| Symptom | Cause | Do |
| --- | --- | --- |
| HTTP 401 `CRON_SECRET is not set` / `Invalid cron secret` | Env missing or header is not `Bearer <CRON_SECRET>` | Fix the secret. Not a collector bug. |
| Log says the API key is unset and the client will skip | `OPENAI_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, `GAMES_POPULARITY_API_KEY`, IGDB, Twitch, or `STEAM_API_KEY` | Set the key. Do not stamp failures for the catalog. |
| `leftover` > 0, `lastError` null, attempts move forward | 11-minute budget (`RUN_BUDGET_MS`) hit `maxDuration` 800s | Expected. Next run continues stalest-first. Raise volume only if leftover never shrinks across days. |
| `lastAttemptAt` in this cycle, `lastSuccessAt` older, `lastError` set | The call threw | Read `lastError`. Fix that. |
| No `game_ingestion_state` row | Game not in the target set, or this job does not track per game | Check filters below before assuming the cron is dead. |
| Attempted this cycle, no success, no error | `track()` stamps the attempt first; the process was killed mid-call | Same as a budget kill. It will not retry until the next cadence window. |

`isDue` uses `lastAttemptAt`, not `lastSuccessAt`. A failed game waits
until the next hour/day/week/month. Deleting its state row forces a retry.
Do that only when the user wants a retry now.

## SQL

```sql
SELECT pipeline,
       count(*) AS games,
       count("lastSuccessAt") AS successes,
       count("lastError") AS errors,
       max("lastSuccessAt") AS latest_success,
       max("lastAttemptAt") AS latest_attempt
FROM game_ingestion_state
GROUP BY pipeline
ORDER BY pipeline;

SELECT "lastAttemptAt", "lastSuccessAt", "failureCount", left("lastError", 400)
FROM game_ingestion_state
WHERE pipeline = '<PIPELINE>' AND "gameId" = '<id>';
```

Pipeline names are the `INGESTION_PIPELINES` strings (`STEAM_CCU`,
`STEAM_REVIEWS`, `STORE_RATINGS`, `TWITCH_VIEWERS`, `STEAM_POPULARITY`, …).
`game-rank` has no pipeline row. Discovery writes `DISCOVERY` only for a
newly inserted stub.

## Target filters

- `isFree = true` is excluded from sales polls.
- Steam metrics need `game_source.source = 'STEAM'`.
- `STORE_RATINGS`, `PS_PRICE`, `XBOX_PRICE` need a console platform.
- `MILESTONE_HARVEST` also requires `isEligibleForAutomaticHarvest` and
  `isDueForRefresh`. An extended game with a weak rank is skipped on purpose.
- Store ratings throw when a PlayStation game has no concept URL. That
  string in `lastError` is the diagnosis.

## After a code fix

One game: the existing admin refresh or the matching backfill script.
Do not rebuild estimate history unless the signal itself feeds
`estimatedToday` (`STEAM_REVIEWS`, launch-window `STEAM_CONCURRENT`,
`PS_RATINGS`, `XBOX_RATINGS`). Followers, Twitch, prices, and playtime
do not.

Then hit the cron once locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3001/api/cron/<name>
```
