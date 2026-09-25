# Aluna's questions never see a photo's key

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decision 37; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A question about Photos can count and filter its file column, but the model never reads
a key or a file address. The SQL tool returns the stored column, and that column holds
the key, so the platform scrubs rows before the model sees them.

**Rows are scrubbed before they become model text.** A step's rows are scrubbed once, when the
turn records them and before they are weighed, so both the per-turn prompt and the narration
after a step render only scrubbed rows:

- A file reference loses its key.
- Any value that is or contains a ledger key or a `/files/` path is replaced, which
  covers a key a Handler copied into a text field.

`kind`, `mime`, `size` and `name` survive, so "how many of my photos are PNGs" and "which
photo is the largest" can still be answered.

**The catalog describes a file column.** The collection description the model reads
explains that a file column holds a reference with a kind, a type, a size and a name, and
it never mentions a key. Guidance on counting, grouping and filtering by `kind` is
7.4/02's.

The answer window stays text. It shows no images, links or addresses.

## Acceptance criteria

- [x] A question over Photos hands the model rows with no key and no `/files/` path, in
      both the per-turn prompt and the narration prompt
- [x] A ledger key or `/files/` path copied into a text field is replaced before the
      model reads it
- [x] `kind`, `mime`, `size` and `name` survive the scrub
- [x] The catalog describes a file column without naming a key
- [x] The answer window renders text only
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, with Photos holding a few saved photos from 7.1/08, ask
the prompt bar "how many photos do I have, and what kind of files are they?" The answer
counts them and names their type, and it contains no key or address. A test captures the
exact model-facing prompt to prove the scrub.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/08-the-photo-control-uploads-previews-and-saves.md

## What landed

**Two layers, not one.** The issue asked for a scrub of the rows the model reads. The first
adversarial round showed why that alone cannot hold: the SQL tool is the model's, so a statement
can reverse, split, hex-encode, shift or substitute any value it can read, and no scrub of the
result undoes that. The scrub stayed, and a layer in front of it was added so the key is never
there to disguise. ADR-0008, ADR-0009, Module 6 PLAN decision 7, Module 7 PLAN decision 37 and
`docs/architecture.md` carry dated amendments.

**Layer 1: the worker's views** (written in `src/runtime/query/question-views.ts`, run by
`query-worker-thread.ts`). The question
worker's `main` is now an empty in-memory database. The one documented file is attached
`mode=ro` as `question_desk`, a schema the table bound's connection does not have, so no read
can name it, and a write the bound lets through unprepared fails read-only before it reads.
`query_only`, `temp_store` and the refusals by name stand, and transaction keywords joined them.
Every catalog table is shadowed by a temp view named like it, listing the columns the table
bound admits (`id`, `created_at` and the active fields), and every other table in the file, the
ledger included, by an empty view (review pass, 2026-09-25). Each column is
qualified `source."col"` so SQLite's double-quoted-string fallback cannot turn a missing column
into a literal. A view that names a column the table lacks fails the open, loudly.
- A file column becomes `json_object` of `kind`, `mime`, `size` and `name` only, or `NULL` when
  the stored value is not one well-formed object with a single `key`. Its `name` is withheld when
  it may hold an address; a file named after a key, the way a browser names a file saved
  from `/files/<key>`, keeps its kind, type and size and loses its name.
- A `string` column, and a `string[]` column as a one-element JSON array, shows the withheld phrase when
  it may hold an address: a NUL (past which SQLite's text functions read nothing), a `/files/`
  path followed by eight hex digits, or, with the common separators dropped and case folded, a
  ledger key. The key is looked up through the ledger's primary key at each 32-digit window of
  1,055-character chunks holding a hex run, so the cost follows the text, not the ledger, and an
  empty ledger costs nothing. Text columns are cast back to `TEXT`, since a `CASE` has no
  affinity and a number bound against it would match nothing.

**Layer 2: the scrub of what comes back** (`src/runtime/query/question-file-scrub.ts`). The turn
scrubs a step's rows once, against the whole ledger, before it weighs and records them, so the
rows every prompt renders are already scrubbed and what is weighed is what is sent. It replaces
any value that is or contains
a ledger key or a `/files/` address, and a stored reference copied whole keeps all but its key.
A key is matched against the ledger, not the UUID shape a record id shares, by any twelve of its
digits in a row, forwards or backwards, after NFKC: across neighbouring values, hex-encoded to a
fixed point, as a blob (now rendered `X'…'` rather than a map of numbers), or as character
codes. Paths are matched after undoing NFKC, invisible characters, percent, `\u`, entity and
backslash escapes, nested ones collapsed in a pass, with text still changing after eight rounds
taken for an address.

**The turn** (`question-turn.ts`). The statement and its bound values are scrubbed before they
are weighed, so what the budget counts is what later prompts carry, and the worker runs what the
model wrote; one too large as written is refused before the scrub reads it and keeps no call.
SQLite's failure messages are scrubbed (a bad JSON path quotes the value it was given). Rows more
than four times the cap are refused before any scan. The ledger is read once a step and its
fragments cached until a key is added or removed (`readFileLedgerSignature`, count and newest key).

**The catalog and the prompts.** A file column is described as JSON with `kind` (one of its
accepted families), `mime`, `size` and `name`, never a key, and now that is exactly what the
worker returns. Both prompts say what the withheld phrase is and to say nothing about it; the
turn's asks for tables named as listed, with no schema, and `id` rather than `rowid`.

**The answer window** was already text only: the server escapes the sentence, the glue reads it
back as `textContent`, and the window writes it as `textContent`. A test now pins all three.

## Findings from adversarial review, all fixed

Four rounds, eight reviewers.

- The SQL tool can transform any key it reads (reversal, halves swapped, one character a row,
  hex digits as separators, substitution, character codes, octal, shifted codes): fixed
  structurally by layer 1, since a key the worker never shows cannot be disguised.
- SQLite's `bad JSON path` error quoted a key into the failure message; failure messages, the
  recorded statement and its bound values are all scrubbed.
- A blob rendered as a decimal map carried a key's bytes; blobs render as hex and are scanned.
- The scan was quadratic in matches × cells, and unescaping was quadratic on nested `%25`; both
  are linear now. Rows far past the cap are refused before scanning.
- A step was weighed before it was scrubbed, breaking "what is counted is what is sent"; the
  scrubbed call is what is weighed and recorded.
- The ledger was read and its fragments rebuilt up to four times a step; once, and cached, with a
  signature a reused rowid cannot fool.
- The views failed open: a missing table or column was skipped, a column added mid-question was
  read raw, and a double-quoted missing column became a string literal. Views now list the
  snapshot's columns, qualified, and are compiled at open.
- `temp_store` set after the views dropped every one of them; the order is fixed and pinned.
- A NUL before a key, a key in a file's name, a key without hyphens or with other separators,
  and a fullwidth copy each got past one layer; the first four are withheld at the source, the
  fifth by the scrub.
- The per-cell ledger check scanned the whole ledger, then walked the whole text at every
  window; it is an index lookup over chunks.
- Text lost its affinity through the view, so a number bound against it matched nothing; cast back.
- A withheld list became invalid JSON; it is withheld as a list.
- A malformed or doubled `key`, and extra properties, passed through a file column; the column is
  an allow-listed object or `NULL`.
- `/files/` in ordinary text (`https://example.com/files/report.pdf`, a folder called Files) was
  withheld; a path now needs a key's first eight digits after it.
- A thousand-digit `&#…;` entity threw and ended the question; entities are bounded.
- Invisible characters in the scrub's own source had been written as raw characters; escapes.
- `SAVEPOINT` opened a transaction for the rest of a question in the worker; refused by name.
- An empty-shadow default could open a worker with raw tables; the shadow is required, and the
  empty one lives in test support.
- Docs over-claimed what each layer catches; each claim was checked against a probe and
  narrowed, and the residual is stated in ADR-0008 and the scrub's header: a copy some Handler
  stored with other characters between its digits, or already cut up, is read whole only by the
  scrub, and a statement can reorder its pieces past that.
- Tests that compared a function with itself, restated a source name, counted on a random key's
  neighbour, or passed vacuously because a filter saw the withheld phrase were rewritten, and
  three mutation checks (views off, scrub off, statement scrub off) each redden the suite.

`count(DISTINCT photo)` now treats two files with the same kind, type, size and name as one; how
a question counts and groups by file is 7.4/02's. A `file[]` column (7.2) needs its array form
added to the view's allow-list.

## Verification

- `bun run typecheck` and `bun run lint` clean (comment budget and references included).
- `bun run test`: 3595 passed, 0 failed.
- `src/runtime/query/question-file-scrub.test.ts` captures the exact turn and answer prompts over
  a real Photos desk and proves no key, hyphenless, fullwidth or hex spelling of one, and no
  address, in either; `query-worker.test.ts` pins the views, including chunk boundaries and a
  long note read in time that follows its length.
- The live demo on `:3030` needs the server restarted: the running one predates these changes.
