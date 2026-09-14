// A refusal speaks where the desk has somewhere to put it (6.6/03, PLAN decision 31).
//
// The sentence is the resolver's own `reject` line, unchanged. What this pins is the placing:
// the prompt bar on a desk standing nothing, the answer window on a desk standing one — because
// an answer left up beside a refusal goes on answering a question nobody asked.
//
// A refusal still opens nothing. `refuseInAnswerWindow` mounting no window is proved next door in
// `desk-answer-window.test.ts`; what is here is the glue's half, run rather than grepped.

import { describe, expect, test } from "bun:test";
import { REFUSE_IN_THE_ANSWER_WINDOW_EVENT } from "#shell/desk-answer-window.js";
import { REJECT_DEFLECTION } from "../../../pipeline/build/admission/deflection.ts";
import { INTENT_RESOLUTION_NARRATION } from "../../../pipeline/intent/index.ts";
import {
  closeStream,
  desk,
  eventAt,
  openStream,
} from "../../../server/app.shell-double.test-support.ts";
import { PROMPT_REFUSAL_ATTRIBUTE, renderRefusedPrompt } from "../../../server/http/index.ts";

const TYPED = "delete everything.";

/** What the bar is actually holding when a refusal lands: the resolver, still working it out. */
const RESOLVING = INTENT_RESOLUTION_NARRATION.trim();

/** The refusal arriving on this run's stream, exactly as `streamDeflection` sends it. */
function refusalArrives(scene: ReturnType<typeof desk>): boolean {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, {
    data: renderRefusedPrompt(TYPED, REJECT_DEFLECTION),
  });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/** A desk with the shell started, the words typed, and this run's stream open. */
function refusing() {
  const scene = desk();
  const shell = scene.startShell();
  openStream(scene);
  scene.promptField.value = TYPED;
  return { scene, shell };
}

/** A prompt submitted the way the bar submits one, which is where a run begins. */
function submitPrompt(scene: ReturnType<typeof desk>) {
  scene.fire("htmx:beforeRequest", {
    detail: { elt: scene.promptForm, target: scene.region },
    preventDefault: () => {},
  });
}

/** Everything the browser does between one rule and the next. */
function settle(scene: ReturnType<typeof desk>) {
  for (const frame of scene.frames.splice(0)) frame();
}

/**
 * An answer window standing here, answering the offer the way the real one does. The module
 * itself needs a window layer and a browser; what the glue reads is only whether it was answered.
 */
function anAnswerIsStanding(scene: ReturnType<typeof desk>) {
  const taken: unknown[] = [];
  scene.root.addEventListener(REFUSE_IN_THE_ANSWER_WINDOW_EVENT, (event: unknown) => {
    taken.push((event as CustomEvent).detail);
    (event as Event).preventDefault();
  });
  return taken;
}

describe("where a refused sentence lands", () => {
  test("a desk standing no answer hears it on the prompt bar, cue and all", () => {
    const { scene } = refusing();

    // The frame is claimed, so htmx never swaps a marked `<div>` into the window region.
    expect(refusalArrives(scene)).toBe(true);

    expect(scene.notice.textContent).toBe(REJECT_DEFLECTION);
    expect(scene.notice.querySelector(`[${PROMPT_REFUSAL_ATTRIBUTE}]`)).not.toBeNull();
    expect(scene.promptForm.classList.contains("is-refused")).toBe(true);
  });

  test("an answer window standing takes it, and the bar is left silent", () => {
    const { scene } = refusing();
    const taken = anAnswerIsStanding(scene);
    // Seeded, because an empty slot would pass this test on its own.
    scene.notice.textContent = RESOLVING;

    expect(refusalArrives(scene)).toBe(true);

    // Said once. A sentence on both surfaces is the desk telling you the same thing twice — and
    // left alone, the bar goes on saying it is still thinking under a window that has answered.
    expect(taken).toEqual([{ refused: TYPED, saying: REJECT_DEFLECTION }]);
    expect(scene.notice.textContent).toBe("");
    expect(scene.promptForm.classList.contains("is-refused")).toBe(false);
  });

  test("the words that were refused are still there, with the keyboard back on them", () => {
    const { scene, shell } = refusing();
    refusalArrives(scene);

    closeStream(scene);
    settle(scene);

    // "Try telling me one thing you'd like to keep track of" beside a field just emptied asks the
    // person for the very thing it took off them, so the try-again is one edit away.
    expect(shell?.promptBusy).toBe(false);
    expect(scene.promptField.value).toBe(TYPED);
    expect(scene.promptField.focused).toBe(true);
    expect(scene.notice.textContent).toBe(REJECT_DEFLECTION);
  });

  test("the window taking it keeps the words too", () => {
    const { scene } = refusing();
    anAnswerIsStanding(scene);
    refusalArrives(scene);

    closeStream(scene);
    settle(scene);

    // Which surface spoke is not the person's business: either way they were told no, and either
    // way what they typed is what they would edit.
    expect(scene.promptField.value).toBe(TYPED);
  });

  test("editing them answers the refusal, and the bar goes quiet", () => {
    const { scene } = refusing();
    refusalArrives(scene);
    expect(scene.notice.textContent).toBe(REJECT_DEFLECTION);

    scene.fire("input", { target: scene.promptField });

    // No timer takes a refusal away: it is about the sentence in the field, and once those words
    // change it is about a prompt that is no longer there.
    expect(scene.notice.textContent).toBe("");
  });

  test("the next sentence starts without the last one's refusal still standing for it", () => {
    const { scene } = refusing();
    refusalArrives(scene);
    closeStream(scene);
    settle(scene);

    // A second sentence, this one not refused: the field is cleared at its close the way every
    // unrefused run's is, or one refusal would keep the bar's words for the rest of the page.
    // A transport reconnect is deliberately not this — it is the same run, and it must not take
    // the refused words away, so the flag is retired where a run starts rather than at an open.
    submitPrompt(scene);
    openStream(scene);
    scene.promptField.value = "track my houseplants";
    closeStream(scene);
    settle(scene);

    expect(scene.promptField.value).toBe("");
  });

  test("a transport reconnect mid-refusal does not take the refused words away", () => {
    const { scene } = refusing();
    refusalArrives(scene);

    // The stream drops and comes back on its own. That is not a new run, and the job it reconnects
    // to has already finished, so the close that follows is the refusal's own.
    openStream(scene);
    closeStream(scene);
    settle(scene);

    expect(scene.promptField.value).toBe(TYPED);
  });

  test("a frame that is not a refusal is left for whatever else reads it", () => {
    const { scene } = refusing();
    const event = eventAt("htmx:sseBeforeMessage", scene.surface, {
      data: '<div data-build-restoration="neutral"></div>',
    });

    scene.fire("htmx:sseBeforeMessage", event);

    // Unclaimed, so htmx still swaps it: the restoration this run owes the desk rides one of
    // these, and a rule that claimed every frame would swallow it.
    expect(event.defaultPrevented).toBe(false);
    expect(scene.notice.textContent).toBe("");
  });
});
