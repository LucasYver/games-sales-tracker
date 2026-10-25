---
name: sync-skills-and-rules
description: >-
  Check and update game-sales-tracker skills (.cursor/skills) and rules
  (.cursor/rules) after changing code, config, env vars, crons, entities,
  thresholds, or behavior that a skill or rule already describes. Use at the
  end of any code change, before reporting done, and when the user asks to
  verify or update skills or rules.
---

# Sync skills and rules

A skill or rule that describes old behavior is worse than none: the next
agent follows it. After a change, check them before saying the work is done.

## When

Run this after changing anything a skill or rule may name: a function,
file path, env var, cron, pipeline, entity or column, constant, threshold,
cadence, admin route, or a documented workflow step.

Pure refactors that keep every name and behavior need no update.

## Procedure

1. List what changed: symbols, file paths, env vars, routes, constants,
   and behaviors (old → new).
2. Grep `.cursor/skills/**/SKILL.md` and `.cursor/rules/*.mdc` for each
   old name and for the behavior's keywords, not only the symbol.
3. Read every hit in context. Classify it:
   - **Still true**: leave it.
   - **Wrong or stale**: fix it in place. Delete the sentence if the
     behavior is gone; do not leave "previously…" notes.
   - **Missing**: add a line only if the skill owns that workflow and the
     next agent would make a mistake without it.
4. Check each touched skill's frontmatter `description`. Update trigger
   terms if a renamed env var, route, or concept is listed there.
5. Report which skills and rules you changed, and which hits you left
   as still true.

## Rules vs skills

- **Skills** describe how the code works and how to change it. Fix them
  directly to match the code.
- **Rules** often encode user policy (source quality, Alinea keepers,
  blacklists, no tests, migration workflow). If a code change contradicts
  a policy rule, do not rewrite the rule to fit the code. Stop and ask the
  user which one is right.
- A rule that only describes mechanics (paths, commands, file names) can
  be fixed like a skill.

## Keep it tight

- One owner per fact. Point to the file (`see scheduler/refresh-interval.ts`)
  instead of copying values or tables into several skills.
- Do not paste cron expressions, numeric thresholds, or env values into a
  skill when the code or `vercel.json` already owns them.
- Do not create a new skill or rule unless the user asks.
- Markdown docs (`ARCHITECTURE.md`, `ESTIMATION.md`, …) follow the
  `sync-project-documentation` skill.
