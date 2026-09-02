// The one sentence that arrives with the document rather than after it (PLAN decision 21;
// issue 5.9/03), and the rule that makes the prompt bar's live region hear it.
//
// The shipped module, not a copy of it: `#shell/prompt-bar.js` is started on a document
// double the way the page starts it on a real one.

import { describe, expect, test } from "bun:test";

import { startPromptBar } from "#shell/prompt-bar.js";
import { NOT_FOUND_NOTICE } from "../../../web/index.ts";

/**
 * As much of a document as this rule reaches for, over one recording slot. Every write to
 * the slot is kept, because what is being proved is not the words that end up there — they
 * never change — but that the slot was *written*, which is the whole of what an
 * `aria-live` region announces.
 */
function pageArrivingWith(standing: string, readyState = "loading") {
  const writes: string[] = [];
  const notice = {
    text: standing,
    get textContent(): string {
      return this.text;
    },
    set textContent(next: string) {
      this.text = next;
      writes.push(next);
    },
    replaceChildren(): void {
      this.text = "";
      writes.push("");
    },
    querySelector: () => null,
    firstChild: null,
  };
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const root = {
    readyState,
    getElementById: (id: string) => (id === "prompt-notice" ? notice : null),
    createElement: () => ({ setAttribute() {}, textContent: "" }),
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const fire = (type: string, event: unknown = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return { root, notice, writes, fire, listeners };
}

describe("a sentence served with the page", () => {
  test("is said again once the document is up, so the live region has a change to announce", () => {
    const page = pageArrivingWith(NOT_FOUND_NOTICE);
    startPromptBar(page.root as never);

    // Nothing yet: the document is still being parsed, which is exactly when assistive
    // technology is not listening.
    expect(page.writes).toEqual([]);

    page.fire("DOMContentLoaded");

    // Emptied and refilled — the two mutations a live region reads as "this changed".
    // Leaving the words alone would be silence, which is the defect this closes.
    expect(page.writes).toEqual(["", NOT_FOUND_NOTICE]);
    expect(page.notice.textContent).toBe(NOT_FOUND_NOTICE);
  });

  test("a page that arrived with nothing to say waits for nothing and writes nothing", () => {
    const page = pageArrivingWith("");
    startPromptBar(page.root as never);
    page.fire("DOMContentLoaded");

    expect(page.writes).toEqual([]);
    expect(page.listeners.has("DOMContentLoaded")).toBe(false);
  });

  test("the next keystroke retires it, the way it retires every other sentence here", () => {
    // The acceptance criterion the seeded sentence has to meet as well as every sentence
    // that arrives by swap: it does not outlive the next thing the person does. It gets
    // that for free by living in the one slot — and free is not proved, so it is proved.
    const page = pageArrivingWith(NOT_FOUND_NOTICE);
    startPromptBar(page.root as never);
    page.fire("DOMContentLoaded");

    page.fire("input", { target: { id: "spec-build-prompt" } });

    expect(page.notice.textContent).toBe("");
    expect(page.writes.at(-1)).toBe("");
  });

  test("a document that had already finished hears it at once, and only once", () => {
    const page = pageArrivingWith(NOT_FOUND_NOTICE, "complete");
    startPromptBar(page.root as never);

    expect(page.writes).toEqual(["", NOT_FOUND_NOTICE]);

    // A `DOMContentLoaded` that arrives anyway must not repeat it: one sentence said
    // twice is one sentence too many on a slot that holds exactly one.
    page.fire("DOMContentLoaded");
    expect(page.writes).toEqual(["", NOT_FOUND_NOTICE]);
  });
});
