# Leaving a form that holds an upload asks first

Status: ready-for-agent

Type: HITL — the question appears on every exit from the desk, and its wording is new
copy. A human walks each exit and approves the drawn question.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decision 32, amendment 6 and §"Design work this module owes"; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

Leaving a record whose form holds an upload, pending or still streaming, asks first.
Module 5 let half-typed forms die with the window. That still holds for anything a person
typed. An upload is the one exception, because losing it costs a transfer the person has
to repeat.

**It is the same question that guards a running build.** 5.8/04 built the question that
asks before leaving a running build or evolution (`public/leaving-a-run.js`). This issue
reuses that question as it shipped, the veil over the window with its centred panel,
rather than drawing a second one. Its wording for a held upload is drawn in `design/`
first, and that drawing is part of the sign-off.

**It guards every in-desk exit:**

- putting the window away
- pressing another logo
- Back and Forward
- a prompt that takes the window
- Delete from the logo menu
- the form's own close, the create panel's included
- opening another record

**A confirmed leave discards the upload.** It aborts the in-flight requests, whose staged
files the server deletes, and hands the held keys to 7.3/02's pending-only route. Backing
out leaves the form and its upload untouched. A form with nothing uploaded still closes
without asking.

**No `beforeunload` dialog.** iOS Safari ignores it, a request sent after one is
unreliable, and a killed tab, a dead battery or a restarted server sends nothing at all.
A reload is 7.3/04's desk-load sweep's to handle.

## Acceptance criteria

- [ ] Each exit in the list above asks before leaving a form that holds a pending or
      streaming upload
- [ ] The question is 5.8/04's shipped question, reused, with its upload wording drawn
      in `design/`
- [ ] Confirming aborts in-flight uploads and sends held keys to the pending-only route;
      backing out changes nothing
- [ ] A form holding only typed text closes without asking on every exit
- [ ] No `beforeunload` handler is added
- [ ] **Sign-off gate:** the human has tried every exit with an upload held and with
      only text typed, and approved the question's wording
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open a Photos record and pick a new photo. Try each
exit in turn: put the window away, press another logo, press Back, type a prompt that
takes the window, choose Delete from the logo menu, close the form, open another record.
Each one asks. Back out once and confirm the upload is still there. Confirm once and see
its ledger row enqueued. Then type only a title in a fresh form and close it; it closes
without asking.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/02-a-discarded-upload-is-let-go-at-once.md
