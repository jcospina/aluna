// Where the window stands, run on a started desk rather than read out of the module: the order its
// frame is built in, which ways of going away reach the record, and what makes it re-fit.

import { afterEach, describe, expect, test } from "bun:test";

import { refreshGeometry } from "#design/desk-geometry.js";
import {
  capabilityAddress,
  DESK_ADDRESS,
  PUT_WINDOW_AWAY_EVENT,
  WINDOW_STORAGE_KEY,
} from "#shell/desk-window.js";
import { dragBy, type El, pressLamp } from "./standing-desk.test-support.ts";
import { serverLogo, type ViewportDesk, viewportDesk } from "./viewport-desk.test-support.ts";

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A desk with Notes on the ground, loaded at `pathname`, and a window whose box was authored. */
async function authored(pathname: string = DESK_ADDRESS) {
  screen = await viewportDesk({ pathname, logos: [serverLogo("notes", "Notes")] });
  const desk = screen;
  desk.module.openWindow("Notes", desk.desk.doc as never);
  const el = desk.desk.windows()[0] as El;
  dragBy(el.querySelector("header") as El, 40, 30);
  const record = desk.desk.store.contents()[WINDOW_STORAGE_KEY];
  expect(record).toBeDefined();
  return { desk, el, record, kept: () => desk.desk.store.contents()[WINDOW_STORAGE_KEY] };
}

const popTo = (desk: ViewportDesk, pathname: string) => {
  desk.desk.address.pathname = pathname;
  (
    (globalThis as unknown as { window: unknown }).window as {
      onpopstate: (event: unknown) => void;
    }
  ).onpopstate({
    state: null,
  });
};

describe("where a window first stands", () => {
  test("the frame is first measured after the element is the size it will be", async () => {
    // The window's chrome measures the element it is given, so a frame drawn before the box
    // lands is drawn for the wrong window.
    screen = await viewportDesk();
    const placedWhenMeasured: boolean[] = [];
    const make = screen.desk.doc.createElement;
    screen.desk.doc.createElement = (tag: string) => {
      const made = make(tag);
      if (tag === "section") {
        Object.defineProperty(made, "clientWidth", {
          get: () => {
            placedWhenMeasured.push(made.props.has("--win-w"));
            return 0;
          },
        });
      }
      return made;
    };
    screen.module.openWindow("Notes", screen.desk.doc as never);
    expect(placedWhenMeasured.length).toBeGreaterThan(0);
    expect(placedWhenMeasured[0]).toBe(true);
  });
});

describe("the leaf lamp", () => {
  const placed = (el: El) =>
    ["--win-x", "--win-y", "--win-w", "--win-h"].map((name) =>
      Number.parseFloat(el.props.get(name) ?? ""),
    );

  test("maximises, remembering the box it gives back, and un-maximising gives it back", async () => {
    const window = await authored();
    const [x = 0, y = 0, w = 0, h = 0] = placed(window.el);
    pressLamp(window.el, "maximise");
    expect(window.el.classList.contains("is-maximised")).toBe(true);
    expect(placed(window.el)).not.toEqual([x, y, w, h]);
    expect(JSON.parse(window.kept() ?? "null")).toEqual({ x, y, w, h, max: true });

    pressLamp(window.el, "maximise");
    expect(window.el.classList.contains("is-maximised")).toBe(false);
    expect(placed(window.el)).toEqual([x, y, w, h]);
    expect(JSON.parse(window.kept() ?? "null")).toEqual({ x, y, w, h, max: false });
  });
});

describe("a dismissal is the only way a window going away reaches the record", () => {
  test("a Back onto the bare desk is the lamp's other face, and forgets", async () => {
    const window = await authored(capabilityAddress("notes"));
    popTo(window.desk, DESK_ADDRESS);
    expect(window.desk.desk.windows()).toEqual([]);
    expect(window.kept()).toBeUndefined();
  });

  test("an address naming nothing on the ground puts the window away, keeps the box, and is corrected", async () => {
    const window = await authored(capabilityAddress("notes"));
    popTo(window.desk, capabilityAddress("recipes"));
    expect(window.desk.desk.windows()).toEqual([]);
    expect(window.kept()).toBe(window.record);
    expect(window.desk.desk.address.written.at(-1)).toBe(`replace ${DESK_ADDRESS}`);
  });

  test("a window emptied by the glue goes away without erasing the box", async () => {
    const window = await authored();
    window.desk.desk.doc.dispatchEvent({ type: PUT_WINDOW_AWAY_EVENT });
    expect(window.desk.desk.windows()).toEqual([]);
    expect(window.kept()).toBe(window.record);
  });

  test("a read that never filled the window takes it away without erasing the box", async () => {
    const window = await authored();
    const notes = window.desk.desk.root.querySelector('[aria-label="Open Notes"]') as El;
    notes.click();
    window.desk.desk.doc.dispatchEvent({
      type: "htmx:afterRequest",
      detail: { elt: notes, successful: false },
    } as never);
    expect(window.desk.desk.windows()).toEqual([]);
    expect(window.kept()).toBe(window.record);
  });
});

describe("the desk changing size is a thing something reacts to", () => {
  /** The window's box as it was last placed, from the four custom properties the desk writes. */
  const placed = (el: El) =>
    ["--win-x", "--win-y", "--win-w", "--win-h"].map((name) => el.props.get(name));

  test("the browser's resize and the layer's own size both re-fit the window", async () => {
    const window = await authored();
    pressLamp(window.el, "maximise");
    const full = placed(window.el);
    const box = window.desk.desk.layer.getBoundingClientRect();
    window.desk.desk.layer.getBoundingClientRect = () => ({ ...box, width: box.width - 200 });
    window.desk.resize();
    const resized = placed(window.el);
    expect(resized).not.toEqual(full);

    // No `resize` this time: only the layer's own watch can have heard it.
    window.desk.desk.layer.getBoundingClientRect = () => ({ ...box, width: box.width - 400 });
    window.desk.layOut();
    const narrower = placed(window.el);
    expect(Number.parseFloat(narrower[2] ?? "")).toBeLessThan(Number.parseFloat(resized[2] ?? ""));
  });

  test("the viewport is watched once, however many times the desk is started", async () => {
    screen = await viewportDesk();
    expect(screen.asked).toHaveLength(1);
    screen.module.startDeskWindow(screen.desk.doc as never, DESK_ADDRESS);
    expect(screen.asked).toHaveLength(1);
  });

  test("the re-fit a resize makes re-reads the floor before it clamps to it", async () => {
    // The floor is a rem length read back from the stylesheet: held from module load, a
    // maximised window would slide under a bar that grew. Every clamp re-reads it itself.
    const window = await authored();
    pressLamp(window.el, "maximise");
    const before = Number.parseFloat(window.el.props.get("--win-h") ?? "");
    const host = globalThis as unknown as Record<string, unknown>;
    const styles = host.getComputedStyle;
    host.getComputedStyle = () => ({
      getPropertyValue: (name: string) => (name === "--prompt-clearance" ? "300px" : ""),
    });
    try {
      window.desk.resize();
      expect(Number.parseFloat(window.el.props.get("--win-h") ?? "")).toBeLessThan(before);
    } finally {
      host.getComputedStyle = styles;
      refreshGeometry();
    }
  });

  test("a clamp is not a preference, so a passing narrow screen does not erase one", async () => {
    // `fitToDesk` only ever pulls a box in, so written back on every tick one transient narrowing
    // would erode the remembered box for good. Only a gesture, the lamp and a crossing write.
    const window = await authored();
    const writes = window.desk.desk.store.writes.length;
    const box = window.desk.desk.layer.getBoundingClientRect();
    window.desk.desk.layer.getBoundingClientRect = () => ({ ...box, width: 500, height: 400 });
    window.desk.resize();
    window.desk.layOut();
    window.desk.setPhone(false);
    expect(window.desk.desk.store.writes).toHaveLength(writes);
    expect(window.kept()).toBe(window.record);

    pressLamp(window.el, "maximise");
    expect(window.desk.desk.store.writes.length).toBeGreaterThan(writes);
  });

  test("a gesture that ends after its window was taken down writes nothing", async () => {
    // Taking a frame out releases the pointer capture, and the gesture's end arrives after the
    // teardown: written then, it would hand a dismissed window's box to the next one.
    const window = await authored();
    const bar = window.el.querySelector("header") as El;
    bar.dispatchEvent({
      type: "pointerdown",
      target: bar,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      stopPropagation: () => {},
      preventDefault: () => {},
    } as never);
    pressLamp(window.el, "putaway");
    const writes = window.desk.desk.store.writes.length;
    bar.dispatchEvent({ type: "pointerup", pointerId: 1, clientX: 90, clientY: 90 } as never);
    expect(window.desk.desk.store.writes).toHaveLength(writes);
  });
});
