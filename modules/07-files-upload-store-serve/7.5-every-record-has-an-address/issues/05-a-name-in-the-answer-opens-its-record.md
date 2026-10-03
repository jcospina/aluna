# A name in the answer opens its record

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 47 and 48; ADR-0010: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

7.5/04 sends the answer with linked names, and the answer window still writes it as plain
text. This issue draws the links as `design/` shows them and makes a press open the
record.

**The glue reads runs, not markup.** The SSE handler stops reducing the saying to
`textContent`. It reads the fragment's text runs and `data-answer-record` anchors into a
plain list: text, or a name with a capability id and a record id it validates. It hands
that list to the answer window. `app.js` is near its ceiling, so the reading lives in a
module of its own.

**The window builds anchors itself.** `desk-answer-window.js` writes each text run with
`textContent`. It builds each link with `createElement("a")`, `textContent` and an `href`
from `recordAddress()` in `routes.js`, the one place a record address is spelled. It
never parses markup and never takes an `href` from the wire. The window's policy loosens
by exactly that: one anchor-building site, `href` only from `recordAddress()`, and every
other element and sink still banned.

**A press opens the record.** A plain press takes 7.5/03's path: push the record
address, then open it in the capability window, under the leave question and the run
hold. The answer window stays open, and on a phone the capability window comes forward.
A modified or middle press is left to the browser, so the record opens in a new tab
through 7.5/02. A record deleted since the answer gives 7.5/02's notice.

**It looks like `design/`.** The link states are the ones 7.5/01 drew, in the answer
window's existing stylesheet, because `public/css` is full.

## Acceptance criteria

- [ ] Linked names render as links inside the sentence; every other word is text, with
      line breaks kept
- [ ] A press opens that record in the capability window and pushes its address; Back
      returns to what the window held before
- [ ] Cmd-press and middle press open the record in a new tab
- [ ] Unsaved changes in an open record ask before a press replaces it; a running build
      holds the press
- [ ] A fragment whose anchor carries a foreign, `javascript:` or malformed `href`, or
      extra attributes, renders as text, because the window never reads `href`
- [ ] The answer window still has no address and remembers nothing across a reload
- [ ] Desktop and phone layouts match `design/` in light and dark
- [ ] An adversarial pass on the glue, the anchor builder and the policy loosening is
      clean
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, ask "which teas did I rate five?". Each tea's name in the answer is a link.
Press one: its record opens in the window, and the bar shows its address. Cmd-press
another: it opens in a new tab.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/03-opening-a-record-moves-the-address.md
- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/04-aluna-names-the-records-an-answer-is-about.md
