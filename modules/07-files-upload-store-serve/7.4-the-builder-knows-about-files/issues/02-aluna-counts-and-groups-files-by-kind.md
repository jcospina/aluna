# Aluna counts and groups files by kind

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.4 — The builder knows about files
(PLAN decisions 20 and 37; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The question loop can answer "how many videos are in my notes?" and "which trips have
more than five photos?". The data has been readable since 7.1/09. What this issue adds
is catalog guidance, so the model knows how to read a file column.

**The catalog explains the stored shape.** A file column holds a JSON reference with a
`kind`, and a `file[]` column holds an array of them. The collection description the
model reads says so. It also says that counting, grouping and filtering by `kind` uses
SQLite's JSON functions over that column, with no type mapping in SQL. The closed `kind`
tokens are named, so the model filters on `video` and not `movie`.

**Keys stay out.** 7.1/09's scrub is unchanged. The guidance never names a key, and a
query that selects the raw column still reaches the model scrubbed.

## Acceptance criteria

- [ ] The catalog describes `file` and `file[]` columns and their `kind` tokens, and
      names no key
- [ ] Scripted tests show the loop counting files by kind, grouping a `file[]` column by
      kind, and filtering records by the presence of a kind
- [ ] Rows reaching the model are still scrubbed of keys and `/files/` paths
- [ ] No test calls the real provider
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, with Notes holding PDFs and videos from 7.4/01, ask
"how many videos are in my notes?" and "which notes have a PDF?". Each answer is right,
and neither contains an address.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/06-a-field-holds-many-files.md
