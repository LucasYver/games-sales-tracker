---
name: no-tests
description: >-
  Do not write, generate, expand, or fix unit/integration/e2e tests in
  game-sales-tracker. Use whenever implementing features, bugfixes, refactors,
  migrations, or when tempted to add/update *.spec.ts, *.test.ts, Jest, Vitest,
  Playwright, or any test file. Exception: only if the user explicitly asks
  for tests in that message.
---

# No tests in this project

Do not write tests. They cost AI tokens for nothing.

## Rules

- Do not create `*.spec.ts`, `*.test.ts`, `*.test.tsx`, or any other test file.
- Do not add `describe` / `it` / `test` cases to existing specs.
- Do not "align" or "fix" tests as a side effect of a product change.
- Do not propose a test plan that includes writing new tests.
- Verify with typecheck, lint, build, or a targeted runtime check instead.

## Exception

Write or edit tests only when the user explicitly asks for tests in the current message.
