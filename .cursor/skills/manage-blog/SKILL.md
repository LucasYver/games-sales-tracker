---
name: manage-blog
description: >-
  Change the official-sales blog: candidate score, eligibility, weekly
  blog-draft cron, writer/editor models, admin review, or public /blog
  pages. Use when the user mentions Candidates, pickBest, BlogCandidateService,
  fact pack, DRAFT/PUBLISHED, or how a game is chosen for an article.
---

# Manage the official-sales blog

Owner files: `backend/src/blog/blog-candidate.service.ts` (eligibility +
score), `blog-fact-pack.service.ts` (writer facts), `blog.service.ts`
(lifecycle), `blog-writer.service.ts` + `blog-prompts.ts` (OpenAI).

v1 articles use sourced milestones and public signals only. Never put
model estimates (`estimatedToday` / Boxleiter) or `sourceUrl` / verbatim
quotes on a public page. Never mention AI on `/blog`. Never auto-publish.

## Generation

`BlogService.generateForGame` (admin Generate / Sunday cron):

1. Freeze a fact pack (`BlogFactPackService.buildForGame`) — sourced
   milestones + public signals. No model estimates. `sourceUrl` stays
   admin-only and is stripped before the writer.
2. `BlogWriterService.writeLocale` runs EN and FR in parallel. Writer
   model `BLOG_WRITER_MODEL` (default `gpt-6.1-sol`) returns the full
   article JSON. Editor `BLOG_EDITOR_MODEL` (default `gpt-6-luna`) lists
   issues only — it does not rewrite.
3. Deterministic `findUnverifiedNumbers` on the draft.
4. Persist `blog_post` + both translations in **one transaction** as
   `DRAFT`. If the translation insert fails, roll back so the review page
   is not left with a fact list and empty EN/FR editors.
5. Resend review mail. Nothing is public until an admin clicks Publish.

Public `/[locale]/blog` is `force-dynamic` and fetches with `cache: 'no-store'`.
Do not put a long `revalidate` TTL on the index: an empty first visit
otherwise sticks after Publish. `publishBlogPost` / `unpublishBlogPost`
must `updateTag('blog')` and revalidate the locale blog + game pages.

`/admin/blog/:id` is the review screen, not a writing plan: fact pack at
the top, then editable EN/FR title / meta / excerpt / TL;DR / body.
Regenerate replaces the draft for that game (blocked only if PUBLISHED).

## Who uses the score

- Admin tab `/admin/blog?status=CANDIDATES` → `list(40)`.
- Sunday cron `GET /api/cron/blog-draft` → `pickBest()` then
  `generateForGame`. Skip a new draft if any `DRAFT` exists (send digest)
  or if `OPENAI_API_KEY` is unset.

One article per game: any `blog_post` row (draft, published, or rejected)
removes the game from the pool.

## Eligibility (gate, not points)

CORE, paid, not soft-deleted, no existing `blog_post`. At least **two**
non-rejected sales milestones that are not leaks
(`STEAM_LEAK` / `PLAYSTATION_LEAK`) and not generic estimates — Alinea /
Rhys Elliot rows stay even when `isEstimate`. At least one of those must
be OFFICIAL, WIKIPEDIA, or Alinea.

Score only runs on that set. Do not loop `BlogFactPackService.buildForGame`
over CORE; keep one aggregated SQL query.

## Score

Weights live in `BlogCandidateService.score()`. Start at 0, then:

| Signal | Points |
| --- | --- |
| Newest OFFICIAL / WIKIPEDIA / Alinea figure ≤ 90 days | +40 |
| …else ≤ 365 days | +15 |
| Each sourced sales fact, cap 8 | +5 each (max +40) |
| Has an OFFICIAL figure | +10 |
| Has an Alinea / Rhys Elliot figure | +8 |
| Has a non-GLOBAL (platform-scoped) figure | +8 |
| Popularity (`game_rank.avgPercentile`, else log10 Steam reviews) | +0–20 |
| Released in the last 18 months | +5 |
| Single source **and** single date | −10 |
| Last milestone > 5 years **and** not popular (pop < 12 and reviews < 50k) | −15 |

Sort: score desc, then Steam reviews desc, then `gameId`. The `Why` column
is `reasons[]` from this function.

Popularity: `round((1 − clamp(avgPercentile, 0, 1)) × 20)`. If no rank,
`min(20, round(log10(steamReviews) × 5))`.

Changing a weight, the 90/365-day windows, or the eligibility HAVING
clause: edit `blog-candidate.service.ts` and this table together.

## Do not

- Soft-reject Alinea / Rhys Elliot as low-trust estimates (see
  `alinea-milestones` rule).
- Revive a game that already has a `blog_post` without an explicit ask.
- Lead the article with model sales estimates.
- Copy these weights into `ARCHITECTURE.md` or other skills.
