import { describe, expect, test } from "bun:test";
import { DESK_GROUND_SELECTOR } from "#shell/desk/window/desk-window.js";
import { RUN_LEAVING_ATTRIBUTE } from "../../server/http/fragments/fragments.ts";
import { codeOf as code, readSource as read } from "../safety/source.test-support.ts";

// The sheets and modules behind leaving a live build or evolution (PLAN decision 17, amending
// design D3). `leaving-a-run.wiring.test.ts` runs the question; this holds what it is drawn with.

const MODULE = code("public/desk/leaving-a-run.js");

describe("the question is drawn over the run's window", () => {
  const WINDOW_CSS = "design/styles/components/window.css";
  const rule = (css: string, selector: string) =>
    new RegExp(`\\n${selector.replace(/[.[\]]/g, "\\$&")} \\{[\\s\\S]*?\\n\\}`).exec(css)?.[0] ??
    "";

  test("it is read over the window it is about, and no further", () => {
    const css = read(WINDOW_CSS);
    // The ground it covers is the window's own body, already positioned and outside the scroller,
    // so the veil fills the window to its edges and nothing here reaches past it.
    const veil = rule(css, ".window__leaving");
    expect(veil).toMatch(/position: absolute;[^}]*inset: 0;/);
    expect(css).toMatch(/\.window__body \{[^}]*position: relative;/);
    // A veil is ink over the surface, not surface over the surface.
    expect(veil).toMatch(/background: color-mix\(in srgb, var\(--ink\) \d+%, transparent\);/);
    for (const desk of [DESK_GROUND_SELECTOR, ".desk__logos", ".prompt", "position: fixed"]) {
      expect(veil, `the question must not reach ${desk}`).not.toContain(desk);
    }
    // The state boundary is the `hidden` attribute, and it has to be stated: `.btn`'s own
    // `inline-flex` would otherwise keep the control on beside the question it replaced.
    expect(rule(css, ".window__leaving[hidden]")).toContain("display: none;");
    const demo = read("public/css/demo.css");
    expect(demo).toMatch(/\.build-stream > \.build-stream__cancel\[hidden\] \{\s*display: none;/);
    // A run still working out its sentence is not shown, but a question it asks is: its box steps
    // aside so the veil, placed against the window's body, can be read and answered.
    expect(demo).toMatch(
      /\.build-stream:has\(> \.window__leaving:not\(\[hidden\]\)\):not\([\s\S]*?\) \{\s*display: contents;/,
    );
    // And it goes with the story once a capability's own surface lands.
    expect(demo).toContain(".build-stream:has(.build-stream__commit:not(:empty)) .window__leaving");
  });

  test("the box it is read in is drawn, like every other box in the window", () => {
    // It declares its border and the ink system takes it over, and hands its shadow over too: a
    // true rectangle of shadow beside a drawn edge is the one part that would show.
    expect(code("design/scripts/ink/ink.js")).toContain('".window__leaving-panel"');
    const panel = rule(read(WINDOW_CSS), ".window__leaving-panel");
    expect(panel).toContain("--ink-shadow: var(--shadow-window);");
    expect(panel).toContain("border: var(--line) solid var(--ink-hair);");
    // Tokens only — no invented values in a sheet the design system owns the scale for.
    expect(panel).not.toMatch(/:\s*#[0-9a-f]{3,8}/i);
    expect(panel).not.toMatch(/:\s*\d+px/);
  });

  test("it is read over the run's own window and takes nothing else away", () => {
    // What keeps it from being the modal PLAN 17 rules out: nothing outside the window is covered
    // or made inert, and focus is not trapped.
    expect(MODULE).not.toContain("showModal");
    expect(MODULE).not.toContain("inert");
    // The desk stays reachable and the lamps stay pressable: the veil is inside the
    // window's body, which begins below the title bar.
    const veil = rule(read(WINDOW_CSS), ".window__leaving");
    expect(veil, "no `.window__leaving` rule").not.toBe("");
    expect(veil).not.toContain("position: fixed");
    for (const beyond of [
      DESK_GROUND_SELECTOR,
      ".desk__logos",
      ".prompt",
      ".window__bar",
      "body",
    ]) {
      expect(veil, `the question must not reach ${beyond}`).not.toContain(beyond);
    }
    // And it is the run's own markup: nothing is fetched, and nothing new is mounted.
    expect(MODULE).not.toContain("createElement");
    expect(MODULE).not.toContain("insertAdjacentHTML");
  });

  test("a form's question is built in the window's body and takes nothing else away either", () => {
    // A form has no surface to ship it hidden in, so it is built when asked: inside the body the
    // veil covers, never fetched and never over the page. What it covers is inert, which reaches
    // only the body's own children: the lamps, the desk and the prompt bar stay live.
    const form = code("public/desk/leaving-unsaved-changes.js");
    for (const banned of [
      "showModal",
      "fetch(",
      "insertAdjacentHTML",
      "innerHTML",
      "document.body",
    ]) {
      expect(form, `the question must not use ${banned}`).not.toContain(banned);
    }
    expect(form).toContain("[...body.children]");
    expect(form).toContain('":scope > .window__body"');
    expect(form.match(/\.append\(veil\.node\)/g)).toHaveLength(1);
    expect(form).toContain('"window__leaving"');
  });
});

describe("the three navigations that ask", () => {
  test("delete is a refusal, not this question", () => {
    // A desk action that would take the window while a run is using it is refused on the prompt
    // bar (5.8/03). Opening a capability is exempt: a navigation owes the question, not a refusal.
    // The refusal itself is run in `app.prompt-bar-messages.test.ts` ("is refused on the prompt bar,
    // and the run stays exactly where it is"; "is not what a press on a capability's logo is").
    const glue = code("public/app.js");
    // And nothing in the glue reaches for the question: the two are separate answers to
    // two different asks.
    expect(glue).not.toContain("askBeforeLeaving");
    expect(glue).not.toContain(RUN_LEAVING_ATTRIBUTE);
  });
});
