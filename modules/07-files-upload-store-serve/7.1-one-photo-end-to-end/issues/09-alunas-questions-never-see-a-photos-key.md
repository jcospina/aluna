# Aluna's questions never see a photo's key

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decision 37; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A question about Photos can count and filter its file column, but the model never reads
a key or a file address. The SQL tool returns the stored column, and that column holds
the key, so the platform scrubs rows before the model sees them.

**Rows are scrubbed where they become model text.** `renderQuestionRows` is the one place
rows turn into what the model reads, both for the per-turn prompt and for the narration
after a step. Scrubbing happens there:

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

- [ ] A question over Photos hands the model rows with no key and no `/files/` path, in
      both the per-turn prompt and the narration prompt
- [ ] A ledger key or `/files/` path copied into a text field is replaced before the
      model reads it
- [ ] `kind`, `mime`, `size` and `name` survive the scrub
- [ ] The catalog describes a file column without naming a key
- [ ] The answer window renders text only
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, with Photos holding a few saved photos from 7.1/08, ask
the prompt bar "how many photos do I have, and what kind of files are they?" The answer
counts them and names their type, and it contains no key or address. A test captures the
exact model-facing prompt to prove the scrub.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/08-the-photo-control-uploads-previews-and-saves.md
