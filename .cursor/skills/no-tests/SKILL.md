---
name: no-tests
description: >-
  game-sales-tracker has no tests and no test tooling. Do not write,
  generate or restore unit/integration/e2e tests or test dependencies. Use
  whenever implementing features, bugfixes, refactors, migrations, or when
  tempted to add *.spec.ts, *.test.ts, Jest, Vitest, Playwright, Supertest,
  or a "test" script. Exception: only if the user explicitly asks for tests
  in that message.
---

# No tests in this project

All tests and test tooling were removed on purpose: they cost AI tokens
for nothing. Keep it that way.

## Rules

- Do not create `*.spec.ts`, `*.test.ts`, `*.test.tsx`, or any other test file.
- Do not add Jest, Vitest, Playwright, Supertest, `@nestjs/testing` or any
  test runner, config block or `test` script back to a `package.json`.
- Do not propose a test plan that includes writing tests.
- Verify with typecheck (`npx tsc --noEmit`), lint, build, or a targeted
  runtime check instead. A throwaway check script goes in a scratch
  directory outside the repo, never in the repo.

## Exception

Write tests only when the user explicitly asks for tests in the current message.
