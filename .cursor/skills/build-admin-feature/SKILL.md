---
name: build-admin-feature
description: >-
  Add or change a game-sales-tracker back-office feature. Use when the user
  mentions /admin, an admin button, X-Admin-Token, ADMIN_TOKEN, or a
  back-office page. Wires the Nest admin controller, adminFetch server
  actions, and the English-only admin UI.
---

# Build an admin feature

`/admin` is English-only and outside `next-intl`. Hardcoded English in
`frontend/src/app/admin/` is the convention. Public pages still use
`messages/`. Do not put the admin token in client code.

## Checklist

```
- [ ] Domain work stays in the existing service (Ingestion, Games, Estimation, …)
- [ ] AdminController route under the class-level AdminTokenGuard
- [ ] Body validated by a DTO (global ValidationPipe, transform: true)
- [ ] Response type mirrored in frontend/src/lib/admin.ts
- [ ] Server action in frontend/src/app/admin/actions.ts via adminFetch
- [ ] Client control under admin/_components, useTransition, English labels
- [ ] revalidatePath on the pages that show the changed data
- [ ] New page: server component calls requireAdminToken, NAV_ITEMS entry
```

## Backend

`AdminController` is already `@UseGuards(AdminTokenGuard)`. Do not add a
second guard. Header is `X-Admin-Token`. `ADMIN_TOKEN` unset rejects every
request (fail-closed).

Keep the controller thin: parse params, call a service, return the service
result. Put queries in `AdminService` or the domain service that already
owns the data.

DTO classes live in `backend/src/admin/dto/`. Use `class-validator`. The
global pipe does not whitelist unknown fields unless the DTO does; do not
trust the raw body.

UUID params use `ParseUUIDPipe`.

## Frontend

Reads and mutations go through `adminFetch` (`frontend/src/lib/admin.ts`).
It sends the HttpOnly cookie token, uses `cache: 'no-store'`, and redirects
to `/admin/login?reason=expired` on 401.

Server actions live in `frontend/src/app/admin/actions.ts` (`'use server'`).
Follow `refreshGame` / `recomputeRanks`:

```typescript
export async function doThing(id: string): Promise<ThingResult> {
  const result = await adminFetch<ThingResult>(`/games/${id}/thing`, {
    method: 'POST',
  });
  revalidatePath(`/admin/games/${id}`);
  return result;
}
```

Client buttons follow `RefreshGameButton`: `'use client'`, `useTransition`,
`Button`, confirm only when the action deletes or rebuilds history, then
`window.alert` the service's summary. Disable the button while pending.

A new page starts with `await requireAdminToken()` and is registered in
`NAV_ITEMS` in `frontend/src/app/admin/layout.tsx`.

## Do not

- Fetch `/admin/...` from a client component with a token prop.
- Render milestone `sourceUrl` or verbatim quotes on a public route.
- Add a French string to a public component as part of the admin work.
- Write tests (`no-tests` skill).

## Check

Hit the new route without a token and expect 401. With the cookie, run the
action once and confirm the targeted admin page shows the new state after
`revalidatePath`.
