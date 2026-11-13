---
name: track-visitor-events
description: >-
  Decide whether a new or changed visitor action on the game-sales-tracker
  public site should send a Vercel Analytics custom event, and wire it the
  project way. Use whenever adding or changing something a visitor can click,
  choose or submit on the public site (a button, link to another site, select,
  tab, filter, toggle, search, form, share or copy action, a new page section
  with controls), and when the user mentions analytics, Vercel events, track(),
  trackEvent, outbound_click or "suivre les actions des visiteurs". Not for
  /admin, which is never tracked.
---

# Track visitor events

The public site sends Vercel Web Analytics custom events through one typed
wrapper, `frontend/src/lib/analytics.ts`. Each new visitor action is a chance
to learn how the site is used, but each event also costs quota. Ask the
question every time, and answer it on purpose.

## When building or changing a public control

Before reporting done, go through this:

```
- [ ] Does it answer a product question? (see "Worth tracking")
- [ ] If yes: event added to the `Events` type, at most 2 properties
- [ ] Sent with trackEvent(), from the click/choice handler only
- [ ] Links to another site use <OutboundLink from="...">
- [ ] Privacy text (messages/*.json, privacy.analyticsBody) still true in 5 languages
- [ ] Event checked in the local browser (see "Verify")
- [ ] Said in the report which event was added, or why none was
```

If the answer is no, say so in one line in the report ("no event: purely
cosmetic control"). Do not ask the owner each time; propose the event as part
of the change.

## Worth tracking

Track a deliberate visitor action when its count would change a decision:

- **What visitors look for and do not find**: searches, empty results, a
  filter combination that returns nothing. This feeds catalog discovery.
- **Which features are used**: a new filter, chart option, tab, sort, toggle.
  An unused feature can be removed or moved.
- **Where visitors leave and to whom**: any link to another site (stores,
  sources, affiliates). Affiliate links have their own event because they
  are revenue.
- **Trust in the figures**: clicks on sources, methodology, "how is this
  estimated" links.
- **Sharing and conversion**: share, copy link, subscribe, contact.

## Not worth tracking

- Page views and route changes: `<Analytics />` already counts them (path
  only; query strings are not kept, which is why filters need an event).
- Hover, scroll, focus, every keystroke, chart tooltips, opening a menu
  without choosing.
- Anything in `/admin` (its layout has no `<Analytics />`, keep it that way).
- Data the backend already logs or stores.
- Actions that would fire many times per visit with no new information
  (debounce or fire once per value instead, as `search_no_result` does).

## How to wire it

1. Add the event to the `Events` type in `frontend/src/lib/analytics.ts`,
   in the right group, `snake_case`, `noun_verb` style (`filter_change`,
   `outbound_click`). Reuse an existing event with a new property value
   before inventing a near-duplicate.
2. At most **2 properties** (Vercel Pro limit), string or number, each value
   cut at 255 characters by the wrapper. Use untranslated ids (slug, enum,
   key), never translated labels, so the five locales group together.
3. Call `trackEvent('name', { ... })` in the handler that performs the
   action, in a client component. Never import `track` from
   `@vercel/analytics` directly.
4. In a server component, move the control into a small client component,
   or for a plain link to another site use `components/OutboundLink.tsx`
   with `from` = game slug, page name (`gta-6-sales`) or `blog/<slug>`.
5. Never send personal data. Free text typed by a visitor (search query) is
   lowercased and cut to 50 characters, and only when it is the point of the
   event.
6. If the event tracks a new kind of behaviour, update
   `privacy.analyticsBody` in `frontend/messages/{en,fr,es,ru,ar}.json`.
7. If the list of tracked areas changes, update the analytics sentence in
   `ARCHITECTURE.md` (frontend section).

## Verify

`npx tsc --noEmit` in `frontend/`, then in the local preview wrap `window.va`
to capture events and perform the action:

```js
window.__ev = [];
const o = window.va;
window.va = (...a) => { if (a[0] === 'event') window.__ev.push(a[1]); return o(...a); };
// do the action, then:
JSON.stringify(window.__ev);
```

The wrap is lost on a full page load; set it again after `navigate`.

## Cost

Events cost nothing on the server (no function, no Neon query); they count
against the Vercel Analytics event quota. To silence a noisy event, remove
its `trackEvent` call and its entry in `Events`.
