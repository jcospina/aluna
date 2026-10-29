import { describe, expect, test } from "bun:test";

import { writeStage } from "#design/desk/devpanel.js";
import { readSource as read } from "../../../safety/source.test-support.ts";
import { FakeEvent, fakeDocument, usePanelDom } from "./devpanel-dom.test-support.ts";
import { CONTENT, panelWith, UNITS } from "./devpanel-fixture.test-support.ts";

// The developer panel's module and sheet, held to how far the terminal reading goes.

const MODULE = [
  "design/scripts/desk/devpanel.js",
  "design/scripts/desk/devpanel-view.js",
  "design/scripts/desk/devpanel-gestures.js",
  "design/scripts/desk/devpanel-select.js",
]
  .map((path) => read(path))
  .join("\n");
const PANEL_CSS = read("design/styles/components/devpanel.css");

describe("a payload in a code block", () => {
  test("is written as text, never parsed as markup", () => {
    // A capability label a model authored cannot close the block and open something else.
    expect(MODULE).not.toContain("innerHTML");
    expect(MODULE).not.toContain("insertAdjacentHTML");
  });
});

describe("the terminal reading stops where the design settles it", () => {
  test("the five tints are the palette's own anchors, and never the alert colour", () => {
    // `--signal` is the one red and it is reserved for alerts; a failed Gate is a reading. The
    // five are picked for a dark well: `--ink-3` is faint by being darker, and nothing here is.
    const panel = /\.devpanel__(key|string|number|atom|punct) \{\s*color: ([^;]+);/g;
    const used = [...PANEL_CSS.matchAll(panel)].map((match) => match[2]);
    expect(used).toHaveLength(5);
    expect(used.join(" ")).not.toContain("--signal");
    expect(new Set(used).size).toBe(5);
    // Ink at a reading strength belongs to the light fills; the well states its own.
    expect(used.join(" ")).not.toContain("var(--ink-3)");

    // The one monospace face in Aluna, and it belongs to this surface alone — and the
    // one well filled with `--ink`, which is lines and type everywhere else.
    expect(PANEL_CSS).toMatch(/\.devpanel__pre \{[^}]*font-family: var\(--font-mono\);/);
    expect(PANEL_CSS).toMatch(/\.devpanel__pre \{[^}]*background: var\(--ink\);/);
    // `code` in prose is an inline chip; a payload is not prose, and the chip left in
    // place paints a pale box behind every line of the well.
    expect(PANEL_CSS).toMatch(/\.devpanel__code \{[^}]*background: none;/);
  });

  test("no gutter, no prompt mark and no clock — those describe a session, not a build", () => {
    for (const absent of ["timestamp", "elapsed", "Date.now", "gutter", "lineNumber"]) {
      expect(MODULE, `\`${absent}\` is a session's furniture`).not.toContain(absent);
    }
  });
});

describe("the sheet and the panel agree", () => {
  usePanelDom();

  test("every class the sheet styles is one the panel builds", () => {
    // A class the sheet names and nothing carries is a rule that quietly stopped applying.
    const styled = new Set(
      PANEL_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
        .match(/\.[a-z][\w-]*/g)
        ?.map((name) => name.slice(1)),
    );
    const { panel, code, control, twist, press } = panelWith("units", UNITS);
    writeStage(panel, "spec", '{"count":1,"strict":true}');
    const built = new Set<string>();
    const gather = () => {
      for (const el of [panel, ...panel.descendants(), fakeDocument.documentElement]) {
        for (const name of el.className.split(" ").filter(Boolean)) built.add(name);
      }
    };
    gather();
    press(twist(CONTENT));
    fakeDocument.selection.collapse(code);
    code.dispatchEvent(new FakeEvent("mousedown"));
    fakeDocument.dispatch(new FakeEvent("mousemove", { buttons: 1 }));
    writeStage(panel, "units", UNITS);
    gather();
    fakeDocument.dispatch(new FakeEvent("mouseup"));
    press(control("format"));
    gather();
    // The window's own frame, which the panel's sheet places it in.
    for (const frame of ["window--dev", "window__body"]) built.add(frame);
    expect([...styled].filter((name) => !built.has(name))).toEqual([]);
  });
});
