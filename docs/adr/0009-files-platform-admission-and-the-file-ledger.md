# 0009 — Files: the platform admits and stores, the ledger owns

Status: Accepted

## Context

A record can hold photos, video, voice notes and documents, and a model writes the
Handlers that save it ([Files](../architecture.md#411-files)). A file can run to hundreds
of megabytes, and nothing about it may depend on generated code getting it right. Three
questions follow: who touches the bytes, when a file travels from the browser to the
server, and where the claim that a file belongs to a record is kept.

## Decision

### The platform owns every file

The platform admits, stores and owns every file. Generated code never touches bytes, and
never composes an address for them. A Handler that stored files would put byte handling
in AI-authored code, make the durable pending record depend on that code calling the store
at the right moment, and leave the Gate to prove of every Handler that each key belongs to
its record. Kept in the platform, key ownership is an invariant, as a choice field's
declared values are (the platform refuses an undeclared one before generated code runs)
and as routing is (the model never builds it).

### Upload and admission

A file travels ahead of the save, one request per file, streamed. The browser holds a
`File` as a disk-backed handle, and the server streams the request body into staging as
soon as the request arrives, so memory stays flat at any size, where `request.formData()`
would hold the whole file in memory. The route reads the body at once because Bun applies
no backpressure to an unread one. Admission checks the file in staging, the platform writes
its ledger row as `pending`, and only then renames the file into place. Boot empties
staging, so a crash mid-stream leaves no unnamed bytes, and a crash after the row leaves a
row for the sweep. The save that follows carries references, not bytes. Because the file
arrives first, a refusal reaches the person while the form is still open.

Admission is a coherence check. It checks that a file's name, declared type and bytes
agree, and it checks containers, not codecs. The extension must be on a closed allowlist:
images, video and audio the major browsers can show or play, and PDF, Word, Markdown and
plain-text documents. HEIC, HEIF and TIFF are refused because most browsers cannot show
them, and SVG and HTML are refused too. A declared type must not contradict the extension,
and a blank or generic declaration makes no claim. The bytes must confirm the family
against a signature table that is the allowlist. The platform records the verified type
and never the claimed one, so a PNG named `.jpg` is stored as the PNG it is.

Each file field lists the families it accepts (`image`, `video`, `audio`, `document`). The
model writes that list and the platform enforces it, so a Photos field cannot take a PDF.
An evolution may widen a field's families and may not narrow them, because the files the
field holds are of the families it took, as a choice field's options may be added and
never removed.

### The file ledger and what generated code sees

The file ledger is the only place ownership is asserted. It holds one row per admitted
key, naming the incarnation, the field, the record once a save claims it, the verified
kind, type, size and name, and whether the key is pending, owned or awaiting cleanup. A
capability's own column holds the reference a record shows, `{key, kind, mime, size,
name}`, but never the claim to it. The save builds that value from the ledger and from
nothing the browser posted. The ledger and the capability tables share one SQLite
database, so promoting a pending key and writing the record row happen in one transaction,
and only the platform writes either.

Generated code sees `{ url, name, kind, mime, size }` and hands the same projection back
when it saves. It never needs the key, and it cannot invent an address or claim another
record's file. The router checks every submitted file before generated code runs and again
inside the save's transaction, because a sweep or another save can commit in between. The
mutation interface checks once more: it reads the key from the `url` it minted, and accepts
only a pending reference minted for that incarnation and field, or the key that record's
field holds now.

Generated code cannot change a file either. Whether the Handler passes the projection
back or leaves the field out, the save writes the router-checked submission, and it refuses
any other value, such as a `null` the platform control never asked for or a `file[]` with a
file dropped. Only the control's explicit clear empties a file field. A `file[]` loses a
file only where the control names it as removed, so an edit never removes a file another
window added after its form was drawn.

## Considered options

**One streaming multipart save.** It needs a multipart parser, it is all-or-nothing
across every file in the save, and it cannot tell anyone a file is unacceptable until they
press save.

**tus resumable uploads.** tus brings a protocol and two packages shaped around Node's
HTTP objects, and one request per file already lets a refusal reach the person before the
save.

**Ownership inferred from the capability tables alone.** A pending upload exists before
any record row does, so it would have nowhere to live, and finding orphans would mean
crawling every file column of every incarnation.

**A sealed projection recognized by identity.** The ownership check already stops a
Handler claiming a key it may not hold, so a sealed object would add nothing but a refusal
for a Handler that copied the projection.

## Consequences

**Uploading ahead of the save leaves abandoned pending uploads** when someone picks a file
and never saves. Three paths discharge them, and none is a timer. A form hands each key it
lets go unsaved to the pending-only route at once: a file a later pick replaced, one the
person cleared or dropped from a list, or one held by a form whose window or record left
the desk. A save whose Handler never stored a key it carried gives that key up in its own
transaction. The desk-load sweep takes the rest.

Leaving a record whose form has unsaved changes, an upload among them, asks first on every
exit inside the desk, through the question that guards a running build, and a confirmed
leave deletes the held files. A form nobody changed closes without asking. The one thing
the page asks the browser to guard before unloading is a voice recording not yet uploaded,
which exists only in the tab.

A reload destroys any open form, so the desk-load sweep treats every key still `pending`
when the desk loads as an orphan, and so takes whatever a crash, a kill or a closed tab
left behind. A second tab's open form loses its upload to that sweep, and its save is
refused with a sentence asking for the file again. Staging holds no rows, so the sweep
never races an upload still streaming. An upload whose row the sweep takes before its
rename answers with the same sentence and keeps no bytes, or with a 404 if its field or
capability has gone since.

**Uploads take no long lease.** An upload writes only the store and the ledger, never
capability data, so a 400 MB video blocks no save. A running build refuses none either,
though the upload's one ledger write waits until the build ends. That write is a short
platform write through the mutation coordinator, because a row written on the shared
connection outside it would join an open save transaction and vanish with its rollback.
The upload holds a read token on its incarnation while it streams, so a capability deletion
cancels it instead of racing it. It gives the token back before it queues for that write,
which checks that the incarnation is still active.

**Each writing route sets its own body limit.** The server's body cap is the file cap.
Every writing route, uploads included, refuses a cross-site request and then enforces its
own limit before it reads the body, by `Content-Length` and by counting the bytes that
stream, because Bun does not apply its cap to a chunked body.

**Deleting a capability takes every file it held.** The owned-resource manifest collects
every ledger key of the incarnation through a files adapter, in any state and any field,
hidden fields included. Platform SQL deletes the incarnation's ledger rows inside the
tombstone transaction, and the manifest keeps the duty to delete the bytes, the staging
path before the final one.

**`/files/:key` is platform-owned and reads through a read token.** The key is an
unguessable UUID checked against the ledger, served only while `pending` or `owned`, and
refused once its incarnation starts closing. The token covers the open, not the stream.
A load that would run a file as code is refused, and so is a page's own fetch for anything
but a player loading audio or video: htmx swaps any successful answer into the page, so a
Handler's `hx-get` could otherwise insert a disguised file's markup. The verified type goes
out with `nosniff` and a Content Security Policy per family. A 200 or 206 is cached as
immutable, because a key's bytes never change, and every other answer is `no-store`.
Images, video, audio and PDFs open in the browser, and a PDF opens inline in Chrome,
Safari and Firefox. Every other document downloads under its original name. Pending keys
are served too, so the preview in an open form is the same `<img src>` as after the save.

**The Gate needs no bytes.** Generated code only ever sees the projection, so the Gate
mints scratch references: a field with a file, a field with none, and a `file[]` with
several. Behavioral tests name files by a closed family token, since the model cannot mint
a reference. Admission, storage and serving are platform code with their own tests, as
routing is.

**The question loop never sees a key.** It may count, group and filter file columns by
`kind`. The question's worker reads every table through views that show a file column
without its key and withhold text that holds a key or an address, because a statement can
disguise any value it can read and no scrub of the result undoes that. The platform also
scrubs keys and `/files/` paths from what comes back, for a copy the views cannot recognize
and for the statement, bound values and SQLite messages the model reads back (ADR-0008).

**Aluna makes no derivatives of an uploaded file.** It draws no thumbnails and no video
posters. Originals are served as they are, and the runtime enforcer marks the markup that
shows them `loading="lazy"` or `preload="metadata"`. A derived file would be an owned
key with a lifecycle of its own, and ownership is the part of files that most needs to be
right. Aluna does not read a document for what it says.
