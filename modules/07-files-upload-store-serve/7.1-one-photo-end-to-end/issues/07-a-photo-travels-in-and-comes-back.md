# A photo travels in and comes back

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 1–4, 6–8, 11, 13–15, 23, 24, 26 and 27; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A photo is uploaded ahead of the save, one request per file, and streamed to disk. It is
admitted, recorded as `pending` in the ledger, and served back from `/files/:key`. This
issue builds the object store, the upload route and the serve route for images. 7.1/08
puts the control in front of them.

**The object store.** `put`, `get`, `delete` and `url` all stream. Keys are opaque UUIDs
under `storage/<key>` (`OBJECT_STORE_ROOT`), and uploads stage under
`storage/.incoming/`, which boot empties because nothing can be streaming then. The local
adapter uses `Bun.file` and `Bun.write`. The root is configurable, and the per-file cap
is 7.1/01's setting. A cloud adapter (R2, S3, Garage) can take the same interface later.
`url` always returns the same-origin `/files/<key>`, because the page's CSP and the HTML
filter refuse off-origin sources. `bun run reset` already empties `storage/`, including
`.incoming/`.

**The upload route.** Its path names the capability's incarnation and the field, the
way the logo route names its incarnation, because the generic router admits only M4
Actions. The route refuses a cross-site request and enforces the file cap through
7.1/01's guards. It reads the body before it waits for anything. Bun applies no
backpressure to an unread body: a 400 MB upload read after a five-second wait peaked at
648 MB. The filename arrives percent-encoded in a header. The server decodes it,
normalizes it to NFC, strips control and bidirectional-override characters, and caps it
at 255 bytes.

**Admission, image rows only.**

1. The extension, compared case-insensitively on the sanitized name, must be on the
   allowlist.
2. A declared type must not contradict the extension. Blank and
   `application/octet-stream` count as no claim. An alias table absorbs `image/jpg` and
   `charset` parameters.
3. The bytes decide, against our own signature table, read from the first 64 KB. A
   mismatch aborts the upload there.

The image rows cover the formats every major browser draws: at least JPEG, PNG, GIF,
WebP, and AVIF by its `avif` or `avis` brand. The issue records the exact extension list
it admits. A HEIC or HEIF major brand is refused whatever the extension. TIFF is refused,
and SVG is never admitted, because a file on our origin that can carry script is stored
cross-site scripting. The field's `accepts` is enforced. No library is used. The type
recorded is the verified one. 7.2 extends the same table.

**Bytes land in staging first, and the ledger row comes after admission.**

1. The upload streams into `storage/.incoming/<key>` with no ledger row.
2. It admits the file and fsyncs it.
3. One platform write, through the coordinator's `withPlatformWrite`, checks that the
   incarnation is still active and inserts the row as `pending`. It never writes raw on
   the shared connection, where it would join an open save's transaction and die with
   its rollback.
4. Only after that write commits does the route rename the file into `storage/<key>`,
   fsync the directory, and answer with the reference 7.1/04 defined.

A refusal, an abort or a disconnect deletes the staged file in `finally`. The route passes
its request's abort signal to its queued ledger write and checks it again after the
rename. A client that left before the answer never learns the key, so the route moves its
own row to `cleanup_enqueued` instead of answering nobody.

**No long lease, and a read token only while streaming.** An upload never writes
capability data, so it blocks no save and a running build refuses no upload. Its ledger
write queues behind a running build. The upload holds a read token on its incarnation
while it streams, and releases it before it queues for the ledger write, because the
coordinator forbids awaiting a queued acquisition inside a read-token scope.

**Serving.** `/files/:key` checks the key's shape, then looks it up in the ledger. An
unknown key is a 404 and never a filesystem probe. Only `pending` and `owned` keys serve;
`cleanup_enqueued` answers 404. Pending keys serve so that the form's preview uses the
same address as the saved record. Each serve takes a read token for the row's
incarnation and opens the file while holding it. Bytes that are already gone answer a
`no-store` 404. The route releases the token before the body streams.

Headers:

- The content type is the verified one, and every response carries
  `X-Content-Type-Options: nosniff`.
- An image carries `default-src 'none'; sandbox`, as the logo route does.
- A 200 carries `public, max-age=31536000, immutable`. Every other answer carries
  `no-store`.
- `Content-Disposition` is inline and writes
  `filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`, because Bun answers
  a raw `日本.jpg` in that header with a 500.

Range requests are 7.2/02's.

## Acceptance criteria

- [ ] The object store streams `put`, `get`, `delete` and `url` through a local adapter
      under a configurable root, and boot empties `storage/.incoming/`
- [ ] The upload route's path names the incarnation and the field, and it carries
      7.1/01's cross-site refusal and file cap
- [ ] A 400 MB upload streams without the process holding the body in memory; a test
      bounds peak memory well below the file size
- [ ] Filenames are decoded, NFC-normalized, stripped of control and bidirectional
      characters and capped at 255 bytes; `日本.jpg` round-trips
- [ ] Admission refuses a wrong extension, a contradicting declared type, bytes that do
      not match (aborting within the first 64 KB), a HEIC brand under `.jpg`, TIFF, SVG,
      and a family the field does not accept
- [ ] The ledger row is written only after the staged file is admitted and fsynced, in
      one platform write that refuses an inactive incarnation, and the rename follows its
      commit
- [ ] A refusal, an abort and a disconnect each leave nothing in `storage/.incoming/`
      and no row
- [ ] A client that disconnects after the row commits leaves its row `cleanup_enqueued`
- [ ] An upload is not refused while a build runs, and it holds no read token while it
      waits for its ledger write
- [ ] `/files/:key` serves `pending` and `owned` keys with the verified type, `nosniff`,
      the image policy, immutable caching and an RFC 6266/8187 disposition; an unknown,
      malformed or `cleanup_enqueued` key, or missing bytes, answers a `no-store` 404
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Photos from 7.1/06 exists but has no picker until 7.1/08, so this demo is
developer-facing. On the Aluna running on `:3030`, open Photos. From the browser console,
send a JPEG to the upload route with `XMLHttpRequest`, then open the returned `url` in a
new tab: the photo draws. Send a `.heic` renamed to `.jpg` and see the refusal. Look in
`storage/` for the new key and in the ledger for its `pending` row.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/01-every-writing-route-guards-its-own-door.md
- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/06-keep-track-of-my-photos-builds-photos.md
