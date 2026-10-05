# A name in the answer opens its record

Status: done

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
hold. The answer window stays open, and the capability window comes forward on every desk
(owner ruling 2026-10-05; this read "on a phone" until then).
A modified or middle press is left to the browser, so the record opens in a new tab
through 7.5/02. When a record was deleted after the answer, the prompt bar says 7.5/02's notice.

**It looks like `design/`.** The link is ink and an underline and takes the one focus
ring, as D14 says (7.5/01 drew no states of its own). Any rule it needs goes in the answer
window's existing stylesheet, because `public/css` is full.

## Acceptance criteria

- [x] Linked names render as links inside the sentence; every other word is text, with
      line breaks kept
- [x] A press opens that record in the capability window and pushes its address; Back
      returns to what the window held before
- [x] Cmd-press and middle press open the record in a new tab
- [x] Unsaved changes in an open record ask before a press replaces it; a running build
      holds the press
- [x] A fragment whose anchor carries a foreign, `javascript:` or malformed `href`, or
      extra attributes, renders as text, because the window never reads `href`
- [x] The answer window still has no address and remembers nothing across a reload
- [x] Desktop and phone layouts match `design/` in light and dark
- [x] An adversarial pass on the glue, the anchor builder and the policy loosening is
      clean
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, ask "which teas did I rate five?". Each tea's name in the answer is a link.
Press one: its record opens in the window, and the bar shows its address. Cmd-press
another: it opens in a new tab.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/03-opening-a-record-moves-the-address.md
- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/04-aluna-names-the-records-an-answer-is-about.md

## What landed

**The glue reads runs, not markup.** `public/app.js` still parses the fragment inside an inert
`<template>`, and now hands the parsed `[data-answer-saying]` node across the event rather than its
text. `app.js` is a classic script and can import nothing, so the reading lives in
`public/desk/window/answer-runs.js`, which the answer window's listener calls before it draws.
`answerRuns` turns the node into a plain list of runs. Each run is either words or a name with a
capability id and a record id. An anchor becomes a name only when it is exactly what the platform
writes:

- `data-answer-record=""` and `href`, and no other attribute;
- text alone inside it;
- an `href` that matches `/capability/<[a-z][a-z0-9_]*>/<uuid>` whole.

Anything else reads as the words it shows. A `<br>` reads as a line's end, and a comment reads as
nothing. Only the two ids survive the read. The reader does read the wire's `href` to recover them,
since the anchor carries them nowhere else (PLAN decision 47). The criterion's "the window never
reads `href`" holds for the window, which never takes one from the wire or reads its own back.

**The window builds anchors itself.** `drawn` in `desk-answer-window.js` writes words as text and
builds each name with `createElement("a")`, `textContent` and `href = recordAddress(...)`. It first
checks the ids again with `isAddressableRecord`, now the one validator in `public/core/routes.js`.
A `WeakMap` keeps the ids each link names, so a press never reads an `href`. No CSS was added:
`design/styles/base.css` already gives every link ink, an underline and the one focus ring, and
D14 says the link has no states of its own. `tokens.css` has no dark theme, so light and dark are
the same tokens.

**A press opens the record.** A plain press (main button, no key) is prevented and sent as
`aluna:open-the-record` with the two ids. `desk-address.js` answers it in `takeRecordAddress` with
the desk's own `hold` and `render`, the pair Back and Forward use. The press is held under the leave
question and the run hold. Otherwise it pushes the record address, renders it, and brings the
capability window forward (`bring`). The outcome goes back on the event:

- `opened`. The record's window is in front on every desk. Whatever held focus at the press lets
  go: the link, or the bar or a field of the record being left, which a browser like Safari leaves
  focused. The record's first field takes focus as it lands. Where the record was already open and
  nothing will land, the answer's `landed` callback focuses it. `focusLanded`, now shared from
  `shell-dom.js`, focuses only inside the window in front. *Since 7.5/06:* a record already open,
  with no run in its window and no question standing, is brought forward and focused before any
  event goes out, so its unsaved changes are kept and nothing is asked.
- `held`. The window holding the question comes forward, and `landed` runs once a yes opens the
  record. *Since 7.5/06:* the record's first field takes focus as it lands.
- `gone`. The capability has left the desk (`knows`). Nothing is pushed or put away. The name turns
  into words, and the bar says 7.5/02's not-found sentence, restated as `RECORD_NOT_THERE` and
  pinned to the server's `NOT_FOUND_NOTICE`.

A modified, middle or secondary press is left to the browser, which opens the record address in a
new tab through 7.5/02. A record deleted after the answer takes 7.5/02's path: a 404, the notice on
the bar, and the address corrected to its collection.

**Along the way:**

- The 404 fallback in `addressed-window.js` asks for the collection in the window it already
  opened, instead of opening it again. Opening it again raised it over whatever the person had
  brought forward since.
- `renderAnswerWindowSaying` skips a link whose offsets are not whole numbers.
- The record-address desk harness moved to `record-address-desk.test-support.ts`. It now waits for
  requests to settle rather than a fixed 10 ms, which a loaded machine overran. That flake also
  reproduced on the untouched base.
- The answer window's policy allows exactly one anchor site, with its `href` from `recordAddress`
  alone. It also lists every call that puts something on the page. A second set of sweeps reads Bun's
  real parse, so a string holding a comment marker cannot hide code from them.

## Findings

- **Spec and standards review (Opus), 17 items, all addressed:**
  - seam tests for links and forged anchors through the real `app.js`;
  - a stale seam test probing a key nothing reads;
  - one shared id validator;
  - JSDoc wording;
  - a real middle-button case;
  - desk tests for unsaved changes and a gone capability;
  - a brittle import pin;
  - a hand-split fixture;
  - long comment lines;
  - test nits.
- **Adversarial round 1 (Opus), 11 findings, all fixed:**
  - a press raising the capability window over the answer on desktop, against PLAN decision 48's
    "on a phone" (MED-HIGH);
  - focus left on a buried link;
  - policy bypasses through `Object.assign`, variable tag and attribute names, node adoption and
    navigation;
  - a press into a gone capability putting away an unrelated window;
  - the reader throwing on a malformed detail;
  - `<br>` losing its break;
  - the press event depending on its root being `document`;
  - NaN offsets in the server fragment;
  - the anchor guard not pinned;
  - the address-wide raise on traversals;
  - page scripts dispatching the event (ids are validated, so the worst case opens a real record).
- **Adversarial round 2 (Opus), 8 findings, all fixed:**
  - focus landing in the window behind after a press on an answer standing behind;
  - the 404 fallback burying the answer;
  - a second press while the leave question stands hiding the question;
  - nine more policy bypasses (`.bind`, computed member names, URL-part setters, `new Image`,
    `setAttributeNode`, comment markers in strings and others);
  - the front window and focus disagreeing after a yes;
  - focus dropping to `<body>` on a gone name;
  - a cached phone flag going stale;
  - a gone name staying words after its capability comes back, which the next answer redraws.
- **Owner ruling after the first sign-off look (2026-10-05).** The answer had stayed in front on
  desktop, read from PLAN decision 48's "on a phone the capability window comes forward". The owner
  pressed a name and found the record behind the answer: the press asks to see the record, so its
  window comes forward on every desk. PLAN decision 48 and ADR-0010 now say so. The desktop re-raise
  is gone, and focus goes to the record's first field. The 404 fallback still reuses its window, so
  a slow 404 does not raise it over a window the person brought forward in the meantime.
- **Adversarial round 3 (Opus), on the ruling's change, 5 findings, all fixed or recorded:**
  - focus landing in the record being left while the pressed one was still loading, so typing there
    was thrown away;
  - focus landing in a window the person had put behind before the record arrived;
  - Safari-like browsers leaving focus in the bar;
  - focus on `<body>` after "Keep editing", which now goes back to the kept form's first field;
  - focus after a yes, recorded below.
  - Also noted for sign-off: at 1200×800 the record's window covers the centred answer, so the
    other names are out of reach until it is moved or the answer is pressed forward.
- **Choices recorded.**
  - After a yes on the leave question, focus lands on the prompt bar on every desk, as after every
    confirmed navigation (`settleFocus`, pinned in `leaving-a-run.wiring.test.ts`). *Reversed by
    the owner on 2026-10-05 in 7.5/06:* a yes on a pressed name now leaves focus to the opened
    record's first field, as decision 48 says.
  - A gone capability speaks the not-found sentence rather than new copy.

## Verification

- `bun run typecheck` and `bun run lint` are clean.
- `bun run test`: 4,925 tests, all green, on the final code after the owner's ruling. An earlier
  run under heavy load from another program failed three timing tests: two in files this issue does
  not touch, and the record-address flake, now fixed.
- Each new guard was mutated by hand, and each mutant failed a test:
  - the link's own focus;
  - the 404 fallback reusing its window;
  - nine policy bypasses;
  - after the ruling: the landed-record check, the front-window focus guard, the blur at the press
    and the kept form's refocus.
- No test calls the real provider.
- **Live on `:3030`**, with synthetic answer events and no model calls:
  - links drawn in ink with an underline inside the sentence, line breaks kept;
  - a `javascript:` anchor shown as text;
  - a plain press pushing the record address and opening the record;
  - Back walking to the earlier record, then to the bare desk with the answer still standing;
  - the unsaved-changes question before a press, with "Leave without saving" opening the record;
  - Enter on a focused link;
  - the one violet focus ring (3 px, offset 2 px);
  - the phone layout: the record's window in front, focus on its first field, and the same when the
    record was already open;
  - a deleted record giving the notice and its collection;
  - a gone capability unlinking the name with the notice;
  - the answer staying in front through three presses on desktop.
- **Headless Chrome over CDP:** a Cmd-press and a middle press each open a new tab at the record
  address while the page keeps its answer. The Browser pane turns a new-tab request into a same-tab
  load, so it cannot show this.
- **After the ruling, live:** asking puts the answer on top of an open record, and pressing a
  name puts that record on top with its first field focused. Pressing a second name from a
  re-asked answer did the same.
- **One real question**, "which teas did I rate four or five?". It answered with seven teas, each a
  link whose id matched that tea's record in the database. Pressing "Jin Jun Mei" opened it with
  the answer still in front. After a reload the record stayed open and the answer was gone, with
  nothing stored.

