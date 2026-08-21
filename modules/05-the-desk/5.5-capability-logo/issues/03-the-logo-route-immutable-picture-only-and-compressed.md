# The logo route: `image/svg+xml`, immutable, picture-only, and compressed

Status: ready-for-agent

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

- [ ] The route serves `image/svg+xml` with immutable caching and picture-only
      headers only for a matching active incarnation in `present` state
- [ ] Non-present, mismatched and missing-file responses are fail-closed and
      `no-store`; placeholder tiles do not request the route
- [ ] The response is gzipped and decompresses byte-identical to what is stored
      at the incarnation-root logo path outside `artifacts_path` — the manifest
      included
- [ ] Opening the address directly as a document renders a picture and executes
      nothing
- [ ] The route works unchanged as a CSS `background-image` on the desk
- [ ] The URL contains the incarnation; delete-and-recreate of the same semantic
      id receives a different URL and cannot reuse immutable cached bytes
- [ ] The route requires the id/incarnation pair to match one active row; an old
      incarnation URL never falls through to a recreated capability's file
- [ ] Serving holds and releases the exact incarnation's read token
- [ ] Deleting the capability removes the artwork and the route stops serving
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability's incarnation-keyed logo address directly and confirm a picture. Check the
response headers for the declared type, the immutable directive and the
compression. Delete the capability and confirm the address stops serving; rebuild
the same semantic id and confirm the new logo URL is different.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/02-one-generation-per-capability-stored-with-the-artifacts.md
