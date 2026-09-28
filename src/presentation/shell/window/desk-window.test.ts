import { describe, expect, test } from "bun:test";

import { setMaximised, trackPointer } from "#design/window-gestures.js";
import {
  PUT_WINDOW_AWAY_EVENT,
  startDeskWindow,
  tearDownWindow,
  WINDOW_LAYER_SELECTOR,
  windowLayer,
} from "#shell/desk-window.js";
import { RELEASE_REGION_EVENT } from "#shell/region-scope.js";

// The window, which the client creates and destroys (PLAN decisions 1 and 2; design D1, D3, D12).
// What the shell, the module and the sheets must say about it is `desk-window.policy.ts`.

describe("the shell ships a window layer and no content area", () => {
  test("a missing layer throws rather than opening nothing in silence", () => {
    // The other half of 5.3/02's promise. A desk that cannot mount a window looks
    // exactly like a capability that refused to open, and the two want opposite fixes.
    expect(() => windowLayer({ querySelector: () => null })).toThrow(
      "The desk's window layer is missing.",
    );
    const layer = { name: "the layer" };
    expect(
      windowLayer({
        querySelector: (selector: string) => (selector === WINDOW_LAYER_SELECTOR ? layer : null),
      }),
    ).toBe(layer as never);
  });

  test("the layer is demanded at startup, not at the first press", () => {
    // A shell shipped without one would otherwise render a desk that looks entirely
    // normal and fail on the user's first click — the confusion the throw prevents.
    expect(() =>
      startDeskWindow({ querySelector: () => null, addEventListener: () => {} } as never, "/"),
    ).toThrow("The desk's window layer is missing.");
  });

  test("both openers listen in the capture phase", () => {
    // htmx resolves `hx-target` from a listener on the element itself, which runs after every
    // capture listener, so the capture flag is what makes the window exist first.
    const captured: string[] = [];
    const bubbled: string[] = [];
    startDeskWindow(
      {
        querySelector: () => ({}),
        addEventListener: (type: string, _fn: unknown, capture?: boolean) =>
          (capture === true ? captured : bubbled).push(type),
      } as never,
      "/",
    );
    expect(captured).toEqual(["click", "submit"]);
    expect(bubbled).toContain(PUT_WINDOW_AWAY_EVENT);
  });
});

describe("the window holds the one content region", () => {
  test("the teardown releases, then lets htmx clean up, then detaches", () => {
    // The release is the only moment an htmx request inside the region can be aborted, and htmx
    // closes a build's EventSource only while the node carrying it is still connected.
    const order: string[] = [];
    const opener = { isConnected: true, focus: () => order.push("focus opener") };
    const entry = {
      el: { remove: () => order.push("detach") } as never,
      region: {
        dispatchEvent: (event: CustomEvent) => order.push(`release:${event.type}`),
      } as never,
      win: { destroy: () => order.push("stop observing") } as never,
      openedBy: opener as never,
    };
    tearDownWindow(entry, {
      swap: (target: unknown, content: string, spec: { swapStyle: string }) => {
        order.push(`htmx cleanup:${content === "" ? "emptied" : "?"}:${spec.swapStyle}`);
        expect(target).toBe(entry.el);
      },
    });

    expect(order).toEqual([
      `release:${RELEASE_REGION_EVENT}`,
      "htmx cleanup:emptied:innerHTML",
      "stop observing",
      "detach",
      "focus opener",
    ]);
  });

  test("focus goes back to what opened the window, unless it has gone too", () => {
    // A keyboard user who presses the clay lamp would otherwise lose focus to `<body>`
    // and have to tab the whole desk again to reach the logo that brings it back.
    const build = (isConnected: boolean, sink: string[]) => ({
      el: { remove: () => {} } as never,
      region: { dispatchEvent: () => {} } as never,
      win: { destroy: () => {} } as never,
      openedBy: { isConnected, focus: () => sink.push("focused") } as never,
    });
    const kept: string[] = [];
    tearDownWindow(build(true, kept), undefined);
    expect(kept).toEqual(["focused"]);

    // A logo removed by the very deletion that emptied the window is not somewhere to
    // throw focus at.
    const gone: string[] = [];
    tearDownWindow(build(false, gone), undefined);
    expect(gone).toEqual([]);
  });
});

describe("the three gestures", () => {
  test("every way a gesture can end unbinds the move listener", () => {
    // Without `pointercancel` and `lostpointercapture` the move listener stays attached, the
    // window follows a pointer with no button held, and every later gesture stacks another.
    for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
      const bound = new Map<string, () => void>();
      const handle = {
        setPointerCapture: () => {},
        addEventListener: (type: string, fn: () => void) => bound.set(type, fn),
        removeEventListener: (type: string) => bound.delete(type),
      };
      let ended = 0;
      trackPointer(
        handle as never,
        { pointerId: 1 },
        () => {},
        () => (ended += 1),
      );
      expect(bound.has("pointermove"), `no move listener before ${ending}`).toBe(true);

      bound.get(ending)?.();
      expect(bound.size, `${ending} left listeners attached`).toBe(0);
      expect(ended).toBe(1);
    }
  });

  test("maximise keeps the box it takes, and gives exactly that box back", () => {
    // Maximised is a state, never a size: a window that comes back on a different
    // screen fills that screen instead of the one it left.
    const classes = new Set<string>();
    const el = {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
    };
    type Box = { x: number; y: number; w: number; h: number };
    const box: Box & { max?: boolean; restore?: Box } = { x: 300, y: 40, w: 470, h: 330 };

    setMaximised(el as never, box, true);
    expect(box.restore).toEqual({ x: 300, y: 40, w: 470, h: 330 });
    expect(box.max).toBe(true);
    expect(classes.has("is-maximised")).toBe(true);

    Object.assign(box, { x: 18, y: 18, w: 1244, h: 606 });
    setMaximised(el as never, box, false);
    expect(box).toMatchObject({ x: 300, y: 40, w: 470, h: 330, max: false });
    expect(box.restore).toBeUndefined();
    expect(classes.has("is-maximised")).toBe(false);
  });
});
