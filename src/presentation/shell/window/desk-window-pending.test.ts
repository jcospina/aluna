import { describe, expect, test } from "bun:test";

import { startDeskWindow } from "#shell/desk-window.js";
import { readSource as read } from "../../safety/source.test-support.ts";

// A window a prompt stood up before anything was known waits out of sight for the first thing
// worth showing, because a frame that appears and vanishes reads as a fault (PLAN decision 24).

// A prompt that never becomes a build earns a window never, so an answer belonging on the prompt
// bar does not also flash an empty frame across the desk.
describe("a window stood up before anything is known", () => {
  /** Every rule `startDeskWindow` registers, by the event it listens for. */
  function wiring() {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    startDeskWindow(
      {
        querySelector: () => ({}),
        addEventListener: (type: string, fn: (event: unknown) => void) =>
          listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      } as never,
      "/",
    );
    return listeners;
  }

  test("is revealed by the run's first message, and by nothing else", () => {
    const reveal = wiring().get("htmx:sseBeforeMessage")?.[0];
    expect(reveal).toBeDefined();
    const shown: string[] = [];
    const listenerIn = (className: string) => ({
      matches: (selector: string) =>
        selector.split(",").some((step) => step.trim() === `.${className}`),
      closest: () => ({ classList: { remove: (name: string) => shown.push(name) } }),
    });

    // The `fragment` event's listener is the run giving back what it displaced, which
    // is the opposite of having something to show.
    reveal?.({ target: listenerIn("build-stream__fragment") });
    expect(shown).toEqual([]);

    reveal?.({ target: listenerIn("build-stream__narration") });
    reveal?.({ target: listenerIn("build-stream__commit") });
    expect(shown).toEqual(["is-pending", "is-pending"]);
  });

  test("waits out of sight rather than being taken out of the layout", () => {
    // `visibility`, not `display`: the window is measured when it mounts, and a box
    // with no layout would be drawn at nothing and stay that way.
    const css = read("public/css/demo.css");

    expect(css).toMatch(/\.window--desk\.is-pending\s*\{\s*visibility:\s*hidden/);
    expect(read("public/desk-window.js")).toContain('const PENDING_WINDOW_CLASS = "is-pending";');
  });
});
