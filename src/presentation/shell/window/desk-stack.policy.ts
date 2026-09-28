import { describe, expect, test } from "bun:test";
import { codeOf as code } from "../../safety/source.test-support.ts";

// The stack's rules over the source that keeps them; `desk-stack.test.ts` runs the stack itself.

const WINDOW = code("public/desk-window.js");
const PANEL = code("public/desk-dev-panel.js");
const ANSWER = code("public/desk-answer-window.js");
const STACK = code("public/desk-stack.js");
const DESIGN_DESK = code("design/scripts/desk.js");

describe("a slot is which window this is, not a number that climbs", () => {
  test("the levels are a fixed list read by position, and nothing counts up", () => {
    // Two literals and no arithmetic: a stack that could grow is a window manager. A third
    // window shares the slot behind rather than adding one.
    expect(STACK).not.toMatch(/\+\+|\+= *1|Math\.max/);
  });

  test("each window module builds exactly one window", () => {
    // One `<section>` each, so no module can quietly start standing two up.
    for (const source of [WINDOW, PANEL, ANSWER]) {
      expect(source.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
    }
  });
});

describe("every desk that stands a window keeps the same rule", () => {
  test("each press is heard in the phase the title bar cannot beat", () => {
    // Capture, because the bar raises the window itself before a bubbling listener runs, and a
    // window already raised reads as the one that was in front all along. Which phase runs first
    // is the browser's to order, and no double here can be asked it.
    for (const source of [WINDOW, PANEL, ANSWER]) {
      expect(source).toMatch(/raiseFromPress\([^)]*\),\s*true\s*\)/);
    }
    expect(DESIGN_DESK).toMatch(/"pointerdown",[\s\S]{0,200}?true,\s*\);/);
  });

  test("the design page's desk refuses the press from the same module the product does", () => {
    // One implementation, the way the gestures are one: a second copy drifts the moment one of
    // them is corrected.
    expect(DESIGN_DESK).toContain('import { refusePress } from "./window-press.js";');
    expect(STACK).toContain('import { refusePress } from "../design/scripts/window-press.js";');
    for (const source of [DESIGN_DESK, STACK]) {
      expect(source).not.toMatch(/(?:function|const|let)\s+refusePress\b/);
    }
  });
});
