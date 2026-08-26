# The logo route: `image/svg+xml`, immutable, picture-only, and compressed

Status: done

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decisions 34, 35, 36; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

Each capability incarnation serves its logo from
`/capability/:id/:incarnation_id/logo.svg`. The incarnation is load-bearing: a
deleted semantic id may later be rebuilt with a different picture, so an id-only
URL cannot be marked immutable without letting the browser reuse the deleted
incarnation's bytes. The desk receives the exact URL from platform rendering and
uses it unchanged as its CSS `background-image`.

The immutable response exists only when registry state is `present`. Platform
tile rendering emits the URL only in that state; `absent`, `generating` and
`abandoned` render the placeholder without probing the route. A direct request
for any non-present state, mismatched incarnation or missing file fails closed
with `Cache-Control: no-store`, never the immutable policy — otherwise one early
404 could outlive the artwork that later arrives.

- **Declared `image/svg+xml` and marked `immutable`.** The exact URL binds both
  semantic id and incarnation, and L7 says those bytes are never remade.
- **The response is picture-only, and the stored bytes are never touched.**
  Headers make the file render as an image and stay inert if its address is
  opened directly as a document. This honours L8 literally: everything the shell
  adds sits outside the file. It is cheap insurance rather than an urgent hole —
  the exposure requires the vendor's output itself to carry a program, and all
  four shipped specimens carry zero scripts, zero event handlers and no
  `javascript:` anywhere.
- **The C2PA manifest is kept and the response is compressed.** Measured across
  the four specimens the manifest is a flat 4,354 bytes and is not the bulk; the
  largest specimen is 220 vector paths and 111 kB. Gzip recovers 60–70% against
  4.4 kB for stripping, and it changes nothing on disk.
- The route admits a read token for the exact incarnation and releases it in
  `finally`, so deletion cannot race an in-flight file serve. Deleting the
  capability removes the artwork with the incarnation artifact tree.

## Acceptance criteria

- [x] The route serves `image/svg+xml` with immutable caching and picture-only
      headers only for a matching active incarnation in `present` state
- [x] Non-present, mismatched and missing-file responses are fail-closed and
      `no-store`; placeholder tiles do not request the route
- [x] The response is gzipped and decompresses byte-identical to what is stored
      at the incarnation-root logo path outside `artifacts_path` — the manifest
      included
- [x] Opening the address directly as a document renders a picture and executes
      nothing
- [x] The route works unchanged as a CSS `background-image` on the desk
- [x] The URL contains the incarnation; delete-and-recreate of the same semantic
      id receives a different URL and cannot reuse immutable cached bytes
- [x] The route requires the id/incarnation pair to match one active row; an old
      incarnation URL never falls through to a recreated capability's file
- [x] Serving holds and releases the exact incarnation's read token
- [x] Deleting the capability removes the artwork and the route stops serving
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability's incarnation-keyed logo address directly and confirm a picture. Check the
response headers for the declared type, the immutable directive and the
compression. Delete the capability and confirm the address stops serving; rebuild
the same semantic id and confirm the new logo URL is different.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/02-one-generation-per-capability-stored-with-the-artifacts.md

## Notes

### What was already there, and what this added

5.5/02 built most of this route to make its own demo possible — it could not show a
placeholder becoming artwork without serving bytes. So the type, `nosniff`, `inline`,
the CSP sandbox, the `present` gate and the read token were already in place, and the
route's own header said so. What 03 added:

- **The immutable directive.** `public, max-age=31536000, immutable`. A year is the
  longest age HTTP defines as meaningful and `immutable` additionally suppresses
  revalidation on reload. Both are safe only because of L7 plus the incarnation in the
  path: the bytes are never remade, and the one event that changes a capability's picture
  — delete, then rebuild — mints a new incarnation and therefore an address that shares
  no cache entry with the old one.
- **A negotiated gzip response.** `Bun.gzipSync` on the way out, `Vary: accept-encoding`,
  and nothing at all on disk. Measured live: 29,795 → 11,579 bytes, decompressing
  byte-identical to the stored file with its C2PA manifest intact.
- **`no-store` where the route had been serving it unconditionally.** 02 answered
  `no-store` even when `present`, which it called a deliberate placeholder. That is now
  the answer only for the states that must not be cached.

### Why `acceptsGzip` is a parser rather than a substring check

`gzip;q=0` is the explicit way to say *not* gzip and reads as an acceptance to anything
looking for the four letters, so the weight is parsed. An unparseable weight is `NaN`,
every comparison against it is false, and the client gets the stored bytes — the safe
answer to a header nobody can read. Naming gzip also settles the question whichever order
the entries arrive in (RFC 9110 §12.5.3): a client that names it only to refuse it is not
talked round by a later `*`. A 17-case table pins all of it.

### Adversarial findings, and what they changed

Two reviewers ran before this was called done. Three findings were real.

**A zero-byte logo failed open into a year-long cache.** `readCapabilityLogo` returns a
`Uint8Array`, and an empty one is *truthy*, so a truncated `logo.svg` under a `present`
row sailed straight past the guard written to catch exactly this and was served `200` with
the immutable directive. A browser would then hold a blank tile for a year that not even
an explicit reload could clear. The guard is `!stored || stored.byteLength === 0` now.
Not reachable through the happy path — the provider rejects empty bytes and requires an
`<svg` root — but reachable by out-of-band truncation, which is precisely the damage
5.5/04's recovery sweep exists to reconcile.

**Two acceptance checkboxes were ticked by tests that could not fail.** The
`generating`/`abandoned` cases built their rows with `install(notesRow({ logo: {...} }))`,
and `insertCapability`'s `WRITE_COLUMNS` does not include the logo lifecycle — so both
rows landed at the schema default `absent/0` and were duplicates of the `absent` test
above them. Worse, every "nothing to serve" case also had no file on disk, so deleting the
registry-state gate entirely left the whole suite green. Both states are now reached
through the registry's own writers *with a readable drawing at the served path*:
`generating` by claiming and installing without settling — what a claim whose process died
between install and finalize leaves behind — and `abandoned` by the `present → abandoned`
reconciliation the ADR allows. Verified to bite: replacing the status gate with a null
check fails both.

**`Vary` on the uncompressed variant was unasserted.** Dropping it from the identity
branch survived the entire suite. It is the variant a shared cache would store under a
bare URL key for a year and then hand to a client that cannot decode gzip. Asserted now,
on both branches.

Smaller ones:

- **`HEAD` answered `Content-Encoding: gzip` with `Content-Length: 0`** while the `GET`
  said 11,579 — RFC 9110 §9.3.2 requires the two to match. Hono's `c.body()` has no body
  to measure on a HEAD, so the length is stated explicitly rather than inferred. Verified
  live: HEAD and GET now agree on both variants.
- **No test asserted that an `absent` tile omits the artwork URL.** The arming tests only
  checked what the tile *does* contain, so a regression adding a `background-image` to the
  placeholder branch would have passed. `fragments.test.ts` asserts the absence now.
- **`capabilityLogoExists` lost its last production caller** when the route switched to
  `readCapabilityLogo`, leaving a test asserting a function nothing ships. Deleted.
- **The catalog projection was duplicated.** `attempt.ts` already named it; it is exported
  as `readActiveIncarnationCatalog` and both callers use it.
- **The ADR's own prose disagreed with its own table.** It claimed gzip recovers "60–70%"
  while its table shows reading-journal at 24 kB → 11 kB, which is 54%. Measured across
  all four specimens the real range is 54–71%, and the ADR now says so.

### Three findings about the route's surroundings, also fixed

These sat just outside the route and were argued out of scope once. They are not: an
immutable response is only as strong as the page that names its address and the answers
that surround it.

- **The desk page carried no cache policy at all.** The incarnation makes the *URL*
  honest, but the desk HTML is what *names* it. A stale copy of that page — a back
  navigation, a future CDN — goes on asking for a deleted lifetime's address, and the
  browser answers out of the year-long entry that address was granted, never touching the
  server. That is the one way decision 34's guarantee falls over without the route being
  wrong. `GET /` is `no-store` now, which is what every other route in the app already
  said.
- **Nothing answered when no route did.** Hono's built-in 404 and 500 carry no directive,
  and a bare 404 is heuristically cacheable under RFC 9111 §4.2.2 — so a mistyped or
  half-built address could be remembered as missing. `app.notFound` and `app.onError` now
  answer `no-store`, and the error path logs rather than swallowing.
- **Every logo request rebuilt the resolver's whole catalog.** The read gate is acquired
  against a catalog, and the route was handing it `readActiveRegistryCatalog` — which
  re-parses every registry row through zod and then SHA-256s a canonicalized view of all
  of them. A gate validates membership and one-incarnation-per-id; it never reads a spec.
  A cold desk paint issues one request per tile, so the cost was quadratic in capabilities.
  `listActiveIncarnations` is a two-column query, and both the route and the paid attempt
  use it: **1.571 ms → 0.016 ms per call at three capabilities, ~100×**, and near-flat as
  the desk grows where the old path grew with total spec size.

**Compression cost was measured and is not a defect.** Eight concurrent 111 kB logos take
23.7 ms with gzip against 6.1 ms without, and `Bun.gzipSync` is synchronous, so a `GET /`
issued alongside that burst waits ~22 ms. `immutable` means a client pays it once per
incarnation, and the catalog fix above removes far more per-request work than gzip adds.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1564 passed, 0 failed, ~71 s across two shards on a quiet machine. Typecheck and lint clean.

Coverage added, in `src/capability-logo/routes.test.ts` unless noted:

- The immutable directive, and the picture-only headers pinned to their exact values.
- A real 111 kB specimen compresses, carries `content-encoding`, `vary` and a
  `content-length` matching the wire, and gunzips byte-identical to both the specimen and
  the file at the incarnation root — `c2pa` included.
- A 17-case `accept-encoding` table, including `gzip;q=0`, `gzip;q=abc`, `x-gzip`, `*;q=0`
  and the wildcard-ordering pair.
- The identity variant: no `content-encoding`, still immutable, still `vary`, correct
  length, exact bytes.
- Fail-closed: absent, `generating`-with-bytes, `abandoned`-with-bytes, missing file,
  truncated-to-empty file, mismatched incarnation — all `no-store`, none immutable.
- The read token: a closed gate serves nothing, and three exits (compressed, uncompressed,
  missing file) leave `readerCount: 0` and a `closeAndDrain` that does not hang.
- Deletion carries the artwork away and the address stops serving; a rebuilt semantic id
  gets a different address, the dead one never falls through, and the desk names only the
  new one.
- The desk page that names the address is `no-store`, and an address that is no route at
  all is `no-store` too.
- `src/capability-logo/storage.test.ts` — `readCapabilityLogo` returns the exact bytes,
  and `null` rather than a throw for a missing file or a directory.
- `src/web/fragments.test.ts` — an `absent` tile, armed or inert, never emits the artwork
  URL.

Mutation-checked: removing the status gate, the empty-file guard, `Vary`, the token
acquisition, the release-in-`finally`, the desk's `no-store` or the `notFound` handler each
fails at least one test.

## HITL test instructions

The desk is already carrying three real logos, so no build is required.

1. Start the dev server if it is not running:

   ```
   bun run dev
   ```

2. Open <http://localhost:3030/> — the capability tiles paint their artwork through this
   route as CSS `background-image`.

3. Open one logo address directly in a browser tab, e.g.
   `http://localhost:3030/capability/hypomnemata/1592b021-0384-4e11-a1d8-b53724693ccc/logo.svg`
   (any tile's address works; the desk HTML carries them). It renders a picture and runs
   nothing.

4. Check the headers and the compression:

   ```
   curl -sI -H 'Accept-Encoding: gzip' http://localhost:3030/capability/hypomnemata/1592b021-0384-4e11-a1d8-b53724693ccc/logo.svg
   ```

   Expect `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=31536000,
   immutable`, `Content-Encoding: gzip`, `Vary: accept-encoding`, and a `Content-Length`
   well under the file's size on disk.

5. Ask for a lifetime that does not exist and confirm it fails closed — a 404 with
   `Cache-Control: no-store` and never the immutable directive:

   ```
   curl -sI http://localhost:3030/capability/hypomnemata/00000000-0000-4000-8000-000000000000/logo.svg
   ```

6. Optional, destructive: delete a capability from its tile's context menu and confirm its
   logo address now answers 404 `no-store`. Rebuild the same thing from the prompt bar and
   confirm the new tile's address carries a different incarnation — that is what stops the
   browser reusing the deleted lifetime's cached picture.
