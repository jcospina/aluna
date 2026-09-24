# A photo travels in and comes back

Status: done

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

- [x] The object store streams `put`, `get`, `delete` and `url` through a local adapter
      under a configurable root, and boot empties `storage/.incoming/`
- [x] The upload route's path names the incarnation and the field, and it carries
      7.1/01's cross-site refusal and file cap
- [x] A 400 MB upload streams without the process holding the body in memory; a test
      bounds peak memory well below the file size
- [x] Filenames are decoded, NFC-normalized, stripped of control and bidirectional
      characters and capped at 255 bytes; `日本.jpg` round-trips
- [x] Admission refuses a wrong extension, a contradicting declared type, bytes that do
      not match (aborting within the first 64 KB), a HEIC brand under `.jpg`, TIFF, SVG,
      and a family the field does not accept
- [x] The ledger row is written only after the staged file is admitted and fsynced, in
      one platform write that refuses an inactive incarnation, and the rename follows its
      commit
- [x] A refusal, an abort and a disconnect each leave nothing in `storage/.incoming/`
      and no row
- [x] A client that disconnects after the row commits leaves its row `cleanup_enqueued`
- [x] An upload is not refused while a build runs, and it holds no read token while it
      waits for its ledger write
- [x] `/files/:key` serves `pending` and `owned` keys with the verified type, `nosniff`,
      the image policy, immutable caching and an RFC 6266/8187 disposition; an unknown,
      malformed or `cleanup_enqueued` key, or missing bytes, answers a `no-store` 404
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Photos from 7.1/06 exists but has no picker until 7.1/08, so this demo is
developer-facing. On the Aluna running on `:3030`, open Photos. From the browser console,
send a JPEG to the upload route with `XMLHttpRequest`, then open the returned `url` in a
new tab: the photo draws. Send a `.heic` renamed to `.jpg` and see the refusal. Look in
`storage/` for the new key and in the ledger for its `pending` row.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/01-every-writing-route-guards-its-own-door.md
- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/06-keep-track-of-my-photos-builds-photos.md

## What landed

**The object store.** `src/platform/files/object-store.ts` holds the S3-shaped interface and its
local adapter. `put` streams a body into `<root>/.incoming/<key>` through a `Bun.file` sink on a
descriptor the store opened itself, then fsyncs it. `StagedObject.place` renames it into
`<root>/<key>` and fsyncs the directory, and answers `false` when a cleanup took the staged bytes
first. `get` opens its own descriptor with `O_NOFOLLOW | O_NONBLOCK`, so a planted link, pipe or
socket answers as gone, and the body closes that descriptor however it ends. `delete` unlinks the
staged copy first. `url` is always `/files/<key>`. `clearStaging` empties `.incoming/`, and boot
calls it before the server listens. The root is `OMNI_OBJECT_STORE_ROOT`
(`src/platform/files/object-store-root.ts`), `storage` when unset, and `bun run reset` now clears
only the store's own entries under it: `.incoming/` and key-named files.

Two mechanisms differ from this issue's text. Uploads are not written with `Bun.write`, which
cannot fsync and never settles on an erroring stream (7.1/01's finding). Serving does not hand out
`Bun.file(path)`, which opens only as the response is sent, after the read token is back. Bun
1.3.12's `FileHandle.close` also resolves without closing a descriptor a read is still using, so
the store closes only once the read in flight settles. ARCH, `docs/modules.md`, `storage/README.md`
and the PLAN's 7.1 bullet and decision 23 now say so.

**The upload route.** `POST /capability/:id/:incarnation_id/upload/:field`
(`src/server/files/upload-route.ts`, built by `fileUploadPath`) carries
`guardStreamingRoute(maxFileBytes)`. The body is the file, and `X-File-Name` carries its name
percent-encoded. Before a byte is read, the path must name the active incarnation and an active file
field (404 otherwise), the header must be printable ASCII whose escapes are UTF-8 (400), and the
first two admission stages must pass (415). The route then takes a read token and streams the body
through the signature check into staging. The token goes back the moment the last byte is read and
admitted, before the fsync. One `withPlatformWrite`, handed the request's abort signal, re-reads
the registry in a transaction and inserts the row as `pending` only while the incarnation is active
and the field still takes the file. The rename follows its commit, and a client that left by then
has its row moved to `cleanup_enqueued`. The answer is 201 `{ key, url, name, kind, mime, size }`.

The route's own refusals are JSON `{ refusal, message }`: 415 with the admission stage and the
field's sentence, 413 `too_large` when it counted the body past the cap, and 409 `gone` when the
staged bytes were taken before the rename. A hang-up answers an empty 400 and is not logged. A
declared length over the cap never reaches the route, because Bun refuses it first with an empty
413; 7.1/08's note says what the control does about that.

**Admission** (`src/platform/files/admission.ts`). The extensions it admits are `jpg`, `jpeg`,
`jfif`, `pjpeg`, `pjp`, `png`, `gif`, `webp` and `avif`, compared lowercase on the decoded name
before the length cap. Blank and `application/octet-stream` are no claim; `image/jpg`,
`image/pjpeg` and `image/x-png` are aliases, and every parameter is dropped. The signature rows are
JPEG's `FF D8 FF`, PNG's eight-byte signature, `GIF87a` and `GIF89a`, `RIFF` then `WEBP`, and an
`ftyp` box whose major brand is `avif` or `avis`. The check decides after 12 bytes and never holds
more than 64 KB. The extension names the family and the bytes may pick any row of it, so a PNG
called `.jpg` is recorded as `image/png`. A HEIC or HEIF major brand (`heic`, `heix`, `mif1`,
`msf1`, even with `avif` among the compatible brands), TIFF and SVG match no row.

**Filenames** (`src/platform/files/file-name.ts`). `decodeFileName` decodes, strips C0, DEL and C1
controls, the bidirectional marks, embeddings, overrides and isolates, the line and paragraph
separators, the zero-width space, the word joiner and the byte-order mark, keeps what follows the
last slash, and normalizes to NFC. It strips before it normalizes, because a control between a
letter and its accent would otherwise leave the name outside NFC. The zero-width joiners stay:
emoji and scripts need them. `capFileName` caps at 255 bytes, cuts between graphemes and keeps an
extension of up to 16 bytes. `inlineContentDisposition` writes the RFC 6266 and 8187 header.

**Serving** (`src/server/files/serve-route.ts`). `/files/:key` checks the key's shape, then the
ledger, and serves only a `pending` or `owned` row whose kind and type admission could have
recorded. It takes a read token for the row's incarnation, opens the file under it and gives the
token back before the body streams. Bytes that are gone, or no longer the size admission recorded,
answer the `no-store` 404. A 200 carries the verified type, `nosniff`, `default-src 'none';
sandbox`, a year of `immutable` caching and the disposition. Bun sends a stream body chunked, so
only a HEAD states `Content-Length`. Bun drops a response whose client has gone without cancelling
its body, so the route closes the file on the request's abort itself.

**Around them.** `readActiveIncarnationCatalog` moved from the logo module to
`src/registry/store/store.ts`, and the logo route and both file routes take their tokens against
it. The refusal sentences live in `src/platform/files/refusal-copy.ts`, which the router's file
refusal now reads too, with straight apostrophes like the rest of the product's copy. The ledger
gained `insertPendingFile` and `enqueuePendingFile`. 7.1/08, 7.2/02 and 7.3/04 each carry a note on
what this issue landed for them.

## Findings from adversarial review, all fixed

Three adversarial reviews (the upload path; serving, the store and admission; the spec and the
house standards), then a verification pass over the fixes. Each fix that changes behaviour has a
test that fails with the fix reverted, checked by reverting it.

- A client that left before the serve route answered leaked the file's descriptor for the life of
  the process, because Bun drops that response without cancelling its body (HIGH). The route closes
  the file when the client has already gone and on any later abort. Twenty such clients leave no
  file open.
- Bun 1.3.12's `FileHandle.close` during a read resolves but leaves the descriptor open, which a
  client hanging up mid-download hit (found in testing). The store closes once the read in flight
  settles.
- A real failure after the client left was answered as a hang-up and never logged (LOW). Only the
  abort itself, a cancelled place in the write queue and a socket error count as a hang-up now.
- A row with a malformed type made the 200 throw with the file open, and one with `text/html` or
  `image/svg+xml` was served as that type (LOW, INFO). The route serves only a kind and type
  admission could have recorded, and builds its headers before it opens anything.
- A file truncated at rest was served as a complete 200 cached for a year (LOW). A size that no
  longer matches the row answers the 404. A file that shrinks during the download is out of reach:
  Bun ends an errored body cleanly on the wire (INFO, from the verification pass). `readBody` and
  7.2/02's note say so, and a wire test is the canary for a Bun that changes.
- A GET's `Content-Length` never reached the wire (LOW). Only the HEAD states one, and a wire test
  checks the GET.
- A name sent as raw bytes rather than escapes was stored garbled (LOW). The header must be
  printable ASCII.
- The 255-byte cap could turn a name ending `.jpgZZZ…` into one ending `.jpg` (INFO). Admission
  reads the extension before the cap.
- Line separators, zero-width spaces and the byte-order mark survived, and `../../etc/passwd.jpg`
  was kept whole (INFO). They are stripped, and only what follows the last slash is kept. A name
  joined across a stripped NUL is admitted by its bytes alone, which a test pins.
- A planted link was followed, a pipe hung the open under a read token, and a socket answered 500
  (INFO, the socket from the verification pass). The store opens with `O_NOFOLLOW | O_NONBLOCK`
  and answers anything but a regular file as gone.
- A failed staging open removed another upload's file at that path (INFO). `put` removes only what
  it created.
- The read token was held across the fsync (INFO). It goes back when the body is read.
- The over-cap refusal cannot reach a browser, because Bun refuses a declared length first (LOW). A
  test on a server set up as production is pins the empty 413, and 7.1/08's note has the control
  check the size before it sends.
- The root had no setting, though the PLAN promises one (MEDIUM). `OMNI_OBJECT_STORE_ROOT` sets it,
  and reset clears only the store's entries under it.
- `promote` collided with the ledger's pending-to-owned promotion (MEDIUM). It is `place` now.
- Neither fsync, boot's staging clear, the in-transaction field check, the route's `accepts` check
  nor the `gone` branch had a test (MEDIUM). Each has one; the fsyncs are observed through a spy on
  `FileHandle.prototype.sync`, and boot's order is read from `src/index.ts`.
- Comments claimed more than the code did: that boot's staging held no ledger rows, that nothing
  before the body was awaited, that the check held only its head, and that the token covered the
  lookup (LOW). Each says what the code does now.
- The catalog helper was duplicated, two route constants were exported for nobody, the sentence
  table needed an alias to stay exhaustive, the ledger's new writers had no unit tests, and test
  support restated the fixture's id (LOW). All fixed.
- Six docs still named `Bun.file` and `Bun.write` as the adapter or described reset's old sweep
  (MEDIUM, INFO). ARCH, `docs/modules.md`, `storage/README.md` and the PLAN are current.
- An AVIF whose major brand is `mif1`, with `avif` among its compatible brands, is refused (INFO).
  That follows PLAN decision 3, which refuses a HEIF major brand whatever the extension, and a test
  pins it.
- A JPEG signature ahead of a script is admitted (INFO): containers are checked and codecs are not
  (decision 3). A test pins that it serves as `image/jpeg` under `nosniff` and the sandbox policy.

## Verification

- `bun run test`: 3469 passed, 0 failed. `bun run typecheck` and `bun run lint` (comment budget
  and references included) clean.
- The 400 MB upload over a real socket peaks about 50 MB above its baseline; the test bounds it at
  100 MB.
- Live on `:3030`, against the Personal photos capability: a canvas-drawn JPEG named
  `日本 harbour.jpg` sent with `XMLHttpRequest` answered 201. Its `url` drew the photo in a tab of
  its own, with `image/jpeg`, `nosniff`, `default-src 'none'; sandbox`, `immutable` and
  `filename*=UTF-8''%E6%97%A5%E6%9C%AC%20harbour.jpg`. `storage/` held the key and `.incoming/`
  was empty, and the ledger held its `pending` row. HEIC bytes named `IMG_0042.jpg` answered 415
  `signature` with the photo sentence. An unknown key answered a `no-store` 404.
