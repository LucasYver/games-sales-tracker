---
name: alinea-milestones
description: >-
  Keep Alinea Analytics and Rhys Elliott sales figures as real data in
  game-sales-tracker. Use when auditing or cleaning milestones, setting or
  proposing isEstimate, importing Alinea figures, changing the ML filters, or
  when the user mentions Alinea, Rhys Elliott, isEstimate or third-party
  estimates. Alinea figures must not carry isEstimate=true, because that flag
  removes them from the ML bench and the series and studio track record.
---

# Alinea figures count as data

Alinea Analytics and its analyst Rhys Elliott are a precious source for the
model. The owner decided on 2026-10-31 that their figures must not be ignored.
Do not set `isEstimate=true` on them, even when the text says "estimates".

`.cursor/rules/alinea-milestones.mdc` also forbids rejecting them because they
come from Alinea.

## Why the flag matters

`isEstimate=true` is not a label. It removes the figure from:

- the ML bench and training (`ml/features.py`), which keep GLOBAL figures with
  `isEstimate=false` and `isEngagement=false`;
- the series and studio track record, in `ml/features.py` and in production
  (`trackRecord` in `backend/src/estimation/ml/ml-estimate.service.ts`).

The blog does not depend on the flag: `isAlineaMilestone` in
`backend/src/blog/blog-alinea.ts` recognises Alinea by name and still credits
the figure to Alinea Analytics as a third-party estimate.

## Recognise an Alinea figure

Check the publisher, the note and the URL for `alinea`, the misspelling
`aliena`, `Rhys Elliot`, `Rhys Elliott` or `rhyselliott`, and the hosts
`alineaanalytics.com` and `alineaanalytics.substack.com`.

Press relays often drop the name. Treat a figure as Alinea when the article
credits Alinea, or when the same figure for the same game is already credited
to Alinea around that date. Open the article if neither settles it.

## What keeps isEstimate=true

Figures from other estimators stay flagged: VGChartz, EEDAR, VG Insights,
GameSensor, Gamalytic, SteamSpy, Sensor Tower, analyst banks, company forecasts
and unattributed "estimates".

## Still reject when the figure itself is wrong

Coming from Alinea does not protect a figure from a normal data check. Reject
or correct it for the same reasons as any other source:

- it is attached to the wrong game;
- it covers one part only, such as physical copies or pre-orders, recorded as a
  platform total;
- it is an old figure re-dated by a later article;
- it is on the wrong platform: a Steam figure belongs on `PC`, not `GLOBAL`.

## Where the policy is enforced

- `backend/src/scripts/import-alinea-milestones.ts` imports with
  `isEstimate: false`.
- `ml/audit_milestones.py` does not raise `ESTIMATION_PRESENTEE_COMME_REELLE?` on
  Alinea figures, and raises `ALINEA_A_DEMARQUER` on one that carries the flag.
- The weekly audit prompt in
  `~/.claude/scheduled-tasks/audit-milestones-hebdo/SKILL.md` forbids proposing
  the flag on Alinea figures.

## After changing flags in bulk

Export a new snapshot and rerun the bench from `ml/`. Compare against the same
figures before and after, because a changed list of figures moves the score on
its own:

```bash
.venv/bin/python export_snapshot.py --out data/$(date +%FT%H)
```

```bash
.venv/bin/python bench.py
```
