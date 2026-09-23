# 0009 — Files: the platform admits and stores, the ledger owns

Status: accepted

Seeds Module 7 (`modules/07-files-upload-store-serve/PLAN.md`). It settles who
touches bytes, when a file travels, and where ownership is asserted. It amends
ARCH §7 "Files", which said the generated Handler calls `files.put(...)` and that
uploads ride the save as multipart through the router, and `docs/modules.md`
§Module 7, whose epics are re-sliced vertically to match.

## Decision

**The platform admits, stores and owns every file. Generated code never touches
bytes, and never composes an address for them.**

**A file travels ahead of the save, one request per file, streamed.** The browser
holds a `File` as a disk-backed handle and the server streams the request body
straight into staging the moment the request arrives, so memory is flat at any
size: measured on this repo's Bun (1.3.12) outside the app, a 512 MB upload peaks
at **62 MB** RSS streamed against **700 MB** through `request.formData()`. Reading
at once matters, because Bun applies no backpressure to an unread body. The file
is admitted in staging, its ledger row is written as `pending`, and only then is it
renamed into place; boot empties staging, so a crash mid-stream leaves no bytes
that nothing names, and a crash after the row leaves a row to sweep. The save that
follows carries references, not bytes. Uploading ahead of the save is also what
lets a refusal reach the person while the form is still open, rather than after
they commit to it.

**Admission is a coherence check, not a confirmation.** The extension must be on
the closed allowlist, which holds only what a browser can show, so HEIC, HEIF and
TIFF are refused beside SVG and HTML. A declared type must not contradict the
extension, where a blank or generic declaration is no claim rather than a
contradiction. The file's own bytes must confirm the family, against a signature
table that *is* the allowlist: container signatures and `ftyp` brands, a zip peek
for DOCX, and a text test that takes UTF-8, UTF-16 with a BOM, or 8-bit text with
no zero bytes. The type recorded is the verified one, never the claimed one.
Per-field families (`image`, `video`, `audio`, `document`) are AI-authored and
platform-enforced, so a Photos field cannot take a PDF; widening them is an
ordinary evolution and narrowing is refused, exactly as with a choice field's
values.

**The file ledger is the only place ownership is asserted**: one row per admitted
key naming the incarnation, the field, the record once a save claims it, the
verified kind, type, size and name, and whether the key is pending, owned or
awaiting cleanup. A capability's own column holds the reference a record shows —
`{key, kind, mime, size, name}`, the same JSON-in-TEXT shape `string[]` already
uses — but never the claim to it, and the save builds that value from the ledger
rather than from anything the browser posted. Both live in the same SQLite
database, so promoting a pending key and writing the record row happen in one
transaction, and only the platform ever writes either.

**Generated code sees `{ url, name, kind, mime, size }` and hands the same
projection back when it saves.** It never needs the key. It cannot invent an
address or claim another record's file: the router checks every submitted file
before generated code runs and again inside the save's transaction, and the
mutation interface checks once more, reading the key from the `url` it minted and
accepting only a pending reference minted for that incarnation and field, or the
key that record's field holds now. **Generated code cannot change a file either.**
Whether the Handler passes the projection back or leaves the field out, the
router-checked submission is what gets written; any other value, such as a `null`
the platform control never asked for or a `file[]` with a file dropped, is
refused. Only the control's explicit clear empties a file field.

## Considered options

**The Handler calls `files.put`,** as ARCH originally said. Rejected: it puts
byte-handling in AI-authored code, makes the durable pending record depend on
generated code calling it at the right moment, and turns "this key belongs to this
record" into something the Gate must prove about every generated Handler instead
of a platform invariant. It matches neither the choice-field precedent (the
platform refuses an undeclared submission before generated code runs) nor the
routing precedent (the AI never builds routing).

**One streaming multipart save,** with parser (`@mjackson/multipart-parser` or our
own). Rejected: it needs a parser dependency, it is all-or-nothing across fifty
files, and it cannot tell anyone a file is unacceptable until they press save.

**tus resumable uploads.** Rejected for now: real resume is worth having one day,
but it brings a protocol and two packages shaped around Node's HTTP objects, and
the two-phase endpoint can grow into it.

**Ownership inferred from the capability tables alone.** Rejected: a pending
upload exists before any row does, so it would have nowhere to live, and finding
orphans would mean crawling every file column of every incarnation.

**A sealed projection recognized by identity.** Rejected: the ownership check
already stops a Handler claiming a key it may not hold, so a sealed object would
add nothing but a refusal for a Handler that copied the projection.

## Consequences

**Uploading ahead of the save creates an abandoned pending upload** — bytes with
no record, when someone picks a file and never saves. Two paths discharge it and
neither is a timer. Leaving a record whose form holds an upload asks first, on
every in-desk exit, through the inline question that already guards a running
build, and a confirmed leave deletes the held files; a form with nothing uploaded
still dies silently, and there is no `beforeunload` dialog. Anything a crash, a
kill or a closed tab left behind is swept at the next desk load, since a reload
destroys an open form, so every `pending` key standing at that moment is treated
as an orphan. A second tab's open form loses its upload to that sweep, and its
save is refused with a sentence asking for the file again. Staging holds no rows,
so the sweep never races an upload that is still streaming.

**Uploads take no long lease.** An upload writes only the store and the ledger,
never capability data, so a 400 MB video blocks no save and no running build
refuses one. Its one ledger write is a short platform write through the mutation
coordinator, because a row written on the shared connection outside it would join
an open save transaction and vanish with its rollback. It holds a read token on
its incarnation while it streams, so a capability deletion cancels it instead of
racing it, and releases the token before it queues for that write, which checks
that the incarnation is still active. The save still takes the lease, and the
promote happens inside its transaction.

**The server's body cap moves to the routes.** The 1 MB cap `src/index.ts` sets
on every request rises to the file cap, and every other route enforces its own
limit by `Content-Length` and by counting streamed bytes. Every writing route,
uploads included, refuses a cross-site request before reading the body.

**Capability deletion extends M4 rather than adding a path.** A files adapter
registered against `OwnedResourceCleanupAdapter` returns every ledger key for the
incarnation — owned in an active field, owned in an inactive one (a hidden file
field), pending, and already-enqueued — which is what M4's acceptance fake at
`src/lifecycle/deletion/destruction/seam-fakes/owned-resources.test-support.ts`
already models. The incarnation's ledger rows are retired inside the tombstone
transaction by platform SQL, and the manifest keeps the duty to delete the bytes,
unlinking the staging path before the final one.

**`/files/:key` is platform-owned and reads through a read token**: an
unguessable UUID checked against the ledger, served only while `pending` or
`owned`, and refused once its incarnation starts closing, as ARCH §8 requires of
every file serve; the token covers the lookup, not the stream. Range requests are
built by hand, because Bun serves a `Bun.file` whole whatever the request asks.
The verified type goes out with `nosniff` and a per-family policy, immutable
caching for a 200 or 206 because a key's bytes never change, and `no-store` for
every other answer. Media and PDF open inline, the PDF proven in Chrome, Safari
and Firefox; everything else downloads under its original name, encoded per RFC
6266 and RFC 8187. Pending keys serve too, so the
preview in an open form is the same `<img src>` as after the save.

**The Gate needs no bytes.** It mints scratch references — a field with a file, a
field with none, a `file[]` with several — because generated code only ever sees
the projection, and behavioral tests name files by a closed family token rather
than by a reference the model cannot mint. Admission, storage and serving are
platform code with their own tests, exactly as routing is.

**The question loop never sees a key.** It may count, group and filter file
columns by `kind`, and the platform scrubs keys and `/files/` paths from every
row before the model reads it.

**No derivatives in Module 7.** No thumbnails and no video posters: originals are
served as they are, and the platform's HTML filter marks the markup that shows
them `loading="lazy"` or `preload="metadata"` itself. Derived files would be owned keys with their own lifecycle,
which is the part that most needs to be right the first time. Reading the
*contents* of a document is Module 9's business, not this one's.
