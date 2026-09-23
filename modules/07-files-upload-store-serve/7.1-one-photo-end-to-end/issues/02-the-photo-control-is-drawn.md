# The photo control is drawn

Status: ready-for-agent

Type: HITL — `design/` is the product requirement, and the file control has never been
drawn. A human signs off the drawn states before 7.1/08 builds them.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN §"Design work this module owes", decisions 16 and 19; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

`design/controls.html` says a file field "is the one absence left, and it is not a gap."
This issue removes that note and draws the control for a field that accepts images. The
plan requires the image states to land with or before 7.1's control. The other kinds come
in 7.2/01, and the leave question for a held upload comes in 7.3/03.

**The states.** Draw each state in create and in edit:

- the empty field
- the filled field, with the photo's preview
- the progress line while an upload streams
- a refusal shown in the field

Draw two refusals: a file that is not an image, and a file over the size cap. The filled
field carries replace and clear actions. Clearing is the only way a person empties a file
field (decision 16), so it is its own action. While any upload is in flight the form
cannot be saved (decision 19), and the page shows how that looks.

**Shape follows what is already drawn.** The control uses the existing field structure,
the token layer and the drawn line; it invents no border, radius or shadow of its own.
The list-of-strings field is the nearest precedent for a field with actions. The card
that shows a photo belongs to the generated item renderer and its `.media-frame`, not to
this page.

**The refusal sentences are product copy.** They follow the product voice (ADR-0001) and
`docs/prose-guidance.md`, and this page is where their wording is settled.

`design/styles/components/form-controls.css` is at its 500-line ceiling, which
`layout-kit.test.ts` asserts. Any line this control adds is paid for by compressing
something next to it.

## Acceptance criteria

- [ ] The "one absence left" note is gone from `design/controls.html`, replaced by the
      drawn control
- [ ] Empty, filled-with-preview, progress and refusal-in-field states are drawn for an
      image field, in create and in edit
- [ ] The filled field shows replace and clear, and the held save during an upload is
      drawn
- [ ] The control uses the token layer and the drawn line and adds no boundary styling of
      its own
- [ ] `form-controls.css` stays within its ceiling
- [ ] **Sign-off gate:** the human has seen every state on the page and approved the
      shape and the refusal sentences
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open `design/controls.html` in a browser and find the file field under the field
controls. Every state listed above is on the page, and the old note is not.

## Blocked by

None - can start immediately.
