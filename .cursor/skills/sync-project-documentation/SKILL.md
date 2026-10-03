---
name: sync-project-documentation
description: >-
  Update game-sales-tracker docs and skills after a structural code change
  so they do not describe removed behavior. Use when the user asks to update
  the docs, or after changing estimation, discovery, crons, admin routes,
  entities, or matcher weights. Each fact has one owner file.
---

# Sync project documentation

Update the owner of a fact. Do not paste the same list into every file.
Do not create a new markdown file unless the user names it.

Verified-against lines mean the code was checked at that commit. If you
did not re-read the file's claims, delete the stamp instead of bumping it.

## Owners

| Fact | Owner | Do not duplicate in |
| --- | --- | --- |
| Install, ports, dump restore | `README.md` | the other docs |
| Module map, entity one-liners, route names | `ARCHITECTURE.md` | formula or schedule tables |
| Estimate formulas, weights' meaning, headline vs milestone | `ESTIMATION.md` | `ARCHITECTURE.md` |
| Matcher weights, k, holdout numbers | `DATA_DRIVEN_PROFILES.md` | `ESTIMATION.md` beyond a pointer |
| Cron expressions | `vercel.json` | markdown |
| Discovery thresholds | `ingestion/discovery.constants.ts` | markdown |
| DB connection, migrations | `.cursor/skills/database-connection` and `.cursor/rules/typeorm-migrations.mdc` | |
| How to change a cron / debug one / change discovery / add admin UI | the matching skill under `.cursor/skills/` | |

`backend/README.md` and `frontend/README.md` stay short pointers. They do
not restate the model.

## When the code change is…

- **A cron added or rescheduled.** Update `manage-vercel-cron` only if the
  wiring steps changed. Do not add the expression to `ARCHITECTURE.md`.
- **An estimation formula or removed column.** Update `ESTIMATION.md` and
  `diagnose-estimate-divergence`. Grep docs for the old symbol
  (`calibratedMultiplier`, `pureEstimated`, `GenreProfile`,
  `genreProfileId`).
- **A matcher weight.** Update the weight table in `DATA_DRIVEN_PROFILES.md`
  from `SIMILARITY_WEIGHTS`. Do not invent a new holdout number. Point at
  `scripts/.validate-matcher-holdout.json` or say it was not re-run.
- **A new entity or public route.** One row in `ARCHITECTURE.md`. The
  controller file remains the endpoint list.
- **A discovery threshold.** Code only, unless the tier rules in
  `manage-catalog-discovery` became wrong.
- **An admin page.** `build-admin-feature` only if the pattern changed.
  `ARCHITECTURE.md` lists page groups, not every button.

## Procedure

1. Grep `*.md` and `.cursor/skills/**/*.md` for the symbol, route, or
   constant you changed.
2. Fix the owner. Delete contradicted sentences in the other files
   instead of restating the new behavior.
3. Prefer "see `path/to/file.ts`" over a second table.
4. Leave historical migration names in place when they explain a removal.
   Mark them as removed.
5. Do not document a follow-up you did not verify in the current code.

## Drift checks

These are wrong if they reappear as current behavior:

- Per-game calibration or a pure-algo snapshot column.
- `GenreProfile` as a live profile.
- RSS polling.
- PostgreSQL 15.
- PC Boxleiter default high of 70 (the constant is 65).
- Two in-process crons at 02:00 and 03:00 as the whole scheduler.
- Nest or Next starter README text (`Mau`, Geist, `app/page.tsx`).
