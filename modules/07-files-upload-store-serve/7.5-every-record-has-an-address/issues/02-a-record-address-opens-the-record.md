# A record address opens the record

Status: ready-for-agent

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
capability opens the capability's collection, speaks `NOT_FOUND_NOTICE` on the prompt bar,
answers 404, and corrects the address to `/capability/:id`. A capability without `update`
opens its collection with no notice.

## Acceptance criteria

- [ ] `GET /capability/:id/:record` answers the record view fragment under `HX-Request`
      and the whole desk without it; the five Action routes behave exactly as before
- [ ] The fragment equals what a card press renders for the same record, and carries no
      inactive field, no `extra` and no file key
- [ ] Reload, a pasted address and a new tab all show the record in the window
- [ ] Deleted, unknown, malformed and other-capability record ids open the collection
      with the notice and a 404; an unknown capability still gives the bare desk
- [ ] A capability being deleted answers 409 here, as its collection does
- [ ] `desk-window-address.test.ts`'s pin that a deeper path is not an address is
      rewritten to the new shapes, not deleted
- [ ] An adversarial pass on route collisions, id spelling, injection through the
      segment and a record read across capabilities is clean
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, open a capability, press a card, and copy its id from the developer panel (or
the item's `data-item`). Then load `/capability/<id>/<record>` in a new tab: the window
opens on that record's form. Change one character of the id and reload: the collection
opens and the prompt bar says it can’t find that one.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/01-the-record-address-is-decided-and-drawn.md
