# The record address is decided and drawn

Status: ready-for-agent
Type: sign-off gate — the owner approves the two drawings before 7.5/02 starts

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 40 to 49: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

Four documents say the address names a capability and nothing below it, and one says the
answer window stays text. This issue changes them on purpose before any code does, and
draws what 7.5 builds, because `design/` is the requirement.

**ADR-0010, "Record addresses and record links in answers".** It records decisions 40 to
49: the three address shapes, the platform route ahead of the Action route, the
server-drawn record, the absent-record rule, how the address moves when a record opens
and closes, the model's nominations and the platform's four checks, the prose that never
carries an id, the platform-built anchor, and the press. It names what it reverses:
Module 5 decision 6, ADR-0005's rejected read-single route, and Module 7 decision 37's
"the answer window stays text". It notes that Module 8's link projection points at the
record address, and that Module 10's Event Log must admit the new route as a route
context.

**Amendments.** `CONTEXT.md`: *Address* gains its third shape and a *record address*
term, *Desk* names it, and *Answer window* says it may carry links to records. "deep link"
stays on the Avoid list, because *record address* is the word. `docs/architecture.md`:
the address paragraph and the history rules, the restoration descriptor (still
capability-only), the router paragraph (a platform route sits beside the Actions), the
record view paragraph (read-one is a platform read, not an Action), and the answer window
paragraphs, including "never a capability's records", which becomes "never a
capability's records, only links to them". ADR-0005 and ADR-0008 each gain a dated
amendment note pointing at ADR-0010. Module 5's plan is closed and stays as it is; this
plan and ADR-0010 carry the change.

**`design/` draws two things.** In `design/index.html`, D14 gains the record address in
its readout and rationale, and the absent-record case: the collection opens and the
prompt bar says the existing not-found notice. The answer window gains a linked record
name inside a sentence, in its rest, hover, focus and pressed states, using the drawn
line and existing tokens. `design/design-system.md` says the same in its record and
answer window passages.

## Acceptance criteria

- [ ] ADR-0010 exists and covers decisions 40 to 49, what they reverse, and the forward
      notes for Modules 8 and 10
- [ ] `CONTEXT.md`, `docs/architecture.md`, ADR-0005 and ADR-0008 no longer contradict
      the record address or the answer's links; no closed module plan is edited
- [ ] `design/index.html` draws the record address and the absent-record notice in D14,
      and a linked name in the answer window in all four states
- [ ] Every new sentence follows `docs/prose-guidance.md`; product copy uses ’
- [ ] `bun run lint` clean
- [ ] The owner has approved both drawings

## Living demo

Nothing runs yet. Open `/design/index.html` on `:3030`: the D14 readout shows a record
address, and the answer window drawing shows a linked tea name inside a sentence.

## Blocked by

None.
