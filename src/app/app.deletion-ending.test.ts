import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DELETION_ENDING_ATTRIBUTE,
  DELETION_EXIT_ATTRIBUTE,
  DELETION_SENTENCE_ATTRIBUTE,
  renderCapabilityDeletionConfirmation,
  renderCapabilityDeletionPreCommitFailure,
} from "../capability-deletion/index.ts";
import { notesRow } from "../runtime/router/dispatch/router.test-support.ts";
import { desk, El } from "./app.shell-double.test-support.ts";

// The deletion that did not happen, run rather than grepped. `public/capability-deletion.js`
// is a module of the desk, so it is started on the same document double the shell's own
// glue is evaluated against: the ending, the prompt bar it falls back to and the window it
// holds are one desk, and a rule proved apart from them is proved against nothing.
const { focusCapabilityDeletion, rescueCapabilityDeletionEnding, startCapabilityDeletionRecovery } =
  await import("#shell/capability-deletion.js");

const SENTENCE = "I couldn’t delete Notes. Everything you had there is still safe.";

/**
 * The ending exactly as the server writes it, rebuilt as nodes the double can hold. One
 * element carries the sentence, the focus mark and the accessible name, because that is
 * what `renderCapabilityDeletionEnding` emits — a fixture with a heading beside the
 * sentence would prove focus lands on a node the product does not have. The test below
 * pins this against the real render rather than trusting the copy.
 */
function endingIn(region: El): El {
  const sentence = new El("p", {
    class: "capability-deletion__ending",
    id: "capability-deletion-ending",
    tabindex: "-1",
    "data-capability-deletion-focus": "",
    [DELETION_SENTENCE_ATTRIBUTE]: "",
  });
  sentence.ownText = SENTENCE;
  const dismiss = new El("button", { [DELETION_EXIT_ATTRIBUTE]: "" });
  const ending = new El("section", { [DELETION_ENDING_ATTRIBUTE]: "" });
  ending.append(sentence, dismiss);
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

beforeEach(() => {
  frames = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    frame: () => void,
  ) => {
    frames.push(frame);
  };
});

afterEach(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
});

describe("a deletion that did not happen", () => {
  test("what the server writes is what the shell looks for, in the shape it writes it", () => {
    const html = renderCapabilityDeletionPreCommitFailure(notesRow(), { kind: "neutral" });

    for (const mark of [
      DELETION_ENDING_ATTRIBUTE,
      DELETION_SENTENCE_ATTRIBUTE,
      DELETION_EXIT_ATTRIBUTE,
      "data-capability-deletion-focus",
    ]) {
      expect(html).toContain(mark);
    }
    // The double below stands one element in for the sentence, the focus target and the
    // accessible name. That is only honest while the server writes them on one element.
    const sentenceElement = /<p [^>]*data-capability-deletion-sentence[^>]*>/.exec(html)?.[0] ?? "";
    expect(sentenceElement).toContain("data-capability-deletion-focus");
    expect(sentenceElement).toContain('tabindex="-1"');
    expect(html).not.toContain("<h1");
    expect(html).toContain(SENTENCE);
  });

  test("the ending takes the keyboard by its own heading when it lands", () => {
    const stage = scene();
    const ending = endingIn(stage.region);

    stage.fire("htmx:afterSwap", { detail: { target: stage.region } });
    for (const frame of frames.splice(0)) frame();

    expect(ending.querySelector("[data-capability-deletion-focus]")?.focused).toBe(true);
  });

  test("dismissing it hands the keyboard back to the desk and says nothing twice", () => {
    const stage = scene();
    const ending = endingIn(stage.region);
    const dismiss = ending.querySelector(`[${DELETION_EXIT_ATTRIBUTE}]`);
    if (!dismiss) throw new Error("the ending shipped without a way out");

    stage.fire("click", { target: dismiss });
    expect(stage.promptField.focused).toBe(true);

    // The sentence is read once its answer is about to land. Releasing the panel
    // afterwards must not repeat it on the prompt bar, which is where an *unread* one
    // goes.
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

    // Putting the window away releases the region's scope, and that aborts the request
    // its content started. The abort is the browser's alone — the server goes on, and may
    // cross the point of no return — so a destructive action may never end here in
    // silence. Read off a live desk: an aborted confirm fires no swap event at all, so
    // this is the only place it can be heard.
    stage.fire("htmx:sendAbort", { detail: { elt: confirm } });

    expect(spoken(stage)).toBe("Something interrupted that. Let me check what happened…");
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

// Every mark this shell reads is a mark the server writes, so the two copies are pinned
// against each other the way every other shell/server pair on this desk is.
test("the shell restates the deletion's marks exactly as the server writes them", async () => {
  const module = await Bun.file("public/capability-deletion.js").text();

  expect(module).toContain(`const DELETION_ENDING_ATTRIBUTE = "${DELETION_ENDING_ATTRIBUTE}";`);
  expect(module).toContain(
    `const DELETION_SENTENCE_SELECTOR = "[${DELETION_SENTENCE_ATTRIBUTE}]";`,
  );
  expect(module).toContain(`const DELETION_EXIT_SELECTOR = "[${DELETION_EXIT_ATTRIBUTE}]";`);
  expect(focusCapabilityDeletion).toBeInstanceOf(Function);
});
