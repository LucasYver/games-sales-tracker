---
name: admin-auth
description: >-
  Explains game-sales-tracker back-office authentication: allowlist admin
  users, email/password login, HMAC sessions, Resend welcome mail, and env
  vars. Use when changing /admin login, ADMIN_SESSION_SECRET, admin_user,
  X-Admin-Session, bootstrap, create-admin-user, or admin welcome emails.
---

# Admin authentication

Allowlist only. There is **no public registration**. Accounts are created by
an existing admin, bootstrap env, or a CLI script. Passwords are scrypt-hashed;
sessions are HMAC-signed cookies. English-only UI (`/admin`).

For adding admin *pages/actions*, see `build-admin-feature`. This skill owns
**how login and sessions work**.

## Mental model

```
admin_user row (email + passwordHash)
        │
        ▼
POST /admin/auth/login  →  { token }  (HMAC session, TTL 7d)
        │
        ▼
HttpOnly cookie admin_session (path=/admin, maxAge 7d)
        │
        ▼
adminFetch → header X-Admin-Session → AdminAuthGuard
```

Fail-closed: if `ADMIN_SESSION_SECRET` is unset, every protected admin route
returns 401.

## Key files

| Role | Path |
| ---- | ---- |
| Entity | `backend/src/entities/admin-user.entity.ts` |
| Migration | `backend/src/db/migrations/1788800000000-AddAdminUser.ts` |
| Password hash | `backend/src/admin/password.ts` (Node `scrypt`, `salt:hex`) |
| Auth service | `backend/src/admin/admin-auth.service.ts` |
| Guard | `backend/src/admin/admin-auth.guard.ts` |
| Public login + user CRUD API | `backend/src/admin/admin-auth.controller.ts` |
| Protected API | `backend/src/admin/admin.controller.ts` (`@UseGuards(AdminAuthGuard)`) |
| Welcome email | `backend/src/admin/admin-mail.service.ts` (Resend HTTP) |
| Create-user CLI | `backend/src/scripts/create-admin-user.ts` → `npm run admin:create-user` |
| Cookie + `adminFetch` | `frontend/src/lib/admin.ts` |
| Sign-in / sign-out | `frontend/src/app/admin/actions.ts` |
| Login UI | `frontend/src/app/admin/login/page.tsx` |

## Login flow

1. User posts email + password on `/admin/login` → server action `signIn`.
2. Frontend `POST ${API_URL}/admin/auth/login` (no session header).
3. Backend rate-limits failures (5 / 15 min per email), verifies scrypt hash,
   rejects disabled users (`disabledAt`), updates `lastLoginAt`.
4. Backend returns `{ token, email, expiresAt }` — payload
   `{ sub, email, exp }` signed with HMAC-SHA256(`ADMIN_SESSION_SECRET`).
5. Frontend stores `token` in HttpOnly cookie `admin_session`
   (`secure` in production, `sameSite=lax`, `path=/admin`).
6. Later calls: `adminFetch` reads the cookie and sends `X-Admin-Session`.
   Guard verifies signature + expiry + user still exists and not disabled.
7. `401` → redirect `/admin/login?reason=expired`. Sign-out deletes the cookie.

Session TTL and cookie max-age are both **7 days**
(`SESSION_TTL_MS` / `COOKIE_MAX_AGE`). Change both together if you shorten
or lengthen sessions.

## Creating allowlisted users

No `/register`. Three paths, all call `AdminAuthService.createUser`
(except a duplicate check in bootstrap):

| Path | How |
| ---- | --- |
| Bootstrap | `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` (≥12 chars) on boot — creates only if email missing; never resets password from env |
| CLI | `cd backend && npm run admin:create-user -- you@ex.com 'password-12+'` |
| API | `POST /admin/auth/users` with a valid session (`{ email, password }`, min 12) |

After create: best-effort welcome email (does not roll back the user if mail fails).

`GET /admin/auth/users` lists allowlisted accounts (auth required).
`GET /admin/auth/me` returns `{ email }` for the current session.

## Welcome email (Resend)

`AdminMailService` POSTs to `https://api.resend.com/emails` when
`RESEND_API_KEY` is set; otherwise logs a warn and skips.

- From: `RESEND_FROM_EMAIL` (prod: verified domain, e.g.
  `Game Sales Tracker <noreply@gamesalestracker.tech>`)
- Link: `${PUBLIC_APP_URL}/admin/login`
- HTML: Chart Room palette (dark `#0e1420`, gold `#d9a441`, mono wordmark)
- Never include the password in the mail

Env must exist on **Vercel** (Production/Preview) as well as local `.env`.
After changing Vercel env vars, redeploy.

## Environment variables

| Var | Required | Role |
| --- | -------- | ---- |
| `ADMIN_SESSION_SECRET` | Yes for auth | HMAC key for sessions; empty → admin API disabled |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | No | First user on boot; remove password after use |
| `RESEND_API_KEY` | No | Welcome mail; skip if unset |
| `RESEND_FROM_EMAIL` | No | Sender (domain must be verified in Resend for arbitrary recipients) |
| `PUBLIC_APP_URL` | No | Base URL for the login link in mail |

**Removed:** `ADMIN_TOKEN` / `X-Admin-Token`. Do not reintroduce a shared
token login. Scripts that need the API should use a real admin session or a
dedicated machine flow designed later.

## Do not

- Add a public registration form or open signup.
- Put `ADMIN_SESSION_SECRET`, passwords, or session tokens in client bundles.
- Soften fail-closed when the session secret is missing.
- Store plaintext passwords.
- Document or restore `ADMIN_TOKEN` as current behavior.

## Common tasks

**Add a second admin:** CLI or authenticated `POST /admin/auth/users`.

**Rotate session secret:** set a new `ADMIN_SESSION_SECRET` locally + Vercel,
redeploy; all existing cookies invalidate → users re-login.

**Debug 401 after deploy:** confirm `ADMIN_SESSION_SECRET` is set on Vercel,
code with `AdminAuthGuard` is deployed, cookie path is `/admin`, and the
user row exists with `disabledAt` null.

**Disable an account:** set `admin_user.disabledAt` (no UI yet) — sessions
for that user fail verification on next request.
