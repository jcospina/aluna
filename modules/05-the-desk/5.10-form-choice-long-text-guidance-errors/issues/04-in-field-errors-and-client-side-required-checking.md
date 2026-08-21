# A validation error replaces that field's guidance, and the browser checks required fields before submitting

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.10 — The form: choice, long text, guidance and
in-field errors
(PLAN decision 30: `modules/05-the-desk/PLAN.md`)

## What to build

An outline says that something is wrong and a sentence says **what**, so the
sentence belongs in the field. A validation error replaces that field's guidance.

**The placement half needs no additional schema or server change.** The
error-fields attribute is already emitted by the failure-response layer and
already pinned as contract in the spec module — and is read by nothing today.
The structural choice and max-length failures added in 5.10/01–03 emit that same
marker before this issue teaches the form to read it.

**Client-side required checking recovers the native constraint validation the
drawn picker gives up**, since a hidden input is barred from it, and it recovers
it in the same place and the same style with no server round-trip. The
hidden-input mirror needs a real `<form>` ancestor; the datetime mirror already in
the codebase is the working precedent, and the controls page has no `<form>` at
all today. The form handles the invalid event, prevents the browser's foreign
tooltip and renders the one platform-authored required sentence in the field,
replacing guidance just like a server error. Selecting a value clears it.

**One source of copy, and it matters:** forms are platform-owned, while a generated
Handler may already return product-voice text for its declared behavioral error.
The client relocates that existing marked error into every named field without
rewriting it or inventing a second sentence. `behavioral_errors` defines semantic
markers and affected fields, not fixed copy. Platform-owned structural failures
such as required and max length keep their one authored platform sentence. This
preserves the current Handler contract while preventing two competing messages.

## Acceptance criteria

- [ ] A field error renders in its own field, replacing that field's guidance,
      driven by the existing error-fields attribute
- [ ] Clearing the error restores the guidance
- [ ] A required field blocks submission client-side through the hidden-input
      mirror, inside a real `<form>`, with no server round-trip or native tooltip;
      the platform sentence appears in-field and clears when corrected
- [ ] The drawn picker participates in required checking like a native control
- [ ] A generated Handler's one marked product-voice sentence is preserved and
      relocated rather than rewritten; no generated form or second copy source
      exists
- [ ] No behavioral-error schema change is made merely to place existing error
      fields; platform-owned max-length validation remains the server-side source
      for that structural error
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with a required choice field and a length-limited notes field.
Submit with the choice empty and confirm the browser blocks it and marks the field
without a round-trip. Use the developer preview's crafted-request path to submit
an over-long note and confirm the server's error lands under that field, replacing
its guidance, and that fixing it restores the guidance.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/03-long-text-guidance-max-length-and-the-field-chrome.md
