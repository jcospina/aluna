# Every record has an address, and Module 7 closes

Status: ready-for-agent
Type: sign-off gate — the owner runs the script below and declares Module 7 done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 40 to 49; `docs/modules.md` §Module 7 "Verify by running it")

## What to build

This issue takes over 7.4/03's role as the issue that closes Module 7, because 7.5 is now
the module's last epic. It proves the record address and the answer's links with the real
model on a corpus that holds files, then runs the module's whole verify script.

**A real round trip.** On `:3030`, using the default provider, build a capability from the
prompt bar and give it a dozen records, some with photos. Ask three questions: one that
counts, one that lists particular records, and one that names a single record. Only the
second and third answers carry links, and no answer shows an id.

**The address, by hand.** Open a record, reload, paste its address into a new tab, step
Back and Forward, delete it and open its old address. Then press a linked name in an
answer while another record has unsaved changes.

**The module's script.** Run `docs/modules.md` §Module 7's whole verify script, the files
half included, against a copy of the owner's corpus. Every existing capability and
record must still load.

**The trail.** Update the 7.4/03 header so it no longer claims to close the module, and
mark Module 7 complete in `docs/modules.md`.

## Acceptance criteria

- [ ] The three questions behave as described with the real model, and the answer for
      the counting question carries no links
- [ ] Every step of the address check behaves as decisions 40 to 48 say
- [ ] The module's verify script passes on a copy of the owner's corpus, and no existing
      capability or record fails to load
- [ ] 7.4/03 no longer claims to close the module
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean
- [ ] The owner signs off

## Living demo

This is the demo: the steps above, on `:3030`.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/05-a-name-in-the-answer-opens-its-record.md
- modules/07-files-upload-store-serve/7.4-the-builder-knows-about-files/issues/03-a-cold-prompt-picks-the-right-file-field.md
