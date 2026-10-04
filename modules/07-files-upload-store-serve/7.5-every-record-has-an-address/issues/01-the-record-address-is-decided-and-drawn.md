# The record address is decided and drawn

Status: done
Type: sign-off gate — the owner approves the D14 amendment before 7.5/02 starts

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 40 to 49: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

An amendment and documentation issue. Several documents say the address names a
capability and nothing below it, and one says the answer window stays text. This issue
writes the decision down and corrects them before any code changes, because `design/` is
the requirement.

**ADR-0010, "Record addresses and record links in answers".** It records decisions 40 to
49:
- the three address shapes, and the platform route ahead of the Action route;
- the server-drawn record, and the absent-record rule;
- how the address moves when a record opens and closes;
- the model's nominations, and the platform's four checks;
- the prose that never carries an id, the platform-built anchor, and the press.

It names what it reverses: Module 5 decision 6, ADR-0005's deferred read-single route,
and Module 7 decision 37's "the answer window stays text". It notes that Module 8's link
projection points at the record address, and that Module 10's Event Log must admit the
new route as a route context.

**`design/` amends D14.** In `design/index.html`, D14's readout and rationale gain the
record address, `/capability/:id/:record` beside `/` and `/capability/:id`. The
rationale also gains the absent-record case: the collection opens and the prompt bar says
the existing not-found notice. D14 also says that an answer links the records it names,
and that the link has the states `design/` already gives every link.
*Amended 2026-10-03 by the owner:* D14's prose is the whole of the `design/` work. No
example or sample is drawn, and `design/design-system.md` is left alone. Its record and
answer window passages do not contradict the record address.

**Amendments.**
- `CONTEXT.md`:
  - *Address* gains its third shape and a *record address* term, and *Desk* names it.
  - *Answer window* says it may carry links to records.
  - "deep link" stays on the Avoid list, because *record address* is the word.
- `docs/architecture.md` amends these passages:
  - the address paragraph and the history rules;
  - the restoration descriptor, which still holds only a capability;
  - the router paragraph, because a platform route now sits beside the Actions;
  - the record view paragraph, because read-one is a platform read, not an Action;
  - the answer window paragraphs, where "never a capability's records" becomes "never a
    capability's records, only links to them".
- ADR-0005 and ADR-0008 each gain a dated amendment note pointing at ADR-0010.
- Module 5's plan is closed and stays as it is; this plan carries the change.

## Acceptance criteria

- [x] ADR-0010 exists and covers decisions 40 to 49, what they reverse, and the forward
      notes for Modules 8 and 10
- [x] `design/index.html` D14 states the record address, the absent-record notice and
      the answer's links (owner amendment: no drawn example)
- [x] `CONTEXT.md`, `docs/architecture.md`, ADR-0005 and ADR-0008 no longer contradict
      the record address or the answer's links; no closed module plan is edited
- [x] Every new sentence follows `docs/prose-guidance.md`; product copy uses ’
- [x] `bun run lint` clean

## Living demo

Nothing runs yet. Open `/design/index.html#decisions` on `:3030`: D14 states the record
address, the absent-record notice and the answer's links.

## Blocked by

None.

## What landed

- **ADR-0010**, `docs/adr/0010-record-addresses-and-record-links-in-answers.md`. It
  records decisions 40 to 49 and names what they reverse: Module 5 decision 6,
  ADR-0005's deferred read-single route, and Module 7 decision 37. It carries the forward
  notes for Module 8's link projection and Module 10's Event Log.
- **D14** in `design/index.html` gains the record address, the absent-record case with
  the shipped notice (`NOT_FOUND_NOTICE`, byte for byte), and the answer's links. "Deep
  links" left its rationale, because the term is on the Avoid list.
- **`CONTEXT.md`**: *Address* has three shapes and the new history rules, there is a new
  *Record address* entry, *Desk* names it, and *Answer window* may carry links. "Deep
  link" stays on the Avoid list.
- **`docs/architecture.md`**: the logo-layer navigation sentence, the address and
  history paragraph, the restoration descriptor, platform presentation's record view,
  the router (the platform route ahead of the Actions, and the absent-record rule), the
  Event Log's route contexts, and the answer window ("never a capability's records, only
  links to them").
- **ADR-0005** and **ADR-0008** each carry dated amendment notes pointing at ADR-0010.
  ADR-0002's list of reserved routes gains the record address, and its stale
  `src/app/app.ts` path now points at `src/server/app.ts`.
- **PLAN**: decision 44 gains the address correction after a build (below), and the
  owed-design paragraph matches the owner's ruling. No closed plan was touched.

## Adversarial findings, all fixed

One Opus review found 1 high, 8 medium and 10 low findings.

- **High: a build that displaced a record left the address on that record** while the
  window showed the collection. The descriptor stays capability-only, so PLAN decision
  44, ADR-0010, `CONTEXT.md` and ARCH now say the address is replaced with
  `/capability/:id` when the build gives that capability back, restored or shown
  evolved, adding no entry. A successful first build still pushes. 7.5/03 builds this.
- **Medium, all fixed:**
  - D14's readout cell no longer implies that the fixture desk shows record addresses.
  - The ADR-0008 note no longer claims more than decision 46 does.
  - The "no `update`" case is described as the guard it is, because all five Actions
    are mandatory.
  - ADR-0010 no longer uses "record route", which is on the new Avoid list.
  - ADR-0005 is described as deferring the route, and its §3 escape hatch has a note.
  - Two reasons in "Considered options" that nothing supported were replaced.
  - The record rule moved out of ARCH's capability-deletion passages.
  - "The only navigation" now reads "the only navigation between capabilities".
- **Low, all fixed:**
  - The other-capability absent case is stated everywhere.
  - The endings use the `CONTEXT.md` terms.
  - Two notes that separated a subject from its verb or broke a "This" reference were
    moved.
  - A false "so" is gone.
  - ADR-0002's stale path is corrected.
  - An announcing phrase is cut.
  - The Module 10 note is its own sentence.
  - The unsaved-changes leave question is named beside the run hold.
  - The PLAN and this issue match the owner's ruling.

A second Opus pass confirmed those fixes and found seven problems that the fixes
themselves introduced. All seven are fixed:

- ARCH's navigation sentence no longer claims logos are the only way between
  capabilities, since an answer's link can open another capability.
- D14 names the three ways out of a record that land on the collection, instead of
  "every way out".
- The high finding now has a carrier: 7.5/03 states the address correction and has an
  acceptance criterion for it.
- "Rejected" became "deferred" in this issue and in the PLAN.
- ARCH describes the no-`update` guard as a guard.
- ADR-0010's restore list now matches the PLAN's "restored or shown evolved".
- Prose:
  - the record view clause in ARCH is its own sentence;
  - D14's readout cell says whose fixture records lack ids;
  - ADR-0010's opening drops an ambiguous "it";
  - the notice is "said" everywhere, issue 05 included;
  - the ragged lines are rewrapped.

A third pass confirmed the seven fixes and found five leftovers, all fixed:

- Issue 05 no longer expects link states drawn here.
- In issues 03 and 05, the prompt bar is now the subject that says the notice.
- The PLAN and issue 02 say the notice rather than speak it.
- A double blank line in ARCH is removed.
- A ragged wrap in `CONTEXT.md` is rewrapped.

## Verification

- `bun run lint` is clean: biome, the comment budget and references, folder size, and
  230 policy tests.
- `/design/index.html#decisions` was read on `:3030`, and D14 renders all three
  paragraphs.
- `git diff --stat` touches no `modules/0[1-6]*` file.
- The new text has no bidi control characters. Curly quotes appear only in the quoted
  product notice.
