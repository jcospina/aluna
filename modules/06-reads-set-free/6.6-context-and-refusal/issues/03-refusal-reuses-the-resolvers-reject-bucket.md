# A refusal reuses the resolver's `reject` bucket and speaks where it lands

Status: ready-for-agent — the work below is complete and waiting on sign-off

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 31; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

*"Delete everything"* already classifies as `reject`, and
`src/pipeline/build/admission/deflection.ts` already writes a warm line for it. This
issue settles where that line lands and proves the behaviour.

**Amended 2026-09-14 by the owner — the refusal speaks where the desk has somewhere to
put it.** As written, this issue routed the line into the answer window full stop, which
six canonical statements contradicted: `docs/architecture.md`, ADR-0008, `CONTEXT.md`,
`docs/modules.md`, `design/index.html` and this plan's own living-demo step 7 all said a
refusal speaks on the prompt bar. Decision 31 and step 7 disagreed inside one file. The
owner settled it: **the prompt bar when no answer window stands, that window when one
does.** A refusal still opens none, so every one of those statements stays true.

**No second classifier is built.** `docs/modules.md` is emphatic that this path *is never
the safety seam* — decision 6 is, and it lives at the SQLite connection epic 6.2 opened. A
second classifier would be a second thing to drift from the resolver's own judgment, and it
would invite the belief that refusing is what keeps the user safe. Nothing added here may
sit between a question and the loop as a gate.

**The refusal is warm, and it is Aluna's** (ADR-0001). The existing `reject` sentence is
reused unchanged; this issue moves where it lands, not what it says.

**It behaves like every other answer window message.** One replaceable message, the prompt
preserved, focus kept, cleared on edit — 6.5/01's contract, applied to a refusal that now
arrives from the query path.

## Acceptance criteria

- [x] A `reject`-classified prompt speaks its existing warm line in the answer window
      when one is standing, and on the prompt bar when none is
- [x] The sentence itself is unchanged from what `deflection.ts` writes today
- [x] No new classifier, filter or rule sits between a question and the loop
- [x] A refusal preserves the typed prompt and focus, and clears on edit
- [x] A refused prompt opens no query scope, starts no worker and writes no
      metrics beyond the resolver row that already exists
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 7, rewritten for the amendment. With the answer window from
step 6 still standing, type *"delete everything."* and read the refusal in that window,
re-titled to what you typed. Dismiss it and type the same thing again: this time the
refusal is on the prompt bar, with its flash. Both times the words are still in the field
to edit, and nothing opened, ran or was written.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/02-where-would-this-live-the-loop-looks-before-it-says-there-is-no-home.md

## What landed

The resolver's own `reject` verdict now decides the sentence, and the desk decides the
surface. Nothing classifies anything twice, and a refusal still opens no window.

- **The server marks the sentence and stops there.** `streamDeflection` sends no
  `#prompt-notice` for a `reject`; it sends `renderRefusedPrompt(prompt, saying)` on a frame
  of its own, carrying the refused words in `data-refused-prompt` and Aluna's line as text.
  Its own frame rather than riding the restoration's, because the desk cancels the swap of
  whatever frame carries a refusal — the capability this prompt was typed in front of would
  be swallowed with it.
- **The desk places it, because only the desk knows what it is holding.** The answer window
  lives in the browser and the server has no record of it (it remembers nothing, by design).
  Deciding at the moment the sentence lands also closes the race a submit-time flag would
  open: a window dismissed during the two-to-four-second classification beat would leave the
  server's guess wrong and the sentence nowhere.
- **The offer is cancellable, and that is the whole protocol.**
  `REFUSE_IN_THE_ANSWER_WINDOW_EVENT` carries the words and the sentence;
  `refuseInAnswerWindow` answers it by calling `preventDefault` when a window took it. An
  unanswered offer is how the glue learns there was none, and the bar speaks.
- **The window is re-titled and brought forward.** What it was holding answered a question
  this sentence is not, and leaving it there leaves the desk answering something nobody
  asked — which is what the live desk did before this issue, and the clearest argument for
  the owner's rule. It is not raised for show: behind a capability window the refusal would
  be invisible, and the bar stays silent precisely because a window took it.
- **`abandoned` is cleared with it.** A refusal that cancels a running question owns the
  window now, so the question it interrupted stops deciding the window's fate. Without this
  the close would dismiss the only place the sentence was said.
- **The typed words survive a refusal, which they did not before.** `prompt-bar.js` has
  always said that "asking someone to try again beside a field just wiped takes back what it
  asks", but the shell's wake emptied the field at every close with no held ending. A
  refusal now keeps them and the keyboard, and the flag saying so is retired where a run
  begins — the prompt's own request — rather than at a stream open, because a transport
  reconnect is the same run and must not take the words away.
- **`public/app.js` was at its 500-line ceiling**, so five statements were compressed to buy
  room: `shouldPreserveRestoration`'s five-parameter signature and its eight-term boolean
  chain, three `dispatchEvent(new CustomEvent(…))` wrappers, `preserveActiveView`'s two
  wrapped calls, and the retire helper, which now reads the answer `dispatchEvent` already
  returns. None changed behaviour.

## Findings

Two review agents, adversarial and standards, both on the SOTA model. Every finding is
fixed except one, which is recorded below with the reason and filed as its own task.

**Found by the live desk, before either agent**

- **The prompt bar was left saying "I'm sorting out…" for ever** when the window took the
  refusal. The deflection had stopped sending a notice for a `reject`, so nothing replaced
  the resolver's sentence: the desk sat under an answered window still claiming to be
  thinking. The glue now tells the bar either way — the sentence, or the empty string that
  retires one. No test could have caught it: the double's `#prompt-notice` starts empty, so
  the assertion passed vacuously. It is seeded now.

**Fixed**

- **The attribute escape was unpinned** (MAJOR). `renderRefusedPrompt` interpolates the
  person's words into an attribute, and every test of the path used a benign prompt — delete
  `escapeHtml` and the suite stayed green. Three cases now mirror
  `renderAnswerWindowOpening`'s: break-out, markup in the sentence, and truncate-after-escape.
- **`expect(GLUE).toContain("cancelable: true")` pinned nothing** (MAJOR, raised by both
  agents). `public/app.js` already carries that exact string for the retire-the-run-sentence
  event. Drop it from the offer and the sentence is said in the window *and* on the bar. The
  whole statement is pinned now.
- **The server's `prompt` wire was unpinned** (MAJOR). The test asserted the bare attribute
  name, so `prompt: ""` would have passed while the window re-titled to nothing. It asserts
  the value now, the way the question path already does.
- **A transport reconnect wiped the refused words** (MINOR). The flag was retired on
  `htmx:sseOpen`, one line below a comment saying a reconnect is not a new run. It is
  retired on the prompt's own request now, and a test holds the reconnect case.
- **Three tests survived a full revert of what they claimed to pin** (MINOR): the notice was
  empty before the edit as well as after; a non-refusal frame's bar silence held with the
  whole rule deleted, and the claim — that the frame is left unclaimed — was computed and
  discarded; and the second-run case never modelled a second run.
- **A duplicated constant and a dead assertion** (MINOR) in the seam tests: the attribute
  was hard-coded two lines below an interpolated sibling, and an assertion about the
  *opening* mark had survived from the test this one replaced.
- **A value import into a hub** (MINOR). `renderRefusedPrompt` came from the
  `server/http/index.ts` barrel; its sibling in the same function deliberately reaches the
  leaf. Same fix.
- **An ordering comment asserted a reason the code does not have** (MINOR): `preserve` and
  `refused` can never both be true, so the order is not what the separation buys. The comment
  says what it does buy.
- **The naming asserted a destination the fragment does not have** (MINOR).
  `data-answer-refusal` sat beside `data-prompt-refusal` and read exactly backwards — the
  *prompt* one only ever lives on the bar, and the *answer* one may end up there. It is
  `data-refused-prompt` / `REFUSED_PROMPT_ATTRIBUTE` / `renderRefusedPrompt` now, naming the
  sentence rather than a surface. `refuseFrom` became `placeTheRefusalFrom`, which is what
  the desk does and what its three siblings are named for; Aluna had already refused.
- **A comment stated the inverse of a newly pinned behaviour** (MAJOR, standards). The
  stale-window rule still said it is reached when the replacing sentence "was a build or was
  turned down"; a refusal is now exactly the case that does not reach it.
- **`createPanel` → `panel` was the one gratuitous compression** (MINOR) — it saved a line
  and left `createIsClosed` beside it with no antecedent. Reverted, and the line bought back
  from the retire helper instead.
- **Two more documents were false and were not on my list** (MAJOR, standards):
  `CONTEXT.md`'s *Prompt bar* entry, and PLAN decision **23** — the decision most directly
  contradicted, which is where the amendment now sits.
- **The shell double lied about the browser three times**, each found while writing a test
  that should have passed: `dispatchEvent` always returned `true`, so a cancelled event read
  as uncancelled; the fragment parser never decoded HTML entities, so every sentence came
  back escaped from a slot a person reads plainly; and `replaceChildren()` left the node's
  own text standing, so a cleared slot went on answering with what it had held.
- **A quotation was lowercased and clipped as if it were verbatim** (INFO) in a comment.

**Recorded rather than fixed**

- **`REJECT_DEFLECTION` uses straight apostrophes** where `ANSWER_WINDOW_OPENING`, which it
  now shares a window frame with, uses typographic ones (INFO, raised by both agents). Not
  fixed here for two reasons: acceptance criterion 2 freezes this sentence, and the split is
  systemic rather than local — the whole of `deflection.ts` and `resolver.ts` are straight
  while `fragments.ts` and `app.js` are curly, so changing one line would leave its own file
  inconsistent. Filed as its own task, to be swept in one pass with the owner's call on
  direction.
- **`design/index.html:1189` is not edited.** Its line — *"Anything rejected before a build
  starts speaks on the prompt bar instead"* — sits inside a struck-through, closed row about
  build outcomes, and records what M5 settled about a desk that had no third window. `design/`
  is the PRD and the house rule is to ask rather than converge, so it is the owner's call
  whether that closed row gains a line.

## Verification

`bun run test`, `bun run typecheck` and `bun run lint` clean.

Nine mutations, each reverting one behaviour and each caught: the server never marking a
`reject`, the glue telling the bar whatever the window answered, the bar not being cleared
when the window takes it, a refusal no longer keeping the words, `refuseInAnswerWindow`
mounting a window when none stands, the window keeping the old question's title, the
refusal not coming forward, and the interrupted question still deciding the window's fate.
The last two were unpinned when first written and have tests because the mutation said so.

### The live round-trip

Against the real model on the real desk — nine capabilities — through the prompt bar on
`:3030`.

| Done | Seen |
| --- | --- |
| Typed *"delete everything."* on a desk standing nothing | The warm line on the prompt bar with its refusal mark and flash, no window opened, and the words still in the field |
| Typed one more character | The sentence cleared on the edit, the words kept |
| Asked *"how many houseplants do I have?"*, then typed *"delete everything."* | The refusal in that window, re-titled *delete everything.*, brought forward; one window, the bar silent, the words still in the field |
| Asked a long cross-capability question and refused it mid-flight | The question cancelled, the window taking the refusal rather than going down with the run, and nothing reported |

**The third row is what the amendment was for.** Before this issue the same sequence left
*"You have 22 houseplants."* standing in the window while the bar refused something else —
an answer to a question nobody had asked, beside a refusal of the one they had.
