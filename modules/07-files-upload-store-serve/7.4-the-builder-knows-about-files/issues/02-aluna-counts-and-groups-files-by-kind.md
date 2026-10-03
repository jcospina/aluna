# Aluna counts and groups files by kind

Status: done

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

- [x] The catalog describes `file` and `file[]` columns and their `kind` tokens, and
      names no key
- [x] Scripted tests show the loop counting files by kind, grouping a `file[]` column by
      kind, and filtering records by the presence of a kind
- [x] Rows reaching the model are still scrubbed of keys and `/files/` paths
- [x] No test calls the real provider
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, with Notes holding PDFs and videos from 7.4/01, ask
"how many videos are in my notes?" and "which notes have a PDF?". Each answer is right,
and neither contains an address.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/07-a-field-holds-many-files.md

## What landed

**The catalog explains file columns.** `src/runtime/query/turn/question-turn-prompt.ts`. Each file
field's description names its kinds and every type admission records for them (`admittedTypes`).
`QUESTION_FILE_RULES` is sent only when a listed collection has an active file field. It names the
closed kinds, maps everyday words onto them, and sends grouping and filtering to `kind` itself
through SQLite's JSON functions. It teaches statements from `QUESTION_FILE_SQL`, with `<table>`,
`<column>` and `<list>` placeholders: count by kind in a file column, in a `file[]` column, and
in both over one `UNION ALL`; records holding a kind; records holding more than N of a kind. The
statements group by position, because a field may be called `kind`. They qualify `json_each(t.…)`,
because a field may share a name with a column of `json_each`. They cast the bound number, because
SQLite ranks text above every integer. The vocabulary rule now says a file field lists its kinds
and types. No rule names a key.

**The question gate admits `json_each` and `json_tree`.** A `file[]` column can only be read file
by file through them. Before this issue, `assertScopedQuery`
(`src/runtime/data/access/query-runtime.ts`) refused every virtual table on the question's path.
It now learns the two functions' `vtab:` addresses on the same connection, in the same snapshot,
and refuses every other virtual table: FTS5, `jsonb_each`, `pragma_*`. The Handler path is
unchanged. A `json_each` over `extra` or a retired field is still refused by the column check, and
the worker still reads every table through the keyless views.

**Two exact fixes to the plan reader** (`src/runtime/query/endings/question-nothing-found.ts`).
The first: a `GROUP BY` the key's index satisfies has no sorter, and was read as one row. It now
counts as grouped when the boundary-called subroutine holds both the result's aggregate and its
result row, and no subquery aggregates. The taught "more than N" statement needs this. The second:
a `json_each` of the statement's own text that drives the plan, with no table or with an
outer-joined one, can no longer read as found. That hole is newly reachable through the gate.

**Tests.** `turn/question-file-kinds.test.ts` runs every taught statement through the scripted loop
over a real desk and asserts the rows, the ending and both prompts. The desk has a `file` field, a
`file[]` field named `path`, a `kind` text field, `NULL` and `[]` lists, two files that read alike,
and a record shown only by an empty column. The suite also covers the bound text number, the raw
`file[]` read reaching the model keyless, the gate admitting and refusing, and the catalog
describing each field's kinds and types. The reader tests in `question-nothing-found.test.ts` and
the `jsonb_each` refusal (beside its admitted twin) in `question-turn.test.ts` complete it.
Mutation testing shows every new rule bites. The surviving mutants are conditions no real plan can
tell apart.

## Findings from adversarial review

Five Opus passes. Every finding in the catalog guidance, the gate and the tests is fixed:
- `GROUP BY kind` misgrouped beside a `kind` field (MEDIUM).
- `json_each(<column>)` read a same-named column of `json_each` (HIGH).
- The table alias broke the qualified form.
- The vocabulary rule contradicted the catalog.
- A text-bound number made `HAVING` always false (MEDIUM).
- A count subquery or two counts side by side ended "nothing found" with rows in hand, so the guidance now forbids both.
- There was no "more than N" or both-columns statement.
- `<label>` was undefined.
- The address check now admits nothing if a build prints no `vtab:` addresses, so it fails closed.
- Two test failure assertions were too loose: bare `toThrow` calls, and a refusal pinned only as "failed".
- Copy was pinned in assertions.
- The Word type was found by its index in a table.
- The header comment was stale.

Rounds three to five moved into the 6.4/04 plan reader, which the guidance relies on. They built
about fifteen statements by hand that it misreads, most of them misread before this issue. A
rework that tried to fix them all traded those holes for real answers ending "nothing found". On
the owner's decision (2026-10-02), this issue keeps only the two exact fixes above, each checked
against HEAD over a 167-statement corpus so that no statement reads worse. No real question has
produced any of those statements. The redesign issue was filed and then deleted (2026-10-03): it
guarded a hypothetical failure whose worst case is a spoken zero. One trade remains: a
`json_each` list `LEFT JOIN`ed to a table now reads a real hit as not found, where HEAD read it as
found even over nothing.

## Verification

`bun run test` 4593 pass. `bun run typecheck` and `bun run lint` are clean. No test calls a
provider.

Live on `:3030`, using the existing Studio notes capability. Its `attachments` field is retired
since 7.4/01, so the questions cannot read Kiln log's PDF.
- "how many videos are in my studio notes?" ended "Looking at your Studio notes, I couldn't find
  anything matching that." That is right: no active field holds a video.
- "which studio notes have a PDF?" ended the same way before a PDF was added. Then a real PDF was
  uploaded and saved as Glaze test's `cover_photo` through the upload and update routes, and its
  ledger row is `owned`. Asked again, the answer was: Your studio note with a PDF is “Glaze test.”
  There was no `/files/` path and no key anywhere in the window.

