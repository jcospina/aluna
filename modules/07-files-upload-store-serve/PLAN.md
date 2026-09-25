# Module 7 — Files: Upload, Store & Serve — Plan

Status: decisions locked in the grilling session of 2026-09-22; ADR-0009 and the doc
amendments landed the same day. An adversarial review that afternoon found that the first
draft broke every edit of a record holding a file, let a crash or an open transaction lose
an upload, and kept serving a deleted capability's files. Its findings and the eight
decisions they forced are folded in below, and a second review of the result settled the
order an upload writes its bytes and its row (decision 13). Converting to issues.

This refines [docs/modules.md](../../docs/modules.md) §Module 7 with the decisions that
module ownership left open, and it does not leave that section's text intact: two things
`docs/modules.md` and [docs/architecture.md](../../docs/architecture.md) asserted about
files are changed here on purpose — the generated Handler calling `files.put(...)`, and
the upload riding the save as multipart through the router. The goal and the exit bar are
unchanged: a capability holds files end to end through platform tooling, with recoverable
ownership. Terms follow [CONTEXT.md](../../CONTEXT.md): *file admission*, *file
reference*, *pending upload*, *file ledger*, *desk-load sweep*, *capability incarnation*,
*owned-resource manifest*, *drawn line*, *product voice*. Decision record:
[ADR-0009](../../docs/adr/0009-files-platform-admission-and-the-file-ledger.md). The plan
reuses [ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
(supplied adapters, Gate isolation), [ADR-0005](../../docs/adr/0005-opinionated-capability-ui-design-contract-and-gate.md)
(the centralized field renderer and the closed item vocabulary) and
[ADR-0006](../../docs/adr/0006-capability-evolution-versioning-and-diff-contract.md)
(additive evolution, per-incarnation read tokens, the owned-resource manifest and its
cleanup adapters).

**Modules 1–6 are edited only to carry the renumbering.** Their issues and plans are
otherwise history. Every change this module makes to a shipped surface is recorded here,
in ADR-0009, and in the architecture and design documents.

## Amendments this plan required — landed 2026-09-22

1. **`architecture.md` §7, "Files — a platform tool, same split."** "The generated
   Handler calls `files.put(...)`" becomes: the platform admits, stores and owns; the
   Handler passes back the projection it was given, and the mutation interface accepts
   only a key this incarnation and field may hold. "Uploads arrive through the generic
   router (`/capability/:id/create`, multipart)" becomes: a file travels ahead of the save,
   one request per file, streamed into staging and recorded once admitted. The
   serve bullet hands generated code a `url` instead of a key and takes a read token. The
   lifecycle bullet gains the file ledger, the leave warning and the desk-load sweep. A new
   bullet says M7 never reads a file's contents, and points at Module 9.
2. **`architecture.md` §6.3, "Object Store", and `storage/README.md`.** Both name the
   file ledger as the one place ownership is asserted, and the store gains its
   `.incoming/` staging folder. §6.3's lifecycle recovery gains the upload-and-save
   ordering, and §7's merge-patch rule gains the file field's written-value rule.
3. **`docs/modules.md` §Module 7.** Five layer-shaped epics become four vertical ones,
   7.1 being a photo end to end. The verify script drops multipart-in-the-save and gains
   the leave warning, the crash sweep and the second tab.
4. **The renumbering.** File content understanding takes the Module 8 slot; the implicit
   loop becomes Module 9 and the experiment harness Module 10. Epic numbers and
   cross-references are carried across in `docs/modules.md`, `docs/architecture.md`, the
   ADRs, every closed module plan and issue, code comments, and the placement note in
   `design/index.html`, so a module number names one module everywhere. *Amended
   2026-09-23: composition then took Module 8, so file content understanding is Module
   9, the implicit loop Module 10 and the experiment harness Module 11, carried across
   the same places.*
5. **`CONTEXT.md`.** Four entries added: *file admission*, *file reference*, *pending
   upload*, *file ledger*. *Desk-load sweep* widens from logos to pending uploads, and the
   leave-run warning under *put away* widens to a form holding an upload.
6. **Module 5's leave question.** 5.6/03 scoped the question to a running build or
   evolution and let half-typed forms die with the window, with no dirty-form tracker.
   That still holds for everything a person typed. A form holding an upload is the one
   addition, because losing it costs a transfer the person has to repeat (decision 32).

## Decisions

### What a file may be

1. **A closed allowlist, limited to what a browser can show.** Images, video and audio;
   PDF, DOC, DOCX, Markdown and plain text. SVG and HTML are never admitted, because a file
   served from our own origin that can carry script is stored cross-site scripting, and
   `/files/:key` is our origin. HEIC, HEIF and TIFF are refused too: Chrome and Firefox
   cannot draw them, and no derivative will convert them (decision 28). The picker's
   `accept` list leaves out `image/heic`, so an iPhone converts to JPEG as it uploads. The
   7.2 issue enumerates every extension.
2. **Admission is a three-stage pipeline, and stage two checks coherence rather than
   confirmation.** The extension must be on the allowlist, compared case-insensitively on
   the sanitized name (decision 6). A declared type must not contradict it. Blank and
   `application/octet-stream` are no claim rather than a contradiction, because operating
   systems routinely send nothing for `.md`, and for `.docx` on a machine without Office;
   an alias table absorbs `image/jpg`, `audio/x-m4a`, `audio/x-wav` and `charset`
   parameters. The bytes then decide, against our own signature table, which *is* the
   allowlist. No library: the table and the allowlist are the same closed set, and
   `file-type` would still leave the text cases to us.
3. **The signature table checks containers, and says where that stops.**
   - The signature is read from the first 64 KB, and a mismatch aborts the upload there.
     An MP3 skips its ID3v2 tag, whose length sits in its ten-byte header, and looks for a
     frame sync in the 64 KB after it, because embedded cover art makes that tag larger
     than 64 KB.
   - An `ftyp` box confirms ISO-BMFF and the extension names the family, as with WebM and
     Ogg, because many `.m4a` files carry the same `isom` or `mp42` brand as a video. A
     HEIC or HEIF major brand is refused whatever the extension, and AVIF is admitted by
     its `avif` or `avis` brand. A `.mov` may carry no `ftyp` and is recognized by its
     first atom.
   - WebM and Ogg hold audio or video alike; the extension names the family and the
     container confirms it.
   - DOCX is a zip whose `[Content_Types].xml` declares the WordprocessingML main document.
     The central directory sits at the end of the file and the entry is deflated, so this
     check runs after the write and inflates under a size cap. DOCM, DOTX and XLSX fail it.
     A password-protected `.docx` is an OLE2 file rather than a zip, and its refusal says
     so.
   - DOC is OLE2, which XLS, PPT and MSG share, so the check confirms the family and not
     the application. A DOC downloads, so a spreadsheet saved as `.doc` harms nothing.
   - Markdown and plain text are UTF-8 with or without a BOM, UTF-16 with a BOM, or 8-bit
     text with no zero bytes, such as the Windows-1252 Excel writes for Spanish text. The
     check streams over the whole file and records the encoding it found for Module 9.
   - Containers are checked and codecs are not. A video whose codec the browser refuses
     shows the platform control's download link where the player would be.
4. **The recorded type is the verified one.** Everything downstream — the card, the
   player, the disposition header — trusts the reference, so the reference may not carry a
   claim we never checked.
5. **A field narrows what it takes, from four families:** `image`, `video`, `audio`,
   `document`. The AI declares them per field as `accepts`; the platform enforces them at
   admission. A Photos field that accepted a DOCX would produce a card its item renderer
   was never written for. `accepts` is required-nullable in the provider schema, non-null
   only on a file field, never empty, and stored in canonical order so reordering it is no
   change. Widening it is ordinary evolution and regenerates the item renderer when the
   field is on the card. Narrowing is refused, like removing a choice option, because
   stored files would fall outside it; the rule sits in candidate validation beside
   `choiceOptionIssues`.
6. **A filename is data, carried and served safely.** The upload sends it
   percent-encoded, because a raw-body request has no other channel and a header value
   cannot carry a character beyond Latin-1, such as the ones in `日本.jpg`. The server
   decodes it, normalizes it to NFC (macOS sends NFD), strips control and
   bidirectional-override characters, and caps it at 255 bytes. Serving writes
   `filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>` (RFC 6266 and
   RFC 8187), because Bun answers a raw `日本.pdf` in that header with a 500.
7. **500 MB per file, configurable.** One number for every family. A `file[]` also caps
   how many files it holds.

### How a file travels

8. **Ahead of the save, one request per file, streamed.** Measured on Bun 1.3.12 outside
   the app: a 512 MB upload peaks at 62 MB RSS when `request.body` is streamed to a
   `FileSink`, and 700 MB through `request.formData()`. Streaming needs no parser
   dependency, because each file has its own request body. The route reads the body before
   it waits for anything: Bun applies no backpressure to an unread body, and a 400 MB
   upload read after a five-second wait peaked at 648 MB. The browser sends it with
   `XMLHttpRequest`, whose `upload.onprogress` drives the progress line; `fetch` with a
   `File` body reports no progress.
9. **The server's body cap moves to the routes.** `src/index.ts` caps every request at
   1 MB, so today a photo gets a 413 before any route runs, and a chunked body already
   slips past the cap. The global cap rises to the file cap. Every other route enforces its
   own limit by `Content-Length` and by counting streamed bytes, which closes the chunked
   gap for the whole server.
10. **Every writing route refuses a cross-site request** from `Sec-Fetch-Site` before
    reading the body, as `/prompt` already does. Without it, any page the person visits
    could fill the disk with admitted text files through the upload route. The new upload
    and pending-delete routes carry it from the start, and the routes that write without
    it today — records, rename, deletion confirmation, build cancel and the logo attempt —
    gain it.
11. **The upload route names the incarnation and the field in its path,** as the logo
    route does, because the generic router admits only M4 Actions.
12. **The platform admits and stores; generated code never touches bytes.** This follows
    the choice-field precedent — the platform refuses an undeclared submission before
    generated code runs — and it makes durable pending ownership structural instead of
    something a generated Handler must remember to do.
13. **Bytes land in staging first, and the ledger row is written once they are
    admitted.** The upload streams into `storage/.incoming/<key>` at once, holding no row,
    then admits the file and fsyncs it. One platform write checks that the incarnation is
    still active and inserts the row as `pending`. Only after that commits does the upload
    rename the file into `storage/<key>`, fsync the directory, and answer with its
    reference. A refusal, an abort or a disconnect deletes the staged file in `finally`,
    and boot empties `storage/.incoming/`, because nothing can be streaming then. The
    route passes its request's abort signal to its queued ledger write and checks it again
    after the rename: a client that left before the answer — a reload, a confirmed leave —
    never learns the key, so the route moves its own row to `cleanup_enqueued` instead of
    answering nobody. Only an answer already written and never read is left to the next
    desk-load sweep. A crash
    after the row commits leaves a `pending` row whose bytes never moved, and the desk-load
    sweep takes it like any other (decision 32). Every cleanup of a key unlinks
    `storage/.incoming/<key>` before `storage/<key>`, so a rename racing a cleanup either
    finds its source gone or lands where the second unlink removes it. The ledger never
    holds a row for bytes still streaming, so the sweep cannot race one. It can take a row
    whose upload has not yet answered, and a rename that then finds its source gone answers
    with the sentence the second tab's save gets, asking for the file again. A cloud
    adapter stages locally the same way and uploads at the rename step, so no multipart
    upload outlives its request. That upload is not atomic and unlinking its source does
    not stop it, so once it completes the adapter reads the row again and deletes the
    object itself when the row is gone or no longer `pending`.
14. **An upload takes no long lease.** It never writes capability data, so a 400 MB video
    blocks no save and a running build refuses no upload. Its one ledger write is a short
    platform write through the mutation coordinator. The save route holds a transaction
    open on the shared connection across its Handler, and a ledger row written on that
    connection outside the coordinator joins the transaction and dies with its rollback. A
    platform write queues behind a running build, which only a second tab can meet. By then
    the upload has read its whole body, so it waits without holding memory, and it holds no
    read token while it waits, because the coordinator forbids awaiting a queued
    acquisition inside a read-token scope.
15. **An upload holds a read token on its incarnation while it streams,** and releases it
    before it queues for its ledger write. Deletion's drain cancels a streaming upload,
    which deletes its staged file and has no row to touch. The ledger write checks in its
    own transaction that the incarnation is still active, so an upload that finished
    streaming as a deletion began is refused and deletes its staged file. A row that
    committed just before a deletion is a pending key like any other, and the files
    adapter collects it (decision 33).
16. **The save carries file references, and the router checks them before generated code
    runs.** `assertSubmittedFieldValues` gains the file rule: a file field takes a pending
    reference minted for this incarnation and field, or the key this record's field holds
    now, which means keep it. A `file[]` is an ordered list with no key twice. Anything
    else is refused with a typed code and a platform sentence, as an undeclared choice is.
    A key the desk-load sweep took asks for the file again; a kept key the record no longer
    holds says the record changed in another window; a record that no longer exists
    answers as record-not-found before either. The check runs again inside the save's
    transaction, before the Handler, so a sweep or another save committing in between
    cannot slip past it, and the mutation interface checks once more. Only an explicit
    clear from the platform control empties a field.
17. **Generated code gets the projection both ways, and cannot change a file.** Every
    record generated code receives carries each file as `{ url, name, kind, mime, size }`:
    the router's input, what `mutation.create` and `mutation.update` return,
    `query.records()` rows, and what the item renderer is handed through
    `projectItemRecord`. The Handler passes the same projection back, or leaves the field
    out, and either way the router-checked submission is what gets written, on create and
    on update alike. The interface reads the key out of the `url` it minted and rebuilds the
    stored value from the ledger, so a copied or edited projection still saves and cannot
    change a name or a type. Any other value — a `null` the control never asked for, a
    `file[]` with a file dropped, added or reordered — is refused before anything is
    written, so a slip in generated code never destroys a file. `kind` is the family from
    decision 5, so a template branches on one closed token. An empty field is `null`, or
    `[]` for `file[]`. Generated code never needs the key and never composes an address; it
    can still see one, because the key is inside the `url` and a Handler's raw SQL read
    returns the stored column.
18. **`file[]` is a file type, not a list type.** Joining `LIST_FIELD_TYPES` would make it
    searchable, demand a list-input mode, comma-split its values, and let an empty
    submission clear it. It gets its own `FILE_FIELD_TYPES`, and every caller of
    `isListFieldType` is audited.
19. **Replacing a file in the form discards the one it displaced.** A displaced pending
    file goes through the pending-only route at once (decision 32), having never been
    committed. A displaced owned file is enqueued for cleanup only when the save commits,
    and the save works out what it displaced inside its own transaction, from the stored
    value and the value it wrote.
    Dropping a file while another is still uploading aborts that request, and the server
    deletes the staged file. The form cannot be saved while any upload is in flight.
    Deleting a record discards any upload its open form held, as a confirmed leave does.

### Where the truth lives

20. **The reference sits in the capability's own column** as
    `{key, kind, mime, size, name}`, JSON in TEXT, the shape `string[]` already uses.
    `file[]` holds an array. Rendering joins nothing, and the question loop groups by
    `kind` without mapping types in SQL.
21. **The file ledger is the only place ownership is asserted.** One row per admitted key
    holds the capability, the incarnation, the field, the record (empty until the save),
    the state (`pending`, `owned`, `cleanup_enqueued`), the verified kind, type, size and
    name, the text encoding when there is one, when the row was made, and a cleanup attempt
    count with its last error. The column's value is built from this row at the save, so
    nothing the browser posts reaches it. The record column turns record deletion into one
    indexed update, inactive fields included, and the incarnation column answers "every key
    this incarnation owns" for M4's pre-drop collector in one query. A row is deleted once
    its bytes are gone.
22. **Both are SQLite, so promote-and-insert is one transaction.** The save promotes the
    key, fills in the record and writes the column together. Only the platform writes
    either side.

### Serving

23. **`/files/:key` is platform-owned and reads through a read token.** The key is an
    unguessable UUID, checked for shape and then against the ledger; an unknown key is a 404
    and never a filesystem probe. Only `pending` and `owned` keys serve, and
    `cleanup_enqueued` answers 404. Each serve takes a read token for the row's incarnation,
    as ARCH §8 and ADR-0006 require of every file serve, so a deleted capability's files
    stop serving even while their byte cleanup is still retrying. The route opens the file
    while it holds the token — bytes already gone answer the `no-store` 404 — and releases
    the token before the body streams, so a long video never holds a deletion's drain; an
    open file keeps streaming after its unlink. Because Bun 1.3.12 opens a `Bun.file(path)`
    body only at send time, the store opens its own descriptor, and 7.1/07 proves that
    open-then-stream path against an unlink; the Range issue reads its ranges from it. The original filename
    lives in the reference, not the URL. The `url` is always this same-origin route: a
    cloud adapter is proxied through it, Range included, because the page's CSP and the HTML
    filter refuse off-origin sources.
24. **Pending keys serve too,** so the preview in an open form is the same `<img src>` as
    after the save, and it proves the round trip instead of showing a local copy.
25. **Range requests from the start, built by hand.** `<video>` cannot seek without them
    and Safari will not play at all, and Bun 1.3.12 answers every Range request on a
    `Bun.file` response with a 200 and the whole body. The route sends
    `Accept-Ranges: bytes`. A single, open-ended or suffix range gets a 206 with
    `Content-Range`; that header's end is inclusive and `Bun.file().slice()`'s is
    exclusive. An unsatisfiable range gets a 416 with `bytes */size`, a multi-range falls
    back to a 200, `If-Range` is checked against a strong ETag that can be the key itself,
    and `HEAD` gets the same headers.
26. **Immutable caching for bytes, never for an absence.** A key is random and its bytes
    never change, so a 200 or 206 carries `public, max-age=31536000, immutable`, as the
    logo route's present picture does. Every other answer — a 404, a 416, a refusal while
    the incarnation closes — carries `no-store`, as the logo route's absence does. A
    browser that cached a file keeps its copy after the file is deleted.
27. **Media and PDF open inline; everything else downloads** under its original name.
    Every response carries `X-Content-Type-Options: nosniff`. Images, video and audio
    carry their own `default-src 'none'; sandbox` policy, as the logo route does. A PDF
    carries a policy of its own, because the app-wide `object-src 'none'` is reported to
    blank Chrome's PDF viewer. 7.2 proves, through the app's full header middleware, that a
    PDF opens in Chrome, Safari and Firefox and that video and audio play when opened in a
    tab of their own. A link that opens a file carries `rel="noopener"`.
28. **No derivatives.** No thumbnails, no video posters. The platform HTML filter puts
    `loading="lazy"` and `decoding="async"` on a file's image and `preload="metadata"` on
    a player, and strips `autoplay`, so no generated template can forget them. Without a
    poster, a browser may draw no first frame — iOS Safari is expected not to — so a video
    card is designed not to depend on one, and 7.2 checks it on iOS Safari. Every derived
    file would be another owned key with its own cleanup path, and ownership is the part
    that must be right first.
29. **The card shows a file; the record plays it.** A card is a `<button>`, and the item
    vocabulary bans `controls`, `<a>` and `href`. Inside the open record's form, the platform
    file control previews video and audio with play, pause and the time, and nothing more;
    the full player, which seeks, belongs to a render view of the record, a surface the
    record does not have yet (settled while 7.1/02 drew the control, 2026-09-23). A document
    opens or downloads from the file control.

### Lifecycle

30. **Cleanup is idempotent and an already-absent key is success**, matching every other
    adapter behind the owned-resource manifest. It unlinks both paths a key can occupy, in
    the order decision 13 gives.
31. **The ledger is the queue.** A row moves to `cleanup_enqueued` inside the transaction
    that displaces it, and the worker wakes only after that transaction commits, so a
    Handler that updates and then fails leaves the old file untouched. The worker drains on
    the bounded backoff `DeletionCleanupSupervisor` already uses — 1s, 5s, 30s — and then
    the next desk load forces a retry, as it does for a stuck capability deletion. Boot
    drains whatever is enqueued. The supervisor keeps its retry state on registry
    tombstones, so the worker borrows its timing and keeps its own state in the ledger. It
    also differs in one place: it deletes bytes outside any lease, and takes a short
    platform write only to delete a row or record a failure, because a lease held across
    an unlink — or a network delete once the store is S3 — stalls every save and upload.
32. **A pending upload is discharged without a timer.**
    - *The leave warning.* Leaving a record whose form holds an upload, pending or still
      streaming, asks first, through the same inline question that guards a running
      build, on every in-desk exit: putting the window away, pressing another logo, Back
      and Forward, a prompt that takes the window, Delete from the logo menu, the form's
      own close — the create panel's included — and opening another record. A confirmed
      leave aborts in-flight uploads and hands the held keys to the pending-only route,
      which moves each key still `pending` to `cleanup_enqueued` in one platform write and
      leaves the bytes to the worker. A key the sweep, a save or a deletion already took
      counts as success, and no byte is unlinked before that write commits, so a leave
      confirmed while a save is in flight can never leave a saved record without its
      file. A form with nothing uploaded still dies silently, as Module 5 decided. There is
      no `beforeunload` dialog: iOS Safari ignores it, the request sent after one is
      unreliable, and a killed tab, a dead battery or a restarted server sends nothing at
      all.
    - *The desk-load sweep.* A reload destroys an open form, so every `pending` key
      standing when the desk loads is taken as an orphan and enqueued for cleanup. The
      sweep is queued on the coordinator when the load request arrives, and the render
      does not wait for it. The queue's order is the cutoff: a sweep waiting behind a
      build never takes an upload recorded after the load.
    - *A second tab.* Its open form loses its upload to another tab's desk load. Its save
      then names a key that is no longer pending and is refused before generated code runs,
      with a platform sentence asking the person to add the file again. The sweep and the
      save both go through the coordinator, so exactly one of them wins.

    No TTL, no interval, no cron.
33. **Capability deletion extends M4.** A files adapter registered against
    `OwnedResourceCleanupAdapter` collects every ledger key for the incarnation — owned in
    an active field, owned in an inactive one, pending and already enqueued — before the
    table drops, and cleans each one as decision 30 does. M4's acceptance fake at
    `src/lifecycle/deletion/destruction/seam-fakes/owned-resources.test-support.ts` models
    the same sets, calls owned `committed`, and tracks each record id. A staged upload
    holds no row; deletion's drain cancels it, and it deletes its own bytes. The incarnation's
    ledger rows are retired inside the tombstone transaction by platform SQL beside
    `purgeInstalledCapabilityPayloads`, not by an adapter callback, for the reason
    `installed-payloads.ts` gives; the manifest keeps the duty to delete the bytes. M4
    cleans a tombstone inline under the deletion lease and retries it under a platform
    write, so the adapter's unlinks hold saves and uploads while they run, against
    decision 31's rule for the worker. That is acceptable for the local store, and a cloud
    adapter batches its deletes. No second deletion path.
34. **Hiding a file field keeps its bytes.** Evolution never destroys; those keys are
    absorbed at capability deletion. A form still holding a pending key for a field that
    evolution just hid is refused with a sentence rather than a wire error.
35. **`file` ↔ `file[]` is a type change and is refused.** The existing rule that a
    committed field's type never changes already refuses it; this module adds the test.

### Reading and asking

36. **A file field is not searchable.** Its only text is a filename, often
    `IMG_4821.JPG`, and a match the card cannot show is worse than no match. A capability
    that wants searchable photos gets a title field. The smoke rung's non-text exclusions
    gain a file case, so the Gate enforces this.
37. **The question loop may count, group and filter file columns, and never sees a key.**
    The catalog describes a file column and its `kind`. Rows are scrubbed before the model
    reads them: a file reference loses its key, and any value that is or contains a ledger
    key or a `/files/` path is replaced. The answer window stays text.
    *Amended 2026-09-25 (7.1/09):* the scrub is the second layer. A statement can
    disguise any value it reads, so the question's worker reads every table through
    views that show a file column without its key and withhold text holding a key or
    an address before any statement sees it (ADR-0008, ADR-0009).

### The Gate

38. **Scratch references, no bytes.** The Gate mints references in its scratch
    database's own ledger: a field with a file, a field with none, a `file[]` with several,
    and a `file[]` an evolution added and left `NULL` in older rows, which the projection
    turns into `[]`. Their names carry markup, emoji and 255 bytes, but no
    bidirectional override, which admission strips (decision 6). Admission, storage and serving are platform code with their own tests, exactly
    as routing is. The empty field is the case a generated template most often forgets.
39. **Behavioral tests name files by token.** A behavioral input is a plain string today,
    and the model cannot mint a pending reference. A file input becomes a closed token —
    the family, or `null` for none, and for `file[]` an array of families — in a
    required-nullable shape rather than a
    `discriminatedUnion`, whose `oneOf` OpenAI's strict mode rejects. The harness turns
    tokens into scratch references, rows compare by `kind` and `name` and never by key,
    and the behavioral input digest covers the new shape.

## Epics

Vertical: 7.1 is a photo end to end, and each epic after it widens or hardens something
already running. Issue numbering starts at `01` inside each epic.

### 7.1 — One photo, end to end

The tracer bullet, through every layer a photo touches.

- **Store and ledger:** the object store (streaming `put / get / delete / url`, opaque
  UUID keys under `storage/<key>`, staging under `storage/.incoming/` emptied at boot, a
  local adapter writing through a `Bun.file` sink (`Bun.write` cannot fsync, and never
  settles on an erroring stream) and serving from a descriptor it opens, config for the
  root and the 500 MB per-file cap, swappable to R2/S3/Garage behind the same-origin
  route); the file ledger
  with its three states and its columns, in `bun run reset`'s platform tables (reset
  clears the store's own entries under its configured root, `.incoming/` included).
- **Travel:** the per-route body limits and the cross-site refusal across the server; the
  upload route with admission limited to image signatures, filename handling, the
  stage-then-record ordering, its platform write and its read token; a refusal that
  reaches the form mid-stream, proven in the browser.
- **Serving:** `/files/:key` with read tokens, served states, the verified type, `nosniff`,
  the media policy, immutable caching and `filename*`.
- **The save:** the `file` type in the spec with `accepts` limited to `image`, the DDL
  mapping and the wire protocol; the router's file rule with keep, checked again inside
  the transaction; the projection both ways and the written-value rule; promote-on-commit;
  replacement and clearing on update; record deletion enqueueing its keys.
- **The builder:** spec and candidate generation offer `file` for photos, candidate
  validation and the Diff Engine gain their `file` cases, and the `photo_grid_tile`
  few-shot example becomes a real file field instead of an `image_url` string, so
  `.media-frame` backs a real field type; the Gate's scratch references and behavioral
  tokens for images; the smoke rung's file exclusion; the HTML filter's image attributes.
- **Asking:** the question loop's key scrubbing, so a Photos capability's keys never reach
  the model.
- **The control:** the platform upload control's empty, filled and progress states for an
  image, and its preview; the save held while an upload is in flight, and a replacement
  that aborts the upload it displaced. A finished upload the form displaced or abandoned
  stays `pending` until the pending-only route arrives in 7.3.

Done when "keep track of my photos" typed into the prompt bar builds a capability with a
`file` field, a photo uploads with a visible progress line, the card shows it, editing the
title keeps it, replacing it enqueues the old key, and the ledger says `owned`.

Until 7.3, nothing drains the queue: an enqueued key keeps its bytes, and deleting a
capability leaves its ledger rows and files behind. `bun run reset` clears both, which is
enough for a tracer bullet.

### 7.2 — Every kind, and many

`file[]` as a file type; `accepts` opened to all four families, each enforced at
admission, and its append-only rule in candidate validation; admission widened from image
signatures to the full table, with every extension enumerated; the `file[]` count cap;
Range requests; inline versus
download, with the PDF and the standalone players proven in Chrome, Safari and Firefox and
the video card on iOS Safari; the platform control playing,
seeking, opening and downloading, and falling back to a download link for a codec the
browser refuses; the picker's `accept` attribute from the declared families; item-renderer
guidance and a few-shot example for each kind.

Done when a Notes capability holds a PDF that opens in the browser, a DOCX that downloads
under its own accented name, and a video that plays and seeks.

### 7.3 — Ownership holds

The cleanup worker, its backoff, its post-commit wake and its boot drain; the leave warning
on every in-desk exit and the pending-only route it and a replacement use, in a client
module of its own
because `app.js` and `desk-window.js` are at their line ceilings; a deleted record
discarding its form's upload; the desk-load sweep with its queue-order cutoff and the
second tab's refusal; the files adapter in M4's pre-drop collector and the ledger rows
retired in the tombstone transaction; an upload meeting a deletion; the fault battery — a
post-commit failure, a process killed mid-stream and between its row and its rename, a
process killed mid-form, a deletion racing an upload, a cleanup racing a rename, and a
second tab.

Done when the verify script's recovery half passes: every abandoned, replaced and orphaned
byte is gone, and every committed byte is still there.

### 7.4 — The builder knows about files

Few-shot variety across kinds and layouts; evolution that adds, widens and hides file
fields, with a widened `accepts` regenerating the renderer and `file` ↔ `file[]` refused;
the question loop's catalog guidance for counting, grouping and filtering by `kind`.

Done when a capability built from a cold prompt chooses a file field, declares sensible
families and renders all four kinds without a Gate rejection, and evolving Notes to add a
`file[]` keeps every existing record.

## Design work this module owes

`design/controls.html` carries the note that a file field "is the one absence left, and it
is not a gap." Module 7 removes that note and draws the control: the empty state, the
filled state for each kind, the progress line, the `file[]` list, a refusal in the field,
the open and download links inside the record, the full player in the record's render view
(decision 29), and the leave question for a held upload. Shape follows the existing field structure and the drawn line. `design/` is
the product requirement, so the image states land with or before 7.1's control, and the
rest with or before the epic that builds them.

## Left for Module 9

Reading what a document says: extraction per kind, chunking, the embedding provider and
what leaves the machine, the vector store, retrieval as a second read tool beside
`data_query`, and the derived-vector lifecycle the ledger already knows how to own. The
encoding recorded at admission is where reading plain text starts.
