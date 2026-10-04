# Opening a record moves the address

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decision 44; ADR-0010: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

After 7.5/02 a record address works when it is loaded, but pressing a card still leaves
the bar on the collection. This issue makes the address follow the window.

**A press pushes.** Opening a record from a card, in a collection or in search results,
pushes its record address through the desk's existing `pushAddress`. The search term
still stays out of the address.

**Every way out leaves the same way.** The back control, a save and a delete all close
the record view. When the entry before is this capability's collection, they step back.
When the person arrived by link, they replace the entry with `/capability/:id`. Back and
Forward render a record or a collection without pushing. On a Forward onto a record deleted
since, the prompt bar says 7.5/02's notice.

**Guards hold.** The leave question for unsaved changes and the hold on a running build
cover a Back or Forward onto, off or between record addresses, as they cover every
traversal now. A build's restoration descriptor stays capability-only, so a finished
build shows the collection. A build started from a record address keeps that address
while it runs; when it gives that capability back, restored or shown evolved, the
address is replaced with `/capability/:id`, adding no entry (decision 44, amended
2026-10-03).

**The pins move, they do not go.** `desk-window-address.policy.ts` keeps exactly one
`pushState` and one `replaceState` in `desk-address.js`. Its "nothing below capability
identity" assertion becomes "a record id and nothing else: no search term, no draft".
`isAnotherPlace` compares the capability and the record.

## Acceptance criteria

- [ ] A card press pushes the record address; Back returns to the collection and
      Forward to the record, in the same window, with no reload
- [ ] Back control, save and delete each leave the record view to the collection address,
      stepping back or replacing as decision 44 says
- [ ] Unsaved changes ask before a traversal leaves a record; a running build holds it
- [ ] A build started from a record address that gives the capability back, restored
      or shown evolved, leaves the address on `/capability/:id` with no new entry
- [ ] The address policy and the restoration-descriptor pin are amended, and still bite
      (`bun run mutate` on the address module)
- [ ] `desk-address.js`, `desk-window.js` and `app.js` stay within their line ceilings
- [ ] An adversarial pass on history sequences (press, save, delete, Back, Forward, a
      second record, a build starting mid-record, the phone layout) is clean
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, open a capability and press a card: the bar shows `/capability/<id>/<record>`.
Press Back: the collection. Press Forward: the record. Type a change and press Back: Aluna
asks first. Save: the bar returns to the collection.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/02-a-record-address-opens-the-record.md
