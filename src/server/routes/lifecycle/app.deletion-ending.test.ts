import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { DELETION_RECHECK_ASKING } from "#shell/desk/logos/capability-deletion.js";
import {
  DELETION_ENDING_ATTRIBUTE,
  DELETION_EXIT_ATTRIBUTE,
  DELETION_SENTENCE_ATTRIBUTE,
  renderCapabilityDeletionConfirmation,
  renderCapabilityDeletionPreCommitFailure,
} from "../../../lifecycle/deletion/index.ts";
import { notesRow } from "../../../runtime/router/dispatch/router.test-support.ts";
import { desk, El, Template } from "../../shell-glue/app.shell-double.test-support.ts";

// The deletion that did not happen, run rather than grepped. `public/desk/logos/capability-deletion.js` is a
// module of the desk, so it runs on the same document double the shell's own glue is proved on.
const { rescueCapabilityDeletionEnding, startCapabilityDeletionRecovery } = await import(
  "#shell/desk/logos/capability-deletion.js"
);

const SENTENCE = "I couldn’t delete Notes. Everything you had there is still safe.";

/** The ending exactly as the server writes it, parsed into the double the way a swap is parsed. */
function endingIn(region: El): El {
  const swapped = new Template();
  swapped.innerHTML = renderCapabilityDeletionPreCommitFailure(notesRow(), { kind: "neutral" });
  const ending = swapped.content.querySelector(`[${DELETION_ENDING_ATTRIBUTE}]`);
  if (!ending) throw new Error("the server wrote no deletion ending");
  region.append(ending);
  return ending;
}

/** What the prompt bar is left saying, children and all. */
function spoken(stage: ReturnType<typeof desk>): string {
  return stage.notice.textContent.trim();
}

function scene() {
  const stage = desk();
  // The run the double stands up by default is not this subject: a deletion only ever
  // fills a window no run is using (PLAN decision 20, and the desk-furniture rule).
  stage.subscriber.remove();
  startCapabilityDeletionRecovery(stage.root as never);
  return stage;
}

let frames: Array<() => void>;
/** What the page had before this suite lent it a frame clock, put back exactly after each test. */
const hadFrames = Reflect.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");

beforeEach(() => {
  frames = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    frame: () => void,
  ) => {
    frames.push(frame);
  };
});

afterEach(() => {
  if (hadFrames) Object.defineProperty(globalThis, "requestAnimationFrame", hadFrames);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});

describe("a deletion that did not happen", () => {
  test("the ending takes the keyboard by its own sentence when it lands", () => {
    const stage = scene();
    const ending = endingIn(stage.region);

    stage.fire("htmx:afterSwap", { detail: { target: stage.region } });
    for (const frame of frames.splice(0)) frame();

    // The sentence is the focus target and the ending's accessible name, one element for both.
    const sentence = ending.querySelector(`[${DELETION_SENTENCE_ATTRIBUTE}]`);
    expect(sentence?.focused).toBe(true);
    expect(sentence?.getAttribute("tabindex")).toBe("-1");
    expect(ending.getAttribute("aria-labelledby")).toBe(sentence?.id ?? null);
    expect(sentence?.textContent).toBe(SENTENCE);
  });

  test("dismissing it hands the keyboard back to the desk and says nothing twice", () => {
    const stage = scene();
    const ending = endingIn(stage.region);
    const dismiss = ending.querySelector(`[${DELETION_EXIT_ATTRIBUTE}]`);
    if (!dismiss) throw new Error("the ending shipped without a way out");

    stage.fire("click", { target: dismiss });
    expect(stage.promptField.focused).toBe(true);

    // The sentence is read once its answer is about to land. Releasing the panel afterwards must
    // not repeat it on the prompt bar, which is where an unread one goes.
    stage.fire("htmx:beforeSwap", { detail: { requestConfig: { elt: dismiss } } });
    expect(ending.getAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(null);
    stage.fire("htmx:beforeCleanupElement", { target: ending });
    // `textContent`, not `ownText`: the bar writes a sentence as a child element, so
    // `ownText` is the empty string whether or not anything was said.
    expect(spoken(stage)).toBe("");
  });

  test("a dismissal whose answer never lands leaves the sentence still owed", () => {
    const stage = scene();
    const ending = endingIn(stage.region);
    const dismiss = ending.querySelector(`[${DELETION_EXIT_ATTRIBUTE}]`);
    if (!dismiss) throw new Error("the ending shipped without a way out");

    stage.fire("click", { target: dismiss });
    // A refused or severed request swaps nothing, so the ending is still standing and
    // still unread. Spending the sentence on the press would have lost it here.
    stage.fire("htmx:beforeSwap", {
      detail: { shouldSwap: false, requestConfig: { elt: dismiss } },
    });
    expect(ending.getAttribute(DELETION_ENDING_ATTRIBUTE)).toBe("");

    stage.fire("htmx:beforeCleanupElement", { target: ending });
    expect(spoken(stage)).toBe(SENTENCE);
  });

  test("a window torn down over an unread ending carries the sentence to the prompt bar", () => {
    const stage = scene();
    const ending = endingIn(stage.region);

    rescueCapabilityDeletionEnding(ending as never, stage.root as never);

    expect(spoken(stage)).toBe(SENTENCE);
    // Carried as the ending it already was: the bar's refusal cue belongs to a sentence
    // arriving for the first time, and this one had the window and the keyboard.
    expect(stage.notice.querySelector("[data-prompt-refusal]")).toBe(null);
    // Once carried, it is spent: a second teardown of the same panel says it again only
    // if the mark is still on, and it is not.
    expect(ending.getAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(null);
  });

  test("backing out and committing hand the keyboard back the same way a dismissal does", () => {
    // The confirmation's two controls carry the same mark the ending's does, so all three
    // ways out of a deletion have one answer rather than three (`DELETION_EXIT_ATTRIBUTE`).
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);
    expect(html.split(DELETION_EXIT_ATTRIBUTE).length - 1).toBe(2);

    for (const control of ["keep", "commit"]) {
      const stage = scene();
      const pressed = new El("button", { [DELETION_EXIT_ATTRIBUTE]: "", "data-face": control });
      stage.region.append(pressed);

      stage.fire("click", { target: pressed });

      expect(stage.promptField.focused).toBe(true);
    }
  });

  test("a confirm the desk itself interrupted is chased down rather than left silent", () => {
    const stage = scene();
    const confirm = new El("form", {
      "data-capability-deletion-confirm": "/capability-deletion/notes",
    });
    stage.region.append(confirm);

    // Putting the window away releases the region's scope, aborting the request its content
    // started. The abort is the browser's alone, so an aborted confirm fires no swap event at all.
    stage.fire("htmx:sendAbort", { detail: { elt: confirm } });

    expect(spoken(stage)).toBe(DELETION_RECHECK_ASKING);
  });

  test("a swap that is not a deletion leaves the keyboard and the bar alone", () => {
    const stage = scene();
    const elsewhere = new El("button", { class: "capability-collection__new" });
    stage.region.append(elsewhere);

    stage.fire("click", { target: elsewhere });
    stage.fire("htmx:afterSwap", { detail: { target: stage.region } });
    for (const frame of frames.splice(0)) frame();

    expect(stage.promptField.focused).toBe(false);
    expect(spoken(stage)).toBe("");
  });
});
