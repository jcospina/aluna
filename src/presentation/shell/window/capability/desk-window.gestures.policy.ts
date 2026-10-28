import { describe, expect, test } from "bun:test";
import { codeOf as code } from "../../../safety/source.test-support.ts";

// The window's gestures are written once and shared by the product and the design's own desk.

describe("dragging and resizing", () => {
  test("the three gestures are written once and used by both desks", () => {
    // The same rule the frame keeps: `window.js` draws every window and no surface gets a simpler
    // one. Two copies of a drag is how the two grips came to disagree about being a button. Both
    // desks' windows are run with the shared drag and grip in `desk-window-phone.test.ts`.
    for (const consumer of ["public/desk/window/desk-window.js", "design/scripts/desk/desk.js"]) {
      const source = code(consumer);
      expect(source, `${consumer} does not use the shared gestures`).toMatch(
        /addWindowDrag,\s*addWindowGrip,\s*setMaximised,?\s*}\s*from\s*"[^"]*window-gestures\.js"/,
      );
      // No second implementation left behind in either caller. The design's desk keeps a
      // `pointerdown` to bring a window to the front, which is stacking rather than a gesture.
      expect(source, `${consumer} still tracks a drag of its own`).not.toContain("pointermove");
      expect(source, `${consumer} still builds a grip of its own`).not.toContain("window__grip");
      expect(source, `${consumer} still lists the gesture endings`).not.toContain("pointercancel");
    }
  });
});
