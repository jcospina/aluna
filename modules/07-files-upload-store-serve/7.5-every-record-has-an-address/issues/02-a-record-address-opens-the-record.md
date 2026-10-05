# A record address opens the record

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 40 to 43; ADR-0010: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

Typing, pasting or reloading `/capability/:id/:record` lands on that record's view in the
window. Today a record view exists only as a `<template>` cloned out of a card that `read`
or `search` returned, and a three-segment GET falls into the Action route and answers a
bare 404 fragment.

**The route.** `GET /capability/:id/:record` is registered ahead of
`/capability/:id/:action` (`src/runtime/router/dispatch/router.ts`). The five Action names
keep their route, a UUID-shaped segment is a record, and anything else answers 404 as
before. The route takes a read token and answers 409 while the read gate closes, as the
collection view does. Its full-page load runs the desk-load recovery
(`registerCapabilityPageRecovery` in `src/server/app.ts`).

**The server draws one record.** A platform read fetches the row by `id` from the active
incarnation's table and narrows it exactly as the collection's presentation does. It then
renders the record view through the same adapter that writes a card's template, so the
view a link opens and the view a press opens are the same markup. No generated Handler
runs. With `HX-Request` it answers the fragment for the window; without it, the whole
desk, with `cache-control: no-store`.

**The desk opens it on load.** `desk-address.js` recognises the third shape, and
`renderAddress` opens the record instead of the collection. A four-segment path, or one
whose last segment is not a UUID, is still not an address the desk knows.

**An absent record.** A record that was deleted, never existed or belongs to another
capability opens the capability's collection, says `NOT_FOUND_NOTICE` on the prompt bar,
answers 404, and corrects the address to `/capability/:id`. A capability without `update`
opens its collection with no notice.

## Acceptance criteria

- [x] `GET /capability/:id/:record` answers the record view fragment under `HX-Request`
      and the whole desk without it; the five Action routes behave exactly as before
- [x] The fragment equals what a card press renders for the same record, and carries no
      inactive field, no `extra` and no file key
- [x] Reload, a pasted address and a new tab all show the record in the window
- [x] Deleted, unknown, malformed and other-capability record ids open the collection
      with the notice and a 404; an unknown capability still gives the bare desk
- [x] A capability being deleted answers 409 here, as its collection does
- [x] `desk-window-address.test.ts`'s pin that a deeper path is not an address is
      rewritten to the new shapes, not deleted
- [x] An adversarial pass on route collisions, id spelling, injection through the
      segment and a record read across capabilities is clean
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, open a capability, press a card, and copy its id from the developer panel (or
the item's `data-item`). Then load `/capability/<id>/<record>` in a new tab: the window
opens on that record's form. Change one character of the id and reload: the collection
opens and the prompt bar says it can’t find that one.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/01-the-record-address-is-decided-and-drawn.md

## What landed

**The route.** `src/runtime/router/dispatch/address/capability-views.ts` now owns both places a
capability is addressed: the collection, and `GET /capability/:id/:record`, registered ahead of
the Action route. The record segment is matched by shape (`RECORD_ID_PATTERN` in
`public/core/routes.js`, a hyphenated UUID in either case, shared with the desk), so the five
Action names keep their route. Both views read through one `withCapabilityRead`: the read token,
the 409 while the gate closes, the bare desk for an unknown capability, and `internalFailure`.
`CAPABILITY_PAGE_ROUTES` lists the four page spellings (each with a trailing slash), and
`registerCapabilityPageRecovery` in `src/server/app.ts` loops over it, so a record address runs
the desk-load recovery. `isInPageRequest` moved to `src/server/http/in-page-request.ts`.

**The server draws one record.** The platform reads the row by its lower-cased id through the
capability's own query port, so a record of another capability is simply not there, and the port
narrows it as every collection read is. `renderPresentedRecordView`
(`src/presentation/records/adapter.ts`) draws it with the record, stored files and template id a
card's `<template>` uses. A capability without `update` (`hasRecordView`) answers 404 before any
read, with an empty fragment, so the desk opens its collection unremarked.

**The desk opens it.** `public/desk/desk-address.js` reads the record shape
(`recordFromAddress`, decoding before checking the shape, as the server does) and compares places
by capability and record. `public/desk/window/addressed-window.js` fills a window an address opened:

- Each ask comes from a hidden element of its own, never the logo. It owns its endings, and an
  answer that arrives after the window changed hands (a newer opening, a newer address, another
  swap into the window, or a record opened in it) is neither swapped in nor said.
- A record that is not there corrects the bar to `/capability/:id`, and the collection is asked
  for into the same window from inside it, so the prompt bar keeps the notice.
- `windowAddress` keeps the bar on a record address while that record's view holds the window,
  where every swap used to correct it to the collection's address.
- `addressAsks` answers "nothing" only for the place the window already shows.

`RECORD_ID_FIELD`, `focusFirstField` and `WINDOW_TOOK_CAPABILITY_EVENT` moved to
`public/core/shell-dom.js`.

**Decisions taken without the owner, open to reversal.**

- *Malformed.* A segment not shaped like a UUID answers the Action route's 404 as before (issue
  body, ADR-0010, PLAN 41). The criterion's "malformed" is read as UUID-shaped but naming no
  record, the nil UUID among them. A pasted address with a non-hex character gets the bare
  not-found sentence, not the desk.
- *A trailing slash* on a record address is the same record, as it is for a collection.
- *A full page for an absent record* carries no seeded notice. The desk asks for the record
  itself, and that answer says it, so the bar says it once.
- *A refused address over a capability the person was reading* keeps it: the window's name and
  the bar go back to what it shows. An empty window, or one holding no capability, is put away
  and the bar goes to `/`.
- *A Handler that reshapes `record.fields`* would show the reshaped values on a press and the
  stored ones at the address. Every live `read` presents what it read, so the two match. The
  JSDoc records the precondition.

**Tests.** `router.record-address.test.ts` and `router.record-address.files.test.ts` (the route,
the card-press equality, narrowing, the absent, foreign, nil and upper-case ids, near-miss and
injection-shaped segments, 409, GET only, the trailing slash, a file field, no `update`);
`desk-window-record-address.desk.test.ts` (the desk against htmx's real event targets and order,
with every race below); the rewritten pins in `desk-window-address.test.ts` and
`desk-window.gestures.test.ts`; the record path in `desk-load-sweep.test.ts`; and the reserved
prefix on `ALUNA_RECORD_ID_MARKER`. The desk DOM double (`desk-dom.test-support.ts`) now reads
descendant selectors, `:not([attr=value])` and unquoted values, and throws on what it cannot read.

**Handed to 7.5/03** (in its issue): the address after a run that took the window mid-load gives
it back empty.

## Adversarial findings, all fixed

Five Opus passes, plus a standards and spec review.

- A record address over its own capability's collection was cancelled by the press guard; Back
  onto an absent record left a mislabelled window; a press mid-load lost its window; htmx queued
  address asks behind presses (MEDIUM). Each ask now comes from an element of its own and
  answers only while its opening is current.
- The stale-answer guard matched `detail.elt`, which htmx sets to the swap target, so late
  answers still swapped in live (HIGH, third pass). Matched by `requestConfig.elt`; the test
  double was firing events from the wrong elements and now fires them where htmx does.
- A traversal that asked for nothing, and A→B→A through a card and the back control, did not
  overtake an ask in flight (HIGH, MEDIUM). A network failure was never heard, because htmx sends
  `afterRequest` first (MEDIUM). An overtaken answer then made the newer ask drop its own (HIGH,
  fifth pass). All fixed, each with a test that fails without it.
- Back from a record onto its collection did nothing; a hash change refetched the record and
  discarded edits; a prompt submitted mid-load was overwritten; focus was taken from where the
  person had moved it; a refusal over a held record moved the bar to the collection; a second
  render of the place being filled asked again (MEDIUM, LOW). All fixed.
- Collection addresses had the same never-corrected bar after a refused load; fixed on the way.
- Review: `windowAddress` untested (HIGH); views duplicated and misplaced; three HX checks;
  retyped template ids; stale comments naming "no read-single route"; typedef blocks; a broad
  selector; the reserved-prefix pin. All fixed.

## Verification

`bun run test` 4702 pass; `bun run typecheck` and `bun run lint` clean; the new and changed suites
105 pass. Mutation checks: removing the desk-load route, the same-place guard, the overtake on
"nothing", the change-of-hands check, the record check in `live()` and the `requestConfig.elt`
match each fails its test.

Live on `:3030`, on the real corpus: a record address opens Bird sightings' Blue-crowned motmot
form with focus on its first field, from a new load, an upper-case spelling and a trailing slash.
One changed hex digit opens the collection, says "Hmm — I can’t find that one." and corrects the
bar. Another capability's id does the same for that capability. The record's back control lands on
the collection. Back and Forward across records and collections, quick bursts with delayed answers,
presses mid-load (same and other logos), network failures and refusals over held content all end
with the window and the bar naming the same place. The window frame is mounted once through a 404.

