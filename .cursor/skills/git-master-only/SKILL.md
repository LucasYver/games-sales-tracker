---
name: git-master-only
description: >-
  Git workflow for game-sales-tracker: never create a branch, always commit
  and push on master. Use before any git checkout, branch, commit, push,
  merge or pull request, and whenever a session or tool suggests working on a
  feature branch (claude/..., feature/..., fix/...).
---

# Always on master

The owner works on `master` only. For now, never create a branch.

## Rules

- Commit on `master` and push with `git push origin master`.
- Do not create, check out or push any other branch, even if the session
  setup names one (`claude/...`). If you are on one, move the commits back
  to `master` (`git checkout master && git merge --ff-only <branch>`).
- Do not open pull requests.
- Pushing to `master` deploys to production (Vercel). Push only work that is
  finished and verified: backend `npx tsc --noEmit`, frontend
  `npx tsc --noEmit` + `npm run lint`, and `npm run build` when pages changed.
- Unfinished work stays as a local commit until it is verified; do not park
  it on a branch.

## Exception

Only when the owner explicitly asks for a branch in the current message.
