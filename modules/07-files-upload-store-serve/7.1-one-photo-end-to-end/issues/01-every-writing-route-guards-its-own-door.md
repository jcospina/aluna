# Every writing route guards its own door

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 7, 9 and 10; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The server stops relying on one global body limit and one route's cross-site check.
Today `src/index.ts` caps every request at 1 MB through `maxRequestBodySize`, so a photo
gets a 413 before any route runs, and a chunked body already slips past that cap. Only
`/prompt` refuses a cross-site request. This issue moves both guards onto the routes, so
the upload route in 7.1/07 can take a 500 MB file without opening the rest of the
server to one.

**The global cap rises to the file cap.** The per-file cap is one configurable number,
500 MB by default, the same for every family. It lands here because the global cap is
set to it; 7.1/07's upload route reads the same setting.

**Every other route enforces its own limit.** A route checks the declared
`Content-Length` before it reads, and counts bytes while it streams, so a chunked body
over the limit is refused as well. The routes that take text keep the limit they
effectively have today: 1 MB clears every field at its 10,000-character ceiling. A
refusal is a 413 and happens before any Handler or generated code runs.

**Every writing route refuses a cross-site request before it reads the body,** using the
rule `/prompt` already applies (`isCrossSitePrompt`): anything but `same-origin`, `none`
or an absent `Sec-Fetch-Site` is refused. The routes that write without it today are
record create, update and delete through the generic router, rename, deletion
confirmation, build cancel and the logo attempt, which checks only `HX-Request`. The rule
is shared, not copied into each route. Without it, any page the person visits could
write into Aluna, and once 7.1/07 lands it could fill the disk with admitted files.

A test walks the app's writing routes and fails when one lacks either guard, so the
upload route (7.1/07) and the pending-only route (7.3/02) cannot ship without them.

## Acceptance criteria

- [ ] The global body cap equals the configured per-file cap, 500 MB by default
- [ ] Every writing route other than the upload route refuses a body over its own limit
      with a 413, whether the size is declared by `Content-Length` or found by counting a
      chunked body, before any Handler runs
- [ ] A chunked body over 1 MB sent to the record router is refused (the gap this closes)
- [ ] Record create, update and delete, rename, deletion confirmation, build cancel and
      the logo attempt refuse a cross-site request before reading the body, through the
      rule `/prompt` uses
- [ ] A test enumerates every writing route and fails when one lacks the body limit or
      the cross-site refusal
- [ ] Saving, editing and deleting a record, renaming, deleting a capability, cancelling a
      build and retrying a logo all still work from the desk
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Nothing new appears on the desk: both guards refuse requests the desk never sends, and a
browser cannot forge `Sec-Fetch-Site`, so the proof lives in the tests. The demo is that
nothing a person does changes. Start Aluna on `:3030`, save and edit a record, rename a
capability, cancel a build and retry a logo, and confirm each still works.

## Blocked by

None - can start immediately.
