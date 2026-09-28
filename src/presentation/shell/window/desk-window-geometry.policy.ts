import { describe, expect, test } from "bun:test";
import { codeOf as code, rules } from "../../safety/source.test-support.ts";

// Where the window sits and how big it is (PLAN decisions 5, 18, 47, 48; design D9), held where
// the geometry is declared: the sheet it is positioned by, and the lengths the module never states.

const MODULE = code("public/desk-window.js");
const FRAME = code("public/desk-window-frame.js");
const PANEL = code("public/desk-dev-panel.js");
const ANSWER = code("public/desk-answer-window.js");

describe("the desk changing size is a thing something reacts to", () => {
  test("re-fitting cannot feed the observer that triggered it", () => {
    // The box is written as custom properties on a window absolutely positioned inside
    // the layer, so nothing a re-fit does can resize the layer being watched. That the box
    // lands on the window is run in `desk-window-geometry.desk.test.ts`.
    const layer = rules("design/styles/components/desk.css");
    expect(layer).toMatch(/\.desk__windows\s*\{[^}]*position:\s*absolute/);
    expect(layer).toMatch(/\.window--desk\s*\{[^}]*position:\s*absolute/);
  });
});

describe("the floor is the token's, not this module's", () => {
  test("the window module states no length and no breakpoint of its own", () => {
    // 5.4/01 put every length in `tokens.css` and `desk-geometry.js` reads them back, so the logo
    // grid and every window stop on the same floor. A number restated here is that coming apart.
    expect(FRAME).toContain("PROMPT_CLEARANCE");
    expect(MODULE).toContain("PHONE");
    for (const [name, source] of [
      ["desk-window.js", MODULE],
      ["desk-window-frame.js", FRAME],
    ]) {
      for (const restated of ["78", "4.875", "720", "620"]) {
        expect(source, `\`${restated}\` is restated in ${name}`).not.toMatch(
          new RegExp(`(?<![\\d.])${restated.replace(".", "\\.")}(?![\\d.])`),
        );
      }
    }
    // And no width is compared by hand anywhere on the surface; the query answers it.
    expect(MODULE).not.toMatch(/innerWidth|clientWidth/);
  });

  test("no window is placed except through the geometry module", () => {
    // Every `placeWindow` call site is gated on `fitBox` having said the box is ready: the
    // opening and every later re-fit. A third would be a box written without meeting the floor.
    expect(MODULE.match(/placeWindow\(/g)).toHaveLength(2);
    expect(MODULE.match(/if \(fitBox\(/g)).toHaveLength(2);
    expect(MODULE).toContain("if (fitBox(state, bounds, isPhone)) placeWindow(el, box)");
    // The panel and the answer window place through the same two, never a copy of them.
    for (const source of [MODULE, PANEL, ANSWER]) {
      expect(source).toMatch(
        /if \(fitBox\(entry, entry\.layer\.getBoundingClientRect\(\), phone\)\) \{\s*placeWindow\(entry\.el, entry\.box\);/,
      );
    }
    for (const source of [PANEL, ANSWER]) {
      expect(source).not.toMatch(/placeWindow\((?![\s\S]{0,40}entry\.box)/);
    }
    // The gestures reach the same clamps rather than a second copy of them.
    const gestures = code("design/scripts/window-gestures.js");
    expect(gestures).toContain(
      'import { clampPosition, clampSize, placeWindow } from "./desk-geometry.js"',
    );
    // And they clamp against the screen as it is now. Reading `host.bounds()` once at pointer-down
    // let a rotation or a soft keyboard park the window inside the prompt bar's clearance.
    expect(gestures).toContain("clampPosition(host.bounds(), box)");
    expect(gestures).toContain("clampSize(host.bounds(), box)");
    expect(gestures).not.toMatch(/const bounds = host\.bounds\(\);/);
  });

  test("every resize re-reads the floor and settles the form before it clamps", () => {
    // An ordering, so it is read where it is written. The floor is a rem length read back from
    // the stylesheet: held from module load, a maximised window would slide under a bar that grew.
    const watch = /const onResize = \(\) => \{([\s\S]*?)\n {2}\};/.exec(MODULE)?.[1] ?? "";
    expect(watch, "no `onResize`").not.toBe("");
    expect(watch).toContain("refreshGeometry()");
    expect(watch.indexOf("refreshGeometry()")).toBeLessThan(watch.indexOf("refit(mounted)"));
    expect(watch.indexOf("syncForm(mounted, phone)")).toBeGreaterThanOrEqual(0);
    expect(watch.indexOf("syncForm(mounted, phone)")).toBeLessThan(watch.indexOf("refit(mounted)"));
  });
});

describe("a box the user authored is erased in one place", () => {
  test("the window is dismissed from exactly two call sites", () => {
    // Two call sites and the declaration itself: a fourth match is a third dismissal.
    expect(MODULE.match(/dismissWindow\(\)/g), "a third dismissal").toHaveLength(3);
  });
});
