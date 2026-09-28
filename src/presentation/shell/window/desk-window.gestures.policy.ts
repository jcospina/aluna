import { describe, expect, test } from "bun:test";
import { codeOf as code, readSource as read } from "../../safety/source.test-support.ts";

// The window's gestures are written once and shared by the product and the design's own desk
// (PLAN decisions 1 and 2; design D1, D3, D12), and the architecture says what the shell is now.

describe("dragging and resizing", () => {
  test("the three gestures are written once and used by both desks", () => {
    // The same rule the frame keeps: `window.js` draws every window and no surface gets a simpler
    // one. Two copies of a drag is how the two grips came to disagree about being a button. Both
    // desks' windows are run with the shared drag and grip in `desk-window-phone.test.ts`.
    for (const consumer of ["public/desk-window.js", "design/scripts/desk.js"]) {
      const source = code(consumer);
      expect(source, `${consumer} does not use the shared gestures`).toMatch(
        /addWindowDrag,\s*addWindowGrip,\s*setMaximised\s*}\s*from\s*"[^"]*window-gestures\.js"/,
      );
      // No second implementation left behind in either caller. The design's desk keeps a
      // `pointerdown` to bring a window to the front, which is stacking rather than a gesture.
      expect(source, `${consumer} still tracks a drag of its own`).not.toContain("pointermove");
      expect(source, `${consumer} still builds a grip of its own`).not.toContain("window__grip");
      expect(source, `${consumer} still lists the gesture endings`).not.toContain("pointercancel");
    }
  });
});

describe("the architecture says what the shell is now", () => {
  const architecture = read("docs/architecture.md");

  test("§6.1 draws the boundary in one sentence, with nothing to enumerate", () => {
    // One sentence carries it, so future desk furniture needs no amendment, and it still stands
    // between the browser and any re-implementation of capability logic (PLAN decision 2).
    expect(architecture).toContain(
      "> The shell may remember how things look to the user. It never decides what is",
    );
    expect(architecture).toContain("> true. Window geometry, maximised state and where the user");
    expect(architecture).toContain("> the server's alone.");
  });

  test("the page is no longer described as one that never changes", () => {
    // Retired because it stopped being true here: the window is created and destroyed.
    expect(architecture).not.toMatch(/never changes after first load/i);
    expect(architecture).not.toMatch(/single static HTML page/i);
    expect(architecture).toContain("The page is not inert after first load");
  });
});
