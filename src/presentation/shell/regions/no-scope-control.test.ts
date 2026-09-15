// The control decision 29 refuses to build (PLAN decision 29; issue 6.6/01).
//
// A proof that something is absent is worth the places it looked and the shapes it knew, so this
// looks two ways. The word sweep catches a control named after one, across every shipped
// stylesheet and every module that draws the bar or a window. The inventory catches one that is
// not: it names the bar's whole contents, so a control called anything at all fails it.
//
// What the open capability is allowed to reach is the classification prompt and the loop's turns
// (`src/runtime/query/the-collection-in-the-window.test.ts`); what it may never reach is anything
// a person sees outside Aluna's own sentence.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANSWER_WINDOW_ATTRIBUTE,
  ANSWER_WINDOW_OPENING,
  renderAnswerWindowOpening,
  renderAnswerWindowSaying,
} from "../../../server/http/index.ts";

const PUBLIC = join(import.meta.dir, "../../../../public");

function shipped(name: string): string {
  return readFileSync(join(PUBLIC, name), "utf8");
}

/**
 * The three controls decision 29 names. Nothing under `public/` carries any of them today — the
 * repo's one `.pill` is in `design/styles/components/controls.css`, which the desk never serves —
 * so a hit in any surface below is a control somebody added.
 */
const A_SCOPE_CONTROL = ["chip", "badge", "pill"];

/** Every stylesheet the desk serves, so a control cannot be styled in a quieter file. */
const STYLESHEETS = readdirSync(join(PUBLIC, "css"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => `css/${name}`);

/**
 * The modules that draw the bar and the windows. `app.js` is not swept for the bare word `scope`
 * — a region scope and the `:scope` selector are both that word there, and neither is a control.
 */
const DRAWS_THE_DESK = ["prompt-bar.js", "desk-window.js", "desk-answer-window.js"];

/** The prompt bar's whole strip, from the comment that introduces it to the end of its form. */
const promptBar = (() => {
  const shell = shipped("index.html");
  const from = shell.indexOf("<!-- Prompt bar");
  const to = shell.indexOf("</form>", from);
  if (from === -1 || to === -1) throw new Error("the prompt bar is no longer in the shell");
  return shell.slice(from, to);
})();

describe("no scope control is on the prompt bar", () => {
  test("its whole inventory is a notice, a field and a button — there is no fourth thing", () => {
    // Named rather than swept: a control called `prompt__subject` or `query-lens` passes every
    // word list ever written, and fails this the moment it is added.
    const ids = [...promptBar.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([
      "spec-build-form",
      "prompt-notice",
      "spec-build-prompt",
      "spec-build-trigger",
    ]);
    // `:class` is Alpine's busy binding rather than a thing on the bar, so it is not counted.
    const classes = [...promptBar.matchAll(/(?<![:@])\bclass="([^"]+)"/g)].map((match) => match[1]);
    expect(classes).toEqual([
      "prompt",
      "prompt__notice",
      "prompt__composer",
      "prompt__field",
      "btn btn--warm prompt__submit",
    ]);
  });

  test("and nothing in the strip is named after a control", () => {
    for (const word of [...A_SCOPE_CONTROL, "scope"]) {
      expect(promptBar.toLowerCase()).not.toContain(word);
    }
  });

  test("the open capability leaves the desk as a request parameter, never as something rendered", () => {
    // `app.js` reads the standing capability off the surface at submit time and puts it in the
    // body. That is the whole of how the window reaches the resolver, and it draws nothing.
    const glue = shipped("app.js");
    expect(glue).toContain("detail.parameters.__aluna_restore_capability_id = capabilityId;");
    for (const word of A_SCOPE_CONTROL) expect(glue.toLowerCase()).not.toContain(word);
  });
});

describe("no scope control is anywhere else the desk draws", () => {
  test("no module that draws the bar or a window writes one", () => {
    for (const name of DRAWS_THE_DESK) {
      const module = shipped(name).toLowerCase();
      for (const word of A_SCOPE_CONTROL) expect(module).not.toContain(word);
    }
  });

  test("and no stylesheet the desk serves has a style for one", () => {
    expect(STYLESHEETS.length).toBeGreaterThan(1);
    for (const sheet of STYLESHEETS) {
      const styles = shipped(sheet).toLowerCase();
      for (const word of A_SCOPE_CONTROL) expect(styles).not.toContain(word);
    }
  });
});

describe("no scope control is on the answer window", () => {
  test("the window is named after the question and carries no capability of its own", () => {
    const opening = renderAnswerWindowOpening("how many did I add this month?");

    expect(opening).toBe(
      `<div ${ANSWER_WINDOW_ATTRIBUTE}="how many did I add this month?">${ANSWER_WINDOW_OPENING}</div>`,
    );
    expect(opening.toLowerCase()).not.toContain("notes");
  });

  test("a sentence she says is the sentence and nothing around it", () => {
    expect(renderAnswerWindowSaying("You added six notes this month.")).toBe(
      "<div data-answer-saying>You added six notes this month.</div>",
    );
  });
});
