# Every writing route guards its own door

Status: ready-for-agent — the work below is complete and waiting on sign-off

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

- [x] The global body cap equals the configured per-file cap, 500 MB by default
- [x] Every writing route other than the upload route refuses a body over its own limit
      with a 413, whether the size is declared by `Content-Length` or found by counting a
      chunked body, before any Handler runs
- [x] A chunked body over 1 MB sent to the record router is refused (the gap this closes)
- [x] Record create, update and delete, rename, deletion confirmation, build cancel and
      the logo attempt refuse a cross-site request before reading the body, through the
      rule `/prompt` uses
- [x] A test enumerates every writing route and fails when one lacks the body limit or
      the cross-site refusal
- [x] Saving, editing and deleting a record, renaming, deleting a capability, cancelling a
      build and retrying a logo all still work from the desk
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Nothing new appears on the desk: both guards refuse requests the desk never sends, and a
browser cannot forge `Sec-Fetch-Site`, so the proof lives in the tests. The demo is that
nothing a person does changes. Start Aluna on `:3030`, save and edit a record, rename a
capability, cancel a build and retry a logo, and confirm each still works.

## Blocked by

None - can start immediately.

## What landed

One shared guard module, attached to each writing route's own registration, and a test
that walks Hono's route table so a route without it cannot ship.

- **`src/platform/files/file-cap.ts`** is the setting 7.1/07 reads: `OMNI_MAX_FILE_BYTES`,
  default 524,288,000 bytes (500 MiB). A value that is not a positive whole number throws
  naming the variable. It is a leaf.
- **The global cap is the file cap, exactly** (`src/server/serve-options.ts`, which also
  took the port and idle timeout out of `src/index.ts` so they can be tested). There is no
  floor: a cap configured below 1 MB also refuses saves, and that is the developer's
  choice (decided at review).
- **`src/server/http/writing-route-guard.ts`** holds the cross-site rule (moved from
  `isCrossSitePrompt`, which is gone) and two guards that apply it first, then a declared
  `Content-Length` over the limit (413, unread), then a count:
  - `guardWritingRoute(limit)` reads the body up to its limit and hands the route a
    rebuilt `Request` with the bytes, so a chunked body is refused before any Handler runs.
    Every route today uses it at `TEXT_BODY_LIMIT_BYTES` (1 MiB).
  - `guardStreamingRoute(limit)` is for 7.1/07: the route reads a lazily counted stream
    that raises `BodyTooLargeError` past the limit, and an escaped one is answered 413.
- **Guarded:** `/prompt` (its inline check is gone), build cancel, deletion confirmation,
  rename, the logo attempt (its `HX-Request` check stays as a second lock), and the record
  router's `/capability/:id/:action` for every method but GET and HEAD.
- **Hang-ups are not failures.** A client that leaves mid-body gets a quiet 400, and
  `app.onError` no longer logs an overflow or a socket error under a streamed body.
- **The static mounts and the capability-page recovery moved from `app.use` to
  `app.get`**, so the walk can count every other non-GET entry as a door. A POST to a
  static file now 404s instead of serving it. The security-headers middleware is the one
  declared exemption, through `passesThrough`.
- **`AppDeps.maxFileBytes`** (default `OMNI_MAX_FILE_BYTES`) is the seam the upload route's
  guard should read; the walk builds the app with a 16 KiB cap and pins streaming guards to
  it and buffered guards to 1 MiB.
- **README and `.env.example`** document the setting.

For 7.1/07 and 7.3/02: register the route with `guardStreamingRoute(ctx.maxFileBytes)` or
`guardWritingRoute(TEXT_BODY_LIMIT_BYTES)` before its handler, and
`src/server/app.writing-route-guards.test.ts` audits it with no list to edit. A streaming
route that catches `BodyTooLargeError` to clean up must answer 413 itself, and must read
through the body's reader or `for await`: `Bun.write` never settles on an erroring stream
(Bun 1.3.12).

## Findings from adversarial review, all fixed

Three adversarial passes (Opus) and one standards pass (Sonnet).

**Settled by the user at review**

- The global cap equals the file cap with no floor ("configuration is for devs").
- Text routes keep 1 MiB, although twelve fields of CJK text at the 10,000-character
  ceiling encode past it and the desk shows nothing on a 413.
- `Sec-Fetch-Site` only, with no `Origin` fallback for browsers older than Safari 16.4
  or Firefox 90.

**Fixed**

- The walk skipped a handler that declared `next` and middleware registered with `use`.
  It now counts every non-GET, non-HEAD entry, unwraps sub-app handlers, and exempts
  only a per-registration `passesThrough` on every method, pinned to `ALL /*` in the test.
- A buffering guard could not serve a 500 MB upload: added `guardStreamingRoute`, lazy so
  it pulls nothing the route did not ask for.
- The walk would have refused a correct upload route that rejects an unknown incarnation
  before streaming: past the limit a door must answer 413 or not have read past it, with
  the response drained before counting. `{regex}` params get a matching sample.
- Nothing pinned the 1 MiB text limit, and a streaming guard could dodge the pin: both
  kinds are pinned.
- The walk restated route paths: the list is gone, and so is the single-use
  `LOGO_ATTEMPT_ROUTE` constant.
- A mid-body hang-up logged a 500 on build cancel and the logo attempt, then on streamed
  routes: quiet 400 for both, and only errors raised by the socket read count as the
  sender's. The first version keyed on `AbortError` plus an aborted signal, which would
  have hidden the server's own aborts.
- PORT accepted `" "` (random port), `0x10`, `1e3` and `70000`: decimal digits up to 65535.
- Comments that overclaimed: the boot-order note in `src/index.ts`, "the sender is told to
  stop", the keep-alive cause in the socket test, "GET and HEAD write nothing", and the
  README saying the cap applies to every body (Bun ignores it for a chunked one).
- The rebuilt `Request` loses `server.requestIP` and `server.timeout`: stated in the
  guard's JSDoc.

## Verification

- `bun run typecheck` and `bun run lint` (comment budget and references included) clean.
- `bun run test`: 3145 passed, 0 failed, 2 shards, 78 s. New files:
  `writing-route-guard.test.ts` (20), `app.writing-route-guards.test.ts` (6),
  `router.writing-guard.test.ts` (3), `serve-options.test.ts` (3), `file-cap.test.ts` (3).
- Mutation-checked: removing the guard from rename or the record router, registering a
  static mount with `use`, raising a text route to 4 MiB, dropping `passesThrough`, and
  reverting to the eager counted stream each turn the walk red.
- Over a real socket, a chunked 1 MiB + 1 body to the record router is refused 413 (Bun
  alone let it through) and an honest save lands byte for byte.
- Live on `:3030`: a record saved, edited and deleted from the Coffee tasting window
  (22 tastings before and after), and a rename to "Coffee door check" and back. From the
  desk page, with the browser's own `Sec-Fetch-Site`: the logo attempt on a tile whose
  artwork is present answered 200 with no spend; deletion confirmation for a missing
  capability 200; build cancel for an unknown job 404; a 2 MB save 413; security headers
  on `/` and on the 413. Deleting a real capability, cancelling a real build and retrying
  a logo that has no artwork destroy data or spend credits, so they wait for sign-off.
