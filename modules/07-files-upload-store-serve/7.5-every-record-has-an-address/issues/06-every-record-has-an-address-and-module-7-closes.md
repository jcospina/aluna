# Every record has an address, and Module 7 closes

Status: ready-for-agent — built and verified; the sign-off gate is the only box left
Type: sign-off gate — the owner runs the script below and declares Module 7 done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 40 to 49; `docs/modules.md` §Module 7 "Verify by running it")

## What to build

This issue takes over 7.4/03's role as the issue that closes Module 7, because 7.5 is now
the module's last epic. It proves the record address and the answer's links with the real
model on a corpus that holds files, then runs the module's whole verify script.

**A real round trip.** On `:3030`, using the default provider, ask questions of
capabilities the corpus already holds. Nothing is built for this check. Houseplants has 22
records with a room and a watering interval, enough to make a list question mean something.
Family moments has 5 records, each holding a photo or a video, so its answers link records
whose files the model cannot describe. Expected answers are taken from the corpus as it
stood on 2026-10-05.

| Capability     | Kind   | Question                                                | Expected answer                                                                                |
| -------------- | ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Houseplants    | counts | How many plants live in the bathroom?                   | 3, with no links                                                                               |
| Houseplants    | lists  | Which plants need water more often than once a week?    | Boston fern, Calathea, Alocasia, Prayer plant, Peace lily, English ivy, each linked            |
| Houseplants    | names  | Which plant goes longest between waterings?             | ZZ plant, linked                                                                               |
| Family moments | counts | How many family moments happened before August?         | 2, with no links                                                                               |
| Family moments | lists  | Which family moments happened in September?             | Her first steps, Colours on the kitchen screen, each linked; pressing one shows its video     |

No answer shows an id.

**The address, by hand.** Open a Family moments record, so the address check also proves
the server draws a record that holds a file. Reload, paste its address into a new tab, step
Back and Forward, delete it and open its old address. Then press a linked name in a
Houseplants answer while a Personal photos record has unsaved changes. Do the delete on the
corpus copy below, never on the owner's corpus.

**The module's script.** Run `docs/modules.md` §Module 7's whole verify script, the files
half included, against a copy of the owner's corpus. Every existing capability and record
must still load. The script uses existing capabilities where it would otherwise build them:

- Where it builds Photos from the prompt bar, use Personal photos, which already holds
  photos in an optional `file` field.
- Where it evolves an existing Notes capability, evolve Hypomnemata, which has no file
  field yet, then delete it through M4's capability action on the copy.

**The trail.** Update the 7.4/03 header so it no longer claims to close the module, and
mark Module 7 complete in `docs/modules.md`.

## Acceptance criteria

- [x] The five questions give the expected answers with the real model, and neither
      counting answer carries a link
- [x] Every step of the address check behaves as decisions 40 to 48 say
- [x] The module's verify script passes on a copy of the owner's corpus, and no existing
      capability or record fails to load
- [x] 7.4/03 no longer claims to close the module
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean
- [ ] The owner signs off

## Living demo

This is the demo: the steps above, on `:3030`.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/05-a-name-in-the-answer-opens-its-record.md
- modules/07-files-upload-store-serve/7.4-the-builder-knows-about-files/issues/03-a-cold-prompt-picks-the-right-file-field.md

## What landed

- **The five questions**, asked on `:3030` with the default model, gave the expected answers.
  The two counting answers ("3 of your plants live in the bathroom", "2 family moments from
  before August") carry no link. The list and name answers link exactly the expected records:
  six plants, the ZZ plant, and the two September moments. Each link's id matches its row, no
  answer shows an id, and no `intent_resolution_metrics` row holds a record id. Pressing "Colours
  on the kitchen screen" opens it with its video ready to play.
- **The address check.** One record, "Walk in the garden" (a video), went through the whole
  sequence in Chrome on a corpus copy:
  - the card press pushes the address, and reload and a new tab land on the same record;
  - Back and Forward move between it and its collection, writing nothing;
  - delete steps back to the collection;
  - its old address opens the collection under "Hmm — I can’t find that one.", answers 404, and
    the bar reads `/capability/family_moments`. Its video's ledger row and bytes are gone.

  A name pressed in a Houseplants answer while a Personal photos record held an unsaved title
  asks the leave question in the photo's window. "Keep editing" keeps the edit and its focus.
  "Leave without saving" opens the plant in front, with its first field focused, and the photo's
  title is unchanged.
- **The verify script**, on copies of the owner's corpus booted from their own directory on
  `:3031`. Personal photos stood in for Photos and Hypomnemata for Notes.
  - Files, through the desk in headless Chrome:
    - a photo uploaded in the create panel draws on the card;
    - a title edit keeps it;
    - a replace and a clear each recover the old bytes;
    - a replace while `storage/` was read-only committed, drew the new photo, and left the old
      key `cleanup_enqueued` with `EACCES`. It was gone once the store was writable.
  - The leave warning shows for a form holding an upload, and leaving discards the held bytes.
  - Killing the server mid-upload left a partial file in staging, which boot cleared. Killing it
    mid-form left a pending upload, which the next desk load swept.
  - With an upload held in one tab, a desk load in a second swept it, and the first tab's save
    said "I can’t save that file in this field. Mind adding it here again?"
  - Hypomnemata, evolved from the prompt bar:
    - v2 added `cover_photo` (`file`) and `attachments` (`file[]`);
    - an entry was given a cover and two PDFs through its form;
    - v3 hid `attachments`, which left one active and two inactive owned keys;
    - deleting it through the logo menu removed the registry row, its table, its ledger rows,
      all three keys' bytes and `capabilities/hypomnemata`;
    - a reboot and a desk load then removed nothing more and logged nothing.

    Its 22 records loaded at v1, v2, v2 with files, and v3.
  - Every capability and record on the copy loaded before (28 and 192) and after (27 and 170).
    The owner's corpus is untouched.
- **Focus, by the owner's ruling of 2026-10-05.** After a yes on a pressed name, focus goes to
  the opened record's first field, as decision 48 says, not to the prompt bar.
  - A held navigation answers `PLACES_ITS_OWN_FOCUS` (`public/core/shell-dom.js`) when what it
    opens places the focus itself, and `goAheadAndLeave` then leaves focus alone.
  - A record press answers it, and so does a confirmed Back or Forward that moves onto a record.
- **The trail.**
  - 7.4/03's header and living demo no longer claim to close the module.
  - `docs/modules.md` §Module 7 carries a status line. It reads "waiting on the owner's
    sign-off" and becomes "complete" at sign-off.
  - Decision 42's wording in PLAN, ADR-0010, ARCH and CONTEXT now says the full page is the desk,
    which opens the record from its address, as 7.5/02 built it.
  - PLAN's stale "7.2/07 awaiting sign-off" note is gone.
  - 7.5/05's notes record the focus change.

## Decisions taken without the owner, open to reversal

- A record that does not land leaves focus on the prompt bar, beside the sentence that says why,
  unless the person has put focus somewhere else. This covers a deleted record, a refusal that
  keeps the collection the person was reading, and a desk load of a deleted record's address.
  Before, focus fell to the page.
- Pressing the name of the record already open, with no run in its window and no question
  standing, brings it forward and focuses it without asking, and its unsaved changes are kept.
  Before, it asked "Leave without saving?", and a yes left the changes on screen unguarded.
- A confirmed Back or Forward onto a record leaves focus to that record's first field, as an
  unasked Back does. Before, after a run's question, the bar took it.
- **Open for the owner:** a record left open when an evolution run ends shows the run's ending
  over it. Pressing that record's name in an answer brings the window forward and shows nothing
  new, as it did before 7.5/06. Showing the record would put the unread ending away, as a press
  on another logo already does.

## Findings from adversarial review, all fixed

- **Evidence review:**
  - Module 7 was marked complete before sign-off. The status line now waits on it, and says
    which steps ran on the owner's corpus and which on a copy.
  - The files half was proven only by hand-built posts. It was re-run through the desk in
    headless Chrome.
  - The address check used three records. One record now goes through the whole sequence, with
    `history.length` and the front window recorded at each step.
  - Hypomnemata's records were never loaded while evolved. They were loaded at v2, with files,
    and at v3.
  - A deleted record's file being freed was not shown. It is now.
  - Idempotence of the deletion is pinned by `owned-files.test.ts:322`,
    `owned-resources.test.ts:361`, `fault-battery.test.ts:352` and `file-cleanup.test.ts:148`,
    and shown live by the reboot.
  - Decision 42's wording disagreed with what 7.5/02 built. It is amended.
  - The PLAN line about 7.2/07 was stale. It is fixed.
  - Focus after a yes disagreed with decision 48. The owner ruled for the first field, and it is
    fixed.
- **Focus fix review:**
  - A record that does not land after a yes left focus on the page. The bar now takes it.
  - Pressing the already-open record's name over unsaved changes asked, and a yes left them
    unguarded. It no longer asks.
  - The run-hold yes had no test. It has one.
  - A bare `true` as the opt-out could be returned by accident. It is now a symbol.
  - A confirmed traversal onto a record ended on the bar. It now leaves focus to the record.
  - 7.5/05's notes were missing the change. They now record it.
- **Second focus review:**
  - The already-open shortcut fired while a leave question stood, and dropped focus behind it.
    It now stands aside, and focus returns to the question.
  - The shortcut also fired over a finished run. It now stands aside whenever any build run
    stands in the window.
  - The symbol's JSDoc and 7.5/05's "opened" note were out of date. Both are fixed.

## Verification

- `bun run typecheck` and `bun run lint` are clean.
- `bun run test`: 4933 passed, 0 failed, run on its own. An earlier run overlapped my
  hand-mutation of source files and showed 2 failures. The clean rerun followed.
- Hand mutants each fail a test:
  - the bar focus after a 404 and after a refusal;
  - the already-open shortcut and its two guards;
  - the symbol from a press and from a traversal;
  - `goAheadAndLeave`'s check.
- Live on `:3030`, headless Chrome, nothing saved:
  - the five questions;
  - the yes on a pressed name lands in `plant_name`;
  - pressing the open plant's own name keeps its unsaved edit and asks nothing.
- On a corpus copy on `:3031`: the address sequence, the files half, Hypomnemata, and a deleted
  plant's name, which opened the collection with the cursor on the bar.
