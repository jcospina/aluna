# A validation error replaces that field's guidance, and the browser checks required fields before submitting

Status: done

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

- [x] A field error renders in its own field, replacing that field's guidance,
      driven by the existing error-fields attribute
- [x] Clearing the error restores the guidance
- [x] A required field blocks submission client-side through the hidden-input
      mirror, inside a real `<form>`, with no server round-trip or native tooltip;
      the platform sentence appears in-field and clears when corrected
- [x] The drawn picker participates in required checking like a native control
- [x] A generated Handler's one marked product-voice sentence is preserved and
      relocated rather than rewritten; no generated form or second copy source
      exists
- [x] No behavioral-error schema change is made merely to place existing error
      fields; platform-owned max-length validation remains the server-side source
      for that structural error
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with a required choice field and a length-limited notes field.
Submit with the choice empty and confirm the browser blocks it and marks the field
without a round-trip. Use the developer preview's crafted-request path to submit
an over-long note and confirm the server's error lands under that field, replacing
its guidance, and that fixing it restores the guidance.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/03-long-text-guidance-max-length-and-the-field-chrome.md

## What landed

**The guidance slot became a slot rather than a line.** It used to be rendered only when a
field declared a hint, which made "the error replaces the guidance" a rule with nothing to
replace on most fields. Every field carries one now — empty and `hidden`, always in
`aria-describedby` — so the client writes one string into one element it can always find,
and putting the hint back is putting one string back. That is the whole of the state this
slice keeps: a class on the field, a sentence in the slot, and the pristine hint parked in
`data-field-guidance-text` beside it.

**`data-error-fields` finally has a reader, four epics after it became contract.** The
sentence is *moved*, not copied: the form's shared error region is emptied and every field
the marker names says the same words, unrewritten — which is what keeps a generated
Handler's own product-voice sentence authoritative rather than paraphrased. A refusal that
names no field this form draws is left standing where it landed, because a sentence
relocated to a slot that does not exist is a person answered with silence.

**One sentence, one author, and the form is where it is written.** Every other sentence a
form shows arrives from the server in the response it answers. The required one is said
before there is a request at all, so the browser has to be holding it — and it rides the
form in `data-required-message` rather than being a second literal in the client. The
client contains no copy of it, which a test pins from both sides.

**The browser keeps its refusal and loses its tooltip, and the picker gets its refusal
back.** `invalid` is cancelled, which is what takes the foreign bubble away — and takes
the browser's focus and scroll with it, so every path that marks a field now ends standing
on the first one it marked. The drawn picker has no native constraint to cancel, because
its value rides a hidden input and no browser validates one; `data-choice-required` on the
carrier is what the submit handler enforces instead, in the same place, the same sentence
and the same slot a native control would have used. The radio group is left alone: it
draws real inputs and keeps their `required`.

**The two refusals are ordered opposite ways, deliberately.** On the `invalid` path the
browser has already refused, so the sentence goes up before the bubble comes down — a
throw in between would take the browser's words away and put none of ours there. On the
submit path this *is* the only refusal, so the refusal lands before the words are looked
for — a throw there must not let an empty required field through as well as leaving it
unexplained.

**Two corrections went back into the design system rather than being patched around it.**
`.field__guidance` sets `display: block`, which outranks the user agent's `[hidden]`, so an
empty slot would have grown a blank line under every field; and `.field.is-invalid
.field__guidance` turned *every* line the field says signal, which is right for a design
page with one line per field and wrong for a form whose field may carry a declared hint,
the platform's line about commas and a character count at once. Both live in
`design/styles/components/form-controls.css` now, and `design/controls.html`'s invalid
example takes the `--error` modifier that scoping keys on. What stayed in the product is
the one rule about product-only markup: a radio group, a segmented row and a checkbox have
no well for the design to recolour, so the fill goes behind the field instead.

## Findings fixed

Every finding from the two adversarial passes, INFO included.

- **Cancelling `invalid` cancelled the refusal's focus and scroll along with its bubble.**
  The UA acts only on the controls whose event survived, so with every one cancelled it did
  not focus, did not scroll, and did not report — a required field below the fold was
  refused entirely off screen, and the press looked like it did nothing. A pass now ends,
  a microtask later, standing on the first field in the form it marked, which is also what
  gets the sentence announced: it leaves the `aria-live` region in the turn it arrives, a
  turn too early to be read, and what a screen reader hears instead is the field's own
  description, on focus.
- **The submit path failed open.** `markMissingChoices` resolved the sentence *before*
  `preventDefault`, so a capability form somehow missing `data-required-message` threw and
  posted the empty form anyway — the one direction this check must never fail in.
- **Half a relocation was reachable.** A named field with no guidance slot threw partway
  through the loop, leaving earlier fields marked *and* the region still saying the same
  thing. Every slot is resolved before any of them is written to.
- **A refusal that names no field left the last verdict standing.** Half of what lands in
  that region names nothing — a held mutation lease, a record already gone — and one of
  those arriving over a field still saying it is too long left the field describing a
  verdict the server had just not given. Every answer clears the form now, marker or no
  marker.
- **The submit check could take focus off a standing delete confirmation.** The destructive
  question refuses the submit first, in the same capture phase, but `stopPropagation` does
  not stop a second listener on the same node — so an empty required picker in that form
  marked itself and pulled the person off the question's Cancel. A submission already
  refused above this module is now left entirely alone.
- **Three of the six control shapes had no invalid state at all.** A radio group, a
  segmented row and a checkbox have no `.field__control`, which is the only thing the
  design's invalid rule recolours, so the outline half of a refusal simply did not happen
  on them — only the sentence turned red.
- **A repeatable list said it was invalid on its first row only,** while the refusal is
  about the whole list. Every control of the field takes `aria-invalid` now, which is also
  what makes a row added while the field is marked inherit it and lose it with the rest.
- **The `data-error-fields` attribute was the one string in the failure responses not run
  through `escapeHtml`,** and it is the one the client now spends in a selector. It is
  escaped on the way out, checked against `[a-z][a-z0-9_]*` on the way in, and written as
  text on arrival.
- **Four tests proved nothing.** The field-name guard passed with the guard deleted (the
  double's selector parser is lenient where a browser throws); the stash's write-once guard
  passed with the guard deleted, because the case that reaches it is a *radio group*, where
  the browser reports once per radio and the field is marked three times with no clearing
  in between; the error-region gate had no test at all; and "the request is never made"
  asserted a flag rather than asking a listener standing where htmx's does. All four kill
  their mutant now.
- **Two existing assertions had been narrowed to accommodate the new form attribute.**
  `not.toContain("required")` had become `not.toContain(" required>")`, which shipped green
  with an optional field carrying `required` and with a required boolean forced checkable.
  The form's own open tag is cut off instead, which restores the original strength exactly.

## Known seam

A generated Handler's own marked sentence cannot reach this reader yet, so acceptance
criterion 5 is proved for the client half only. The router answers a Handler's fragment
with `c.html(fragment)` at status 200 and no `HX-Retarget`
(`src/router/router.ts`), and both forms are `hx-swap="none"` — so a declared business
error is swapped nowhere, and `record-mutations.js` reads the 200 as a committed create.
This predates the epic and is a defect in the Action response contract rather than in
placement; the relocation is written and tested against the fragment shape a Handler
returns, and turns on the moment that fragment is delivered like the platform's own
refusals.
