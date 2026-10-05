# Opening a record moves the address

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decision 44; ADR-0010: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

After 7.5/02 a record address works when it is loaded, but pressing a card still leaves
the bar on the collection. This issue makes the address follow the window.

**A press pushes.** Opening a record from a card, in a collection or in search results,
pushes its record address through the desk's existing `pushAddress`. The search term
still stays out of the address.

**Every way out leaves the same way.** The back control, a save and a delete all close
the record view. When the entry before is this capability's collection, they step back.
When the person arrived by link, they replace the entry with `/capability/:id`. Back and
Forward render a record or a collection without pushing. On a Forward onto a record deleted
since, the prompt bar says 7.5/02's notice.

**Guards hold.** The leave question for unsaved changes and the hold on a running build
cover a Back or Forward onto, off or between record addresses, as they cover every
traversal now. A build's restoration descriptor stays capability-only, so a finished
build shows the collection. A build started from a record address keeps that address
while it runs; when it gives that capability back, restored or shown evolved, the
address is replaced with `/capability/:id`, adding no entry (decision 44, amended
2026-10-03).

**The pins move, they do not go.** `desk-window-address.policy.ts` keeps exactly one
`pushState` and one `replaceState` in `desk-address.js`. Its "nothing below capability
identity" assertion becomes "a record id and nothing else: no search term, no draft".
`isAnotherPlace` compares the capability and the record.

**Already in place from 7.5/02.** `isAnotherPlace` compares the capability and the record
(02 needed it so a correction recognises the same record spelled in upper case). A record
address renders on a traversal whatever the window holds: the press guard lets a record ask
through, and `windowAddress` (`public/desk/window/addressed-window.js`) keeps the bar on a
record address while that record's view holds the window, so the back control already lands
on `/capability/:id` by replacing the entry. A trailing slash on a record address is the same
record, as it is for a collection. This issue still owns the push and stepping back.

**Left for this issue by 7.5/02.** A prompt submitted while an address is still loading takes
the window, and the address's answer then stands aside (it is neither swapped in nor said). When
that run gives the window back empty, the window is put away but the bar still names the address
that never opened. The same was already true of a collection's address. The restoration rule
below should cover it: whatever the run gives back, the bar ends on what the window shows.

## Acceptance criteria

- [x] A card press pushes the record address; Back returns to the collection and
      Forward to the record, in the same window, with no reload
- [x] Back control, save and delete each leave the record view to the collection address,
      stepping back or replacing as decision 44 says
- [x] Unsaved changes ask before a traversal leaves a record; a running build holds it
- [x] A build started from a record address that gives the capability back, restored
      or shown evolved, leaves the address on `/capability/:id` with no new entry
- [x] The address policy and the restoration-descriptor pin are amended, and still bite
      (`bun run mutate` on the address module)
- [x] `desk-address.js`, `desk-window.js` and `app.js` stay within their line ceilings
- [x] An adversarial pass on history sequences (press, save, delete, Back, Forward, a
      second record, a build starting mid-record, the phone layout) is clean
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, open a capability and press a card: the bar shows `/capability/<id>/<record>`.
Press Back: the collection. Press Forward: the record. Type a change and press Back: Aluna
asks first. Save: the bar returns to the collection.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/02-a-record-address-opens-the-record.md

## What landed

**A press pushes.** `public/records/record-view.js` pushes the record address after a card press
swaps the record view in, spelled by `recordAddress` from the capability and the id the record's
forms post, and only for a UUID-shaped id. Search results press the same way; the search term never
reaches the address.

**Every way out leaves the same way.** Back, Cancel, a committed save and a committed delete all end
in `leaveRecordView`, which marks the exit (`markRecordExit`) for the length of its collection read.
When that read lands, `followWindow` (`public/desk/desk-address.js`, now the one rule
`addressTheWindow` defers to) steps back if the entry before is this capability's collection, and
otherwise replaces the entry with `/capability/:id`. The read asks from a hidden element of its own
in the window, so it is never queued behind a press, and it stands aside, drawing and saying
nothing, once anything else has swapped into the window.

**What the entry before is.** The desk keeps, in the page, the address each entry it wrote or
landed on names (`places`), never in `history.state`, which still carries only the desk's mark and
count. After a reload the entries before belong to a page now gone, so the way out replaces rather
than step back into a full page load; Back and Forward teach the page again.

**Guards.** The leave question and the build hold cover every traversal onto, off or between record
addresses, as before. Three fixes make them hold across record addresses:

- A confirmed traversal goes to the absolute entry the person asked for, not a relative step, so a
  way out that stepped back while the question stood is not overshot.
- It is not asked about again when it lands. "Leave without saving" gives focus back to the form,
  and focus counted as starting on it again, so the Back was held a second time (pre-existing for
  any traversal off a dirty form).
- While the bar is on an entry other than the desk's own (a held step back, or the desk's own step
  back still in flight), every address write waits. The desk then re-derives the bar from the
  window when it is back (`DeskAnswers.follow`, wired to `addressTheWindow`, or `/` if the window
  went), and keeps any push or step back the held write owed.

**Builds.** A build started from a record address keeps that address while it runs. Restored or
shown evolved, it gives the collection back by a replace (`followWindow` never pushes a navigation
that returns to the capability whose record the bar names). A first build of a new capability still
pushes. The restoration descriptor is untouched and capability-only.

**Left for this issue by 7.5/02.** `PUT_WINDOW_AWAY_EVENT` now also puts the bar on `/` (a replace),
so a run giving the window back empty leaves the bar on what the window shows. `windowAddress`
keeps a record address while that record is still being asked for, so a quick Forward onto a record
is not corrected to the collection when the collection's own records land first.

**Pins.** `desk-window-address.policy.ts`:

- It still allows exactly one `pushState` and one `replaceState` in `desk-address.js`, now swept
  across every shell script, along with `history.go`.
- It adds the record press, spelled through `recordAddress`.
- "A record id and nothing else: no search term, no draft" pins `entryState` to the mark and count.
- The restoration-descriptor pin is kept.

`desk-window.js` net shrank; `app.js` is untouched; all three are within biome's ceilings.

**Tests.**

- `src/presentation/shell/window/address/desk-window-record-history.test.ts`, played on
  `tab-history.test-support.ts`: a history whose traversals arrive only when the test lets them.
- Additions to `record-view.desk.test.ts` (each way out steps back, own source, overtaken read,
  non-UUID id), `desk-window-record-address.desk.test.ts` (empty give-back, quick Forward) and
  `leaving-a-run.wiring.test.ts` (window put away mid-question; that test now delivers its step back).
- The record-view harness stands a real history and stamps its entry.
- The `RECORD` fixture id is a UUID.

## Findings

- **Spec and standards review (Opus).** No HIGH. Fixed:
  - Untested hold across record addresses.
  - A policy test renamed without new teeth.
  - A wrong `HX-Replace-Url` comment.
  - The exit read's queueing.
  - Non-UUID pushes.
  - Naming (`stepBackOffRecord`).
  - Comments.
  - Fixture names.
- **Adversarial round 1 (Opus), 5 findings, all fixed:**
  - A reload made Save step back across documents.
  - "Leave" overshot after the way out stepped back.
  - A stale entry-before was stepped onto.
  - The exit read could queue behind a logo press.
  - The bar named a record after "Stay".
- **Adversarial round 2 (Opus), 6 findings, all fixed:**
  - A quick Forward onto a record was corrected to the collection.
  - The exit read could wipe a build that started meanwhile.
  - An overtaken read's refusal was said on the prompt bar.
  - The bar kept a record over a window put away mid-gap.
  - A lost `go` left the yes or step-back expectation standing; a push now clears them.
  - A way out that landed mid-gap replaced instead of stepping back.
- **Live check:** "Leave without saving" on a browser Back asked twice (above), fixed.
- **Trade, recorded:** after a reload the way out replaces, leaving one inert Back. Stepping back
  would load the page whole.

## Verification

- `bun run test`: 4744 tests, all green except one run in which an unrelated server test
  (`router.file-edit.test.ts`, "replacing a photo… scheduled retry") failed under load. It passes
  3/3 alone. `bun run typecheck` and `bun run lint` are clean.
- `bun run mutate public/desk/desk-address.js`: 94.5%. The survivors are equivalent:
  - the unused title argument;
  - `null` checks that `isAnotherPlace` already answers;
  - optional chaining on a guarded `go`;
  - unreachable `null` bars;
  - `once: true`;
  - the initial `owedAnEntry`.

  The two kept-mark survivors were then killed by new tests.
- **Live on `:3030`, in the Browser pane.** Each of the following was checked:
  - **Card press:** pushes `/capability/<id>/<record>`. Back returns to the collection and Forward
    to the record, with no reload.
  - **Back control, Cancel, Save and Delete:** each steps back onto the collection, and Forward
    returns to the record.
  - **Delete:** used a throwaway record, created and deleted.
  - **Forward onto that deleted record:** says "I can’t find that one" and is corrected in place.
  - **Reload on a pressed record, then the back control:** replaces in the same document.
  - **Arrived by link:** replaces.
  - **Typed change, then browser Back:** asks first. "Keep editing" stays; "Leave without saving"
    lands on the collection with the change discarded.
  - **Deflected build from a record address:** shows the collection with the address replaced and
    no new entry.
  - **Phone layout (375px):** the same push, Back/Forward and step back.

