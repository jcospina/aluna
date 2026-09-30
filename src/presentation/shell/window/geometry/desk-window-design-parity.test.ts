import { afterEach, describe, expect, test } from "bun:test";

import { DEV_STORAGE_KEY } from "#shell/desk/window/desk-dev-panel.js";
import { WINDOW_STORAGE_KEY } from "#shell/desk/window/desk-window.js";
import { dragBy, type El, pressLamp } from "../standing-desk.test-support.ts";
import { designDesk } from "../viewport-desk.test-support.ts";

// One record rule, kept by the two surfaces that keep a window: the product's desk and the
// handbook's demo of it (design D9; PLAN decision 18). The handbook's desk is run here, on the
// same double the product's is, and what it writes down is read back off the browser's store.

let design: Awaited<ReturnType<typeof designDesk>> | undefined;
afterEach(() => {
  design?.restore();
  design = undefined;
});

/** The handbook desk's own record, whatever key it keeps it under, parsed. */
function recordOf(opened: NonNullable<typeof design>) {
  const product: readonly string[] = [WINDOW_STORAGE_KEY, DEV_STORAGE_KEY];
  const [key, ...more] = opened.desk.store.keys().filter((name) => !product.includes(name));
  expect(more).toEqual([]);
  return key === undefined ? null : JSON.parse(opened.desk.store.contents()[key] ?? "null");
}

describe("what a remembered box is, kept the same way on both desks", () => {
  test("a window nobody has moved has no preference to keep", async () => {
    design = await designDesk(false);
    design.design.open("notes");
    expect(recordOf(design)?.window ?? null).toBeNull();
  });

  test("a finished gesture authors the box, and the box is four numbers and a flag", async () => {
    design = await designDesk(false);
    const el = design.design.open("notes").el as El;
    dragBy(el.querySelector("header") as El, 40, 30);
    expect(Object.keys(recordOf(design).window).sort()).toEqual(["h", "max", "w", "x", "y"]);
  });

  test("a maximised window writes the box it gives back, never the desk it fills", async () => {
    design = await designDesk(false);
    const el = design.design.open("notes").el as El;
    dragBy(el.querySelector("header") as El, 40, 30);
    const moved = recordOf(design).window;
    pressLamp(el, "maximise");
    expect(recordOf(design).window).toEqual({ ...moved, max: true });
  });

  test("the clay lamp ends the window and its box; a close nobody asked for keeps it", async () => {
    design = await designDesk(false);
    let el = design.design.open("notes").el as El;
    dragBy(el.querySelector("header") as El, 40, 30);
    const kept = design.desk.store.contents();
    design.design.close();
    expect(design.desk.store.contents()).toEqual(kept);

    el = design.design.open("notes").el as El;
    pressLamp(el, "putaway");
    expect(recordOf(design).window).toBeNull();
  });

  test("its key is its own, beside the product's two rather than one of them", async () => {
    // The handbook is served from the product's origin, so a shared key would have one surface
    // restore the other's window.
    design = await designDesk(false);
    const el = design.design.open("notes").el as El;
    dragBy(el.querySelector("header") as El, 40, 30);
    expect(design.desk.store.keys()).not.toContain(WINDOW_STORAGE_KEY);
    expect(design.desk.store.keys()).not.toContain(DEV_STORAGE_KEY);
    expect(recordOf(design)).not.toBeNull();
  });

  test("a record that is not four finite numbers is not believed, as on the product's desk", async () => {
    // Asked of the key the handbook's desk writes under, found by letting it write once.
    design = await designDesk(false);
    const el = design.design.open("notes").el as El;
    dragBy(el.querySelector("header") as El, 40, 30);
    const product: readonly string[] = [WINDOW_STORAGE_KEY, DEV_STORAGE_KEY];
    const [key] = design.desk.store.keys().filter((name) => !product.includes(name));
    design.restore();

    const broken = { window: { x: "nope", y: 1, w: 2, h: 3, max: false }, dev: null };
    design = await designDesk(false, { [key as string]: JSON.stringify(broken) });
    const reopened = design.design.open("notes").el as El;
    const placed = [...reopened.props.entries()].filter(([name]) => name.startsWith("--win-"));
    expect(placed.length).toBeGreaterThan(0);
    for (const [, value] of placed) expect(value).not.toContain("NaN");
    expect(placed.map(([, value]) => value)).not.toContain("2px");
  });
});
