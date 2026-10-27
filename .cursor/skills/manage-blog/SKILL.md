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
score), `blog-fact-pack.service.ts` (writer facts + freshness diff),
`blog.service.ts` (lifecycle), `blog-writer.service.ts` + `blog-prompts.ts`
(OpenAI), `blog-number-check.ts` (deterministic number check).

v1 articles use sourced milestones and public signals only. Never put
model estimates (`estimatedToday` / Boxleiter) or `sourceUrl` / verbatim
quotes on a public page. Never mention AI on `/blog`. Never auto-publish.

## Truth rules (the point of the blog)

A wrong figure is worse than a missing one. These live in code, not only
in the prompt — keep them there:

- Every fact carries a code-written `label` (scope worldwide vs one
  platform, official vs press vs Wikipedia, Alinea = third-party ESTIMATE,
  engagement = NOT copies, signals = popularity NOT sales). The writer and
  editor read it. Change labels in `milestoneLabel` / `SIGNALS`.
- `answerHint` picks the lead fact in code: newest non-Alinea GLOBAL sales
  figure, else newest non-Alinea, else the estimate (flagged as such).
- Prompt forbids arithmetic (sums, differences, %, growth, rounding into a
  new claim) and outside knowledge. `date` = when the figure was reported.
- `findUnverifiedNumbers` flags any number that is not a fact value, a
  fact year/day, or part of the game/publisher/developer name. Month
  names never count as a "m(illion)" suffix; FR narrow no-break spaces and
  "milliard" are parsed.

## No repetition (the other point)

- `consolidateFacts` (in `milestoneFacts`): one fact per figure. Same
  number from several sources → keep OFFICIAL > ANNOUNCEMENT > WIKIPEDIA >
  MEDIA, then earliest report. A lower figure reported after a higher one
  (same kind/platform, not Alinea) is an old number repeated → dropped.
  `compareFacts` consolidates the frozen side too, so older packs are not
  flagged stale for it.
- Each fact gets a `section` (`intro`, `timeline`, `platforms`, `players`,
  `popularity`) in `factsForModel`; the prompt puts each fact in its
  section once. The TL;DR box sits above the body and the body never
  repeats it. No FAQ (it only repeated the body); old articles keep theirs.
- `findRepeatedFigures` counts each fact's figure in `bodyMarkdown` (TL;DR
  excluded). Extra mentions become an `error` issue
  (`REPEATED_FIGURE_PROBLEM`), which triggers the revision pass and blocks
  publish until fixed; recounted on every edit.
- Length follows the facts (~200-350 words for 2-4 facts, max 700). The
  prompt has a short format example (invented game) — keep it invented.

## Generation

`BlogService.generateForGame` (admin Generate/Regenerate, Sunday cron):

1. Freeze a fact pack (`BlogFactPackService.buildForGame`) — sourced
   milestones + public signals, labelled. `sourceUrl` stays admin-only and
   is stripped before the writer.
2. `BlogWriterService.writeLocale` runs EN and FR in parallel. Writer
   `BLOG_WRITER_MODEL` (default `gpt-6.1-sol`) returns the article JSON;
   editor `BLOG_EDITOR_MODEL` (default `gpt-6-luna`) lists issues only.
3. `findUnverifiedNumbers` + `repeatedFigureIssues`. If either flags
   anything or the editor reports an `error` (including a sentence that
   makes no sense), the writer gets ONE revision pass with the problems,
   then all checks run again on the revised draft.
4. Persist `blog_post` + both translations in **one transaction** as
   `DRAFT`.
5. Resend review mail (“Update ready” for a refresh). Nothing changes on
   the public site until an admin publishes.

## Lifecycle

- **Live** = `publishedAt IS NOT NULL` and status ≠ `REJECTED`. Public
  routes, sitemap and the game-page link use that, not `status`.
- **Refresh**: regenerating a `PUBLISHED` article copies the public text
  and fact pack into `liveSnapshot` and moves the post to `DRAFT`. The
  public keeps reading the snapshot. Publish → new text goes live,
  `publishedAt` kept, `contentUpdatedAt` bumped. Reject (“Discard update”)
  → snapshot restored, status back to `PUBLISHED`, and
  `staleAckFingerprint` remembers the figures so the same change is not
  proposed again.
- **Freshness** (`BlogService.freshness`): compares the live fact pack's
  sales/engagement facts with today's eligible milestones. Any new,
  edited or rejected milestone → `stale`, unless the fingerprint was
  acknowledged. Admin shows “outdated figures”.
- **Edits** (`updateTranslation`) re-run `findUnverifiedNumbers` and drop
  editor issues whose quoted excerpt is gone. Editing a live article bumps
  `contentUpdatedAt`.
- **Publish guard**: `publish` refuses a `REJECTED` post and refuses while
  unverified numbers or editor `error`s remain, unless `force: true` (the
  admin confirms a warning listing the counts).
- `dateModified` / sitemap `lastmod` = `contentUpdatedAt ?? publishedAt`,
  never `updatedAt` (bumped by bookkeeping like the review mail).
- Public article shows “Latest figure on record: <month year>” from the
  newest sales/engagement fact of the live pack.

Public `/[locale]/blog` is `force-dynamic` and fetches with `cache: 'no-store'`.
Do not put a long `revalidate` TTL on the index: an empty first visit
otherwise sticks after Publish. `publishBlogPost` / `unpublishBlogPost` /
discarding a refresh / editing a live article must `updateTag('blog')`
and revalidate the locale blog + game pages. The sitemap lists one entry
per language version, each with its hreflang alternates.

`/admin/blog/:id` is the review screen, not a writing plan: fact pack
(with labels) at the top, then editable EN/FR title / meta / excerpt /
TL;DR / body (FAQ stays editable for older articles).

## Who uses the score

- Admin tab `/admin/blog?status=CANDIDATES` → `list(40)`.
- Sunday cron `GET /api/cron/blog-draft` → if any `DRAFT` exists, send
  the digest; if `OPENAI_API_KEY` is unset, skip. Otherwise refresh the
  oldest stale live article (`firstStaleLivePost`) if there is one, else
  `pickBest()` then `generateForGame`.

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
- Revive a game that already has a `blog_post` without an explicit ask
  (refreshing its own live article is not reviving).
- Take a live article offline to refresh it: use the snapshot flow.
- Lead the article with model sales estimates.
- Copy these weights into `ARCHITECTURE.md` or other skills.
