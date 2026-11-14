---
name: manage-social-posts
description: Change the Threads and X posts of game-sales-tracker — what the daily social-drafts cron drafts, the writer prompt and number check, the admin review page /admin/social, publishing through the Threads API and the token refresh. Use when the user mentions Threads, social posts, réseaux sociaux, social-drafts, THREADS_ACCESS_TOKEN, X_API_KEY, Twitter, SocialPost, or wants to add another network (Bluesky).
---

# Manage social posts (Threads + X)

Owner files: `backend/src/social/social.service.ts` (candidates, lifecycle),
`social-writer.service.ts` (prompt + number check), `threads.client.ts`
(Threads API + token), `x.client.ts` (X API v2, OAuth 1.0a signed by hand), entity `social-post.entity.ts` (`social_post`,
`social_credential`), admin page `frontend/src/app/admin/social/`.

## Rules

- Never auto-publish. The cron writes `DRAFT`s; only the admin Publish button
  posts, through `SocialService.publish`.
- English only, links to `/en/...`. The link goes in `linkUrl` (Threads link
  preview), never in the text. A post that cites an official figure links the
  page that shows it (the blog article, the GTA 6 page), not the game page,
  which shows only our estimate: a reader checking the figure would land on
  another number.
- Tone (writer `SYSTEM` prompt): a hook first line (question or the figure),
  short lines, about the game rather than the article, never "our new article
  covers". Admin **Regenerate** rewrites a draft from its stored facts.
- Facts are code-written lines (`facts`). The writer may only copy their
  numbers; `unverifiedNumbers` lists any other number, is recounted on every
  edit, and blocks Publish unless the admin confirms (`force`).
- Estimates are named as estimates; Steam reviews are popularity, not sales.
  Never mention AI.
- Public pages show estimates only; official figures appear in the blog and
  the GTA 6 page. Posts follow the same split: official figures only in
  `BLOG_ARTICLE` (from the reviewed article) and `GTA6_FIGURE`.

## What gets drafted

Daily cron `GET /api/cron/social-drafts` (08:45 UTC, after `blog-news`),
`SocialService.runDailyDraftJob`. One row per `topicKey` (unique), so nothing
is drafted twice. At most 3 drafts per run, none while 6 wait.

| Kind | topicKey | When |
| --- | --- | --- |
| `GTA6_FIGURE` | `gta6:<milestoneId>` | newest GLOBAL sourced GTA 6 milestone captured in the last 7 days |
| `BLOG_ARTICLE` | `blog:<blogPostId>` | blog article first published in the last 7 days (EN title, excerpt, TL;DR) |
| `WEEKLY_TRENDS` | `trends:<date>` | Mondays: top 5 `trending` released paid games with an estimate |
| `MW4_UPDATE` | `mw4:<date>` | Mondays, MW4 younger than 180 days: Steam reviews vs BO7/BO6 at the same age (same rule as `frontend/src/lib/mw4.ts`) |

`SOCIAL_DRAFTS=off` stops drafting (the token refresh still runs). No
`OPENAI_API_KEY` → no drafts. Writer model `SOCIAL_WRITER_MODEL`
(default `gpt-6-luna`, low effort, one revision pass on a bad number or
length). Drafts are mailed to admins (`AdminMailService.sendSocialDraftsReady`).

## Threads API

- Free. The site's Threads account is a tester of the owner's Meta app, so no
  app review is needed to post to it. 250 posts a day max, 500 characters.
- Publish = `POST /me/threads` (TEXT + `link_attachment`) then
  `POST /me/threads_publish`, retried a few times while the container
  processes; the permalink is stored in `externalUrl`.
- Token: long-lived (60 days). `THREADS_ACCESS_TOKEN` seeds
  `social_credential` once; the cron refreshes it when the last refresh is a
  week old and stores the new one. If it ever expires, generate a new token,
  delete the `social_credential` row and update the env var.

## X

- One draft, two texts: `text` (Threads, 500 max, link preview) and `xText`
  (X, written at 260 max for a 280 limit, **no link**). The owner chose no
  link on X: on its pay-per-use API a post costs about $0.015, and about
  $0.20 with a URL. The site link lives in the X profile.
- Publish posts on every configured network not done yet (Threads, then X).
  A failure keeps the post in `DRAFT` with `lastError`, and the next Publish
  retries only the missing network. `PUBLISHED` once all are out.
- Env: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
  (do not expire). Without all four, posts go to Threads only. The account
  must carry X's "Automated" label.

## Cost

A few posts a week: under $1/month of OpenAI, under $1/month of X API at
1–2 posts a day without links, one short cron a day, a few rows a week in
Neon.

## Adding a network

Add a client like `XClient`, its text and id columns on `social_post`, and
its step in `SocialService.publish`. Check that network's API price first
(`control-platform-costs`).
