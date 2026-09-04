# Every collection states how many records it holds

Status: ready-for-agent — built and verified; the sign-off gate is the only box left,
and only a human can tick it.

Type: HITL — the number is new furniture on the collection, and decision 32
deliberately leaves where it is rendered and how it looks unsettled.
Implementation is fully specified and agent-ready; a human sees where it lands
and reads how it says it before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.1 — What every collection holds
(PLAN decision 32; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A capability's collection states how many records it holds. This is the module's
first visible day and it answers the most common question in it before anyone has
to ask — a person who can read the number never has to ask Aluna for it.

**It is platform-owned scaffolding.** No generated artifact changes: the same
Handler, the same item renderer and the same generated tests serve a capability
that was built before this issue, and no spec, registry or `ui_intent` field is
added for it. The count belongs to the platform's collection chrome
(`src/presentation/records/list-container.ts`), beside the search chrome and the
records region, not to anything a model wrote.

**It is a `count` against the read connection**, so it is free — the same
physically read-only path (`dbReadonly` in `src/platform/persistence/db.ts`) that
every other read on the desk already uses. It writes nothing and creates no
registry, version, artifact, cache or `read_dependencies` state.

**The number is true, or it is not there.** It equals the records the capability
holds, and it agrees with what the collection renders. It stays true across a
create, an update and a delete, following the same refresh the records region
already takes rather than a second mechanism that can drift from it.

**A collection with no records already speaks.** The platform empty state is what
a bare collection says, and this issue must not leave two statements of the same
fact standing next to each other.

Where the number is drawn, and in what words, is not settled by the plan and is
not settled here. This issue states the behaviour; the human signs off on the
rendering.

## Acceptance criteria

- [x] A capability's collection states how many records it holds, and the number
      equals the records rendered in that collection
- [x] The number is read through the read-only connection; no write, no new
      table, no spec or registry field, no second source of truth
- [x] No generated artifact changes — a capability built before this issue shows
      its count without being rebuilt
- [x] The number stays true across create, update and delete without a reload,
      through the existing records refresh rather than a parallel one
- [x] An empty collection keeps its platform empty state and does not state the
      same fact twice
- [x] The count creates no registry, version, artifact, cache or read-dependency
      state
- [ ] **Sign-off gate:** the human has seen where the number lands, on a
      populated and on an empty collection, and read how it says it
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030` and build Notes from the prompt bar.
Add a few notes and open Notes from its logo: the collection says how many notes
there are. Add another and watch the number move without a reload; delete one and
watch it move back. Open a capability with nothing in it and confirm the empty
state still reads as one statement, not two.

## What landed

**The count rides the read, and nothing else.** `read` and `search` answers now carry a
sidecar at the head of the body — an HTML comment the shell takes off before the records
land (`src/presentation/records/collection-count.ts`,
`src/runtime/router/wire/collection-count.ts`). One round trip carries both, so there is
nothing to poll and no second number to keep in step. All three transports that write the
records region strip it through the same split: htmx for the View's own one-shot load
(`public/collection-count.js`), the post-create refresh (`public/records-refresh.js`) and
the search controller (`public/search-chrome.js`).

**A comment, not an element.** A sidecar that ever reached the DOM unstripped must not
take the platform empty state away, and browsers do not count comments when matching
`:empty`. The payload is percent-encoded with `-` escaped too, so nothing a capability's
noun contains can close the comment early.

**The count itself** is `COUNT(*)` on the capability's canonical table through `dbReadonly`
(`src/runtime/data/access/record-count.ts`) — as of 6.1/03 across `CapabilityQueryPort.all`,
the seam every other read of capability data crosses. No spec, registry or `ui_intent` field; no
generated artifact changed — the eight capabilities already on the dev desk state their
counts without being rebuilt.

**Where it landed.** A `.capability-count caps` label between the search rail and the
first item, with an even 12px gap on both sides. Getting that gap even meant moving the
search's `aria-live` status line below the records region, because it was taking a line
between the rail and the count.

> Corrected while building 6.1/02: that line was reserved only because the collection's
> four `data-search-state` rules were written with a child combinator they could not
> cross, so the rule meant to hide the idle status line had never matched anything. With
> those rules repaired the idle line reserves nothing, and the status line stays below the
> records for the reason that outlives the bug — nothing may come between the count and
> the first record, and this line is not always silent.

**`design/` corrected, not converged on.** The design page had the create action on the
count's row and the search rail alone above it, which the product has never done. The
user's ruling: the button always sits beside the search bar except on small screens, so
the page was wrong. `design/design-system.md`, `design/index.html`, `patterns.js` and
`design/styles/components/collection.css` now state and render the shipped rule — search
and create on row one, the count on row two, each taking a full row below 620px of
*window* (a container query, not a viewport one, so a window dragged narrow wraps too).
The page's collection demos moved to one column, because a 497px stage could only ever
show the wrapped state it was describing the alternative to.

**Search clears it.** What a filtered collection holds is not what it renders, and a number
that disagrees with the records under it is worse than no number. The matched count *and*
the total is decision 32's second half and issue 02.

## Findings fixed

Both review passes (quality and adversarial) ran before the live test; every finding is
closed.

- **A generated Handler could forge a count.** A mutation's answer carries no platform
  sidecar, so position zero belonged to the model — and the fragment enforcer passes a
  comment straight through. The htmx reader now honours a sidecar only on a swap aimed at
  the records region, which a mutation's answer never is, and ignores a swap another rule
  has cancelled.
- **Broken plurals.** The schema admits any single line in any script, so the first
  pluralizer produced "7 메모s", "7 leafs", "7 potatos", "7 serieses", "7 datas".
  `pluralNoun` now declines wherever English has two answers and outright for anything not
  written in Latin letters, leaving the bare number. The one wrong answer left is a
  Latin-script non-English noun ("7 Aufgabes"), wrong the same way "add your first Aufgabe
  above" already is.
- **The count and the rows are one round trip, not one snapshot** — the count runs after
  the Handler's `SELECT`, on a connection every concurrent read shares, so a transaction
  around it would enclose other requests. Stated in the module header; closing it needs a
  per-request read connection, which is a change to platform data access.
- Also fixed: no thousands separator; an unterminated sidecar swallowing the fragment; the
  label's id referenced by nothing (now the records region's `aria-describedby`, which is
  also why it needs no second live region); a barrel exporting five unused symbols; one
  rationale repeated in seven files; a CSS comment explaining the wrong thing; a
  "creates nothing" test that compared table names but not row counts; a CSS-parity test
  that would pass on an empty rule body; a stale comment in `public/index.html`.

## Verification

- `bun run test` — 2579 passed, 0 failed (73s). `bun run typecheck`, `bun run lint` clean.
- New coverage: the htmx transport (the one every collection's first load goes through),
  the forgery refusal, every plural case above, the sidecar round-trip, DOM order, and a
  router test proving a pre-existing fixture counts without a rebuild.
- Live on `:3030` against capabilities built long before this issue: 22 → search → count
  clears → clear → 22 → create → 23 → delete → 22, no reload, no residue in the region.
