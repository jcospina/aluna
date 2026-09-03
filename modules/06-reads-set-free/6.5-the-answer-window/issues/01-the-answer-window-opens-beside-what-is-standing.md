# The answer window opens beside what is already standing

Status: ready-for-agent

Type: HITL — the window's title and its empty/opening state are authored product voice,
and the three-window desk is the first thing the user meets that Module 5 did not
describe. Sign-off is on how it reads and behaves, not on the code.

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decisions 21, 22, 23, 25; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A third window. It opens for a question, and it displaces nothing.

**It is a new caller of machinery that already exists** (decision 21).
`public/desk-window.js` already exports `openWindow`, `dismissWindow` and `nameWindow`,
and the developer panel is already a second window standing beside the capability
window. This issue adds the third on that precedent — not a new surface
primitive, not a window manager, and not a fourth.

**The capability window and the developer panel stand exactly as they were.** Opening an
answer must not put away, displace, resize, re-title or restore either of them. That is
the entire point: the user asks about the recipes they are looking at, and keeps looking
at them.

**M5's one-window rule is superseded here** (decision 21), and Module 5's files are not
edited to say so. The record of the change is the plan, ADR-0008, `architecture.md` and
`CONTEXT.md`, all of which already carry it.

**One answer window, and a new question replaces its content in place** (decision 25).
The frame is never closed and reopened between questions — no flicker, no re-placement,
no re-entrance. Only what it holds changes, which is the swap the window layer already
performs when a second capability is opened. Because it never closes it stays where the
user left it, so nothing about its position needs storing. Answers must not accumulate
and a second answer window is never created.

**It opens on classification, not on submit** (decision 23). The window appears once the
resolver returns `data_query`. A `reject` opens no window at all and speaks in
`#prompt-notice` exactly as it does today — M5's decision 24 and its notice contract are
left untouched, and this issue must not alter either.

**It has no logo on the desk and is dismissed, not put away** (decision 21). A capability
window can be put away because its logo is the way back, and the developer panel has its
tile; an answer has neither, because closing it destroys the answer and there is nothing
to return to. It uses `dismissWindow`, never `putAway`. The logo layer keeps meaning
exactly one thing — the capabilities the user has.

**Nothing here waits on the pet** (decision 22). No anchor, no placeholder slot, no
reserved space for a future companion.

Where the window sits when it first opens, how it is titled and how it looks are
presentation decisions for the sign-off gate, not specified here — except that it must
obey the same desk constraints every window obeys, including `--prompt-clearance`.

## Acceptance criteria

- [ ] A question opens a third window; the capability window and the developer panel are
      untouched in position, size, title and content
- [ ] The capability open before the question is still open, still showing the same
      content, after the answer arrives
- [ ] A second question replaces the standing window's content in place; the frame is
      not closed, reopened, re-placed or re-animated, and a second window is never created
- [ ] A window the user has dragged or resized is exactly where and as they left it after
      the next question answers
- [ ] A prompt classified `reject` opens no window and speaks in `#prompt-notice`
- [ ] `#prompt-notice` behaviour is byte-for-byte unchanged for every message it carries
      today
- [ ] The answer window obeys `--prompt-clearance` and every other desk geometry rule
- [ ] No logo, tile or address for the answer window appears anywhere on the desk
- [ ] Dismissing it leaves no route back to the answer it held
- [ ] Below the 720px breakpoint the window is the screen, as every window is; no
      phone-specific behaviour is added
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030`, build Notes, and open it. Ask a question:
a second window appears and Notes is still open behind it, unchanged. Drag it somewhere,
then ask another question: the same frame stays exactly where you put it and only its
contents change. Open the developer panel and
confirm three windows coexist. Dismiss the answer and confirm the desk offers no way back
to it. Then type "delete everything" and confirm no window opens and the refusal speaks on
the prompt bar.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/05-when-nothing-can-answer-she-names-the-gap-and-stops.md
