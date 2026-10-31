---
name: milestone-duplicates
description: >-
  Explains why exact duplicate milestones are harmless in game-sales-tracker and
  must not be rejected or counted as defects. Use when auditing or cleaning
  milestones, reading the DOUBLON_CHIFFRE flag, proposing to reject or merge
  repeated figures, deduplicating the milestone table, or when the user mentions
  doublons or duplicates. Covers milestones only, not duplicate game entries.
---

# Exact duplicate milestones are not a defect

The owner decided this on 2026-10-31. When several lines give the same figure on
the same date, the repeat tends to confirm the figure. Do not reject those lines,
do not count them as defects, and do not clean them in bulk.

## What counts as an exact duplicate

Same game, same platform, same `units`, same day in `reportedAt`. The source URL
can differ, and so can the language of the page.

These are not exact duplicates, so the normal checks apply:

- **Same figure, other date:** check the date. It may be an old figure re-dated by
  a later article, or a figure dated too early.
- **Rounded figure:** 2.8M next to 2.88M.
- **Same figure, other platform:** a PC figure also stored as `GLOBAL` is a
  platform error.

## Why they do no harm

Sales are cumulative, so the code takes the highest or the latest figure. A repeat
changes neither.

| Where | What it reads |
|---|---|
| Site headline (`aggregateSales` in `games.service.ts`) | largest declared figure |
| `estimation.service.ts` | `GLOBAL` figures sorted by `units`, first one |
| Series and studio track record (`matcher.service.ts`, `ml-estimate.service.ts`, `_best_before` in `ml/features.py`) | `MAX(units)` |
| Reference profile scale (`reference-profile.service.ts`) | latest `GLOBAL` figure |
| Blog facts (`blog-fact-pack.service.ts`) | removes near-identical facts itself |
| ML bench and training (`game_weights` in `ml/metrics.py`) | each game weighs the same, however many lines it has |

## Where a repeat still counts a little

A repeat repeats a true point, so these effects are small. Do not use them as a
reason to reject the line.

- **Inside one game, in the bench:** a repeated figure takes a larger share of
  that game's weight, and the number of figures reported is higher.
- **PC ratio (`pcBoxleiterRatios` in `reference-profile.service.ts`):** every PC
  line gives one ratio, then the ratios are averaged in log space. A repeated PC
  line counts several times in that mean.

Any new code that averages or counts milestones has the same exposure. Check it
when you write it, and do not assume that repeats cancel out.

## What to do in an audit

- Leave exact duplicates out of the rejection list and out of the defect count.
- `DOUBLON_CHIFFRE` in `ml/audit_milestones.py` is a hint. Use it to find the
  copies of a line, not as a reason to reject.
- **Correct all copies together.** A copy has the defects of its original. Silent
  Hill 2 has several lines with Konami's 5M, which includes subscriptions. Marking
  only one as `isEngagement` leaves 5M counted as sales on the others. The same
  applies to a wrong date, platform or game.
- **Judge each line on its own for anything else.** An exact copy from a junk host
  can still be rejected, for the source and not for the repeat.

Several outlets repeating one announcement show the figure was published. They do
not make a false figure true.

## What this does not cover

- Duplicate game entries, such as two pages for one game, still need merging.
- `import-alinea-milestones.ts` skips figures it already holds, so a rerun adds
  nothing. Keep that.

The weekly audit prompt in
`~/.claude/scheduled-tasks/audit-milestones-hebdo/SKILL.md` follows this rule.
