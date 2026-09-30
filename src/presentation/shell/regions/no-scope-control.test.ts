// The control decision 29 refuses to build (PLAN decision 29; issue 6.6/01), looked for by
// inventory: the bar's whole contents are named, so a control called anything at all fails it.
// `no-scope-control.policy.ts` sweeps for one named after a control.
//
// What the open capability is allowed to reach is the classification prompt and the loop's turns
// (`src/runtime/query/turn/the-collection-in-the-window.test.ts`); what it may never reach is anything
// a person sees outside Aluna's own sentence.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPT_FIELD_ID, PROMPT_NOTICE_ID } from "#shell/core/shell-dom.js";
import { PROMPT_FORM_ID } from "#shell/desk/window/desk-window.js";
import {
  ANSWER_WINDOW_ATTRIBUTE,
  ANSWER_WINDOW_OPENING,
  renderAnswerWindowOpening,
  renderAnswerWindowSaying,
} from "../../../server/http/index.ts";
import {
  byId,
  descendantsOf,
  elementsOf,
  type ServedElement,
} from "../../../server/http/served-page.test-support.ts";
import { El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";

const PUBLIC = join(import.meta.dir, "../../../../public");

describe("no scope control is on the prompt bar", () => {
  test("its whole inventory is a notice, a field and a button — there is no fourth thing", async () => {
    // Counted rather than swept: a control called `prompt__subject` or `query-lens` passes every
    // word list ever written, and fails this the moment it is added.
    const page = await elementsOf(readFileSync(join(PUBLIC, "index.html"), "utf8"));
    const inBar = page.filter((element) => element.within.includes(PROMPT_FORM_ID));
    const controls = inBar.filter(
      (element) =>
        ["input", "button", "select", "textarea", "a"].includes(element.tag) ||
        element.attributes.has("role") ||
        element.attributes.has("tabindex"),
    );
    expect(controls.map((control) => control.tag)).toEqual(["input", "button"]);
    expect(controls[0]?.attributes.get("id")).toBe(PROMPT_FIELD_ID);
    expect(controls[1]?.attributes.get("type")).toBe("submit");
    // And the one slot the bar speaks in, which says things rather than taking them.
    expect(byId(page, PROMPT_NOTICE_ID).within).toContain(PROMPT_FORM_ID);
  });

  test("and nothing passive stands in it either: every element is one of those three", async () => {
    // A scope shown rather than offered — a `<span>` naming the capability beside the field — is
    // no control, and still the thing decision 29 refuses. So every element is accounted for.
    const page = await elementsOf(readFileSync(join(PUBLIC, "index.html"), "utf8"));
    const inBar = page.filter((element) => element.within.includes(PROMPT_FORM_ID));
    const notice = byId(page, PROMPT_NOTICE_ID);
    const field = byId(page, PROMPT_FIELD_ID);
    const [submit, ...more] = inBar.filter(
      (element) => element.tag === "button" && element.attributes.get("type") === "submit",
    );
    expect(more).toEqual([]);
    if (submit === undefined) throw new Error("the bar has no submit button");
    const named = [
      notice,
      field,
      submit,
      ...descendantsOf(page, notice),
      ...descendantsOf(page, submit),
    ];
    const rest = inBar.filter((element) => !named.includes(element));
    // What is left is layout: one wrapper holding the field and the button, saying nothing of
    // its own beyond the button's words.
    expect(rest.map((element) => element.tag)).toEqual(["div"]);
    const [wrapper] = rest as [ServedElement];
    expect(descendantsOf(page, wrapper)).toEqual([field, submit, ...descendantsOf(page, submit)]);
    expect(wrapper.text).toBe(submit.text);
  });
});

describe("no scope control is on the answer window", () => {
  test("the window is named after the question and carries no capability of its own", () => {
    const question = "how many did I add this month?";
    const [opening, ...more] = parseHtml(
      renderAnswerWindowOpening(question),
      new El("div"),
    ).children;
    expect(more).toEqual([]);
    expect(opening?.attributes).toEqual({ [ANSWER_WINDOW_ATTRIBUTE]: question });
    expect(opening?.textContent).toBe(ANSWER_WINDOW_OPENING);
    expect(opening?.children).toEqual([]);
  });

  test("a sentence she says is the sentence and nothing around it", () => {
    const sentence = "You added six notes this month.";
    const [said, ...more] = parseHtml(renderAnswerWindowSaying(sentence), new El("div")).children;
    expect(more).toEqual([]);
    expect(Object.keys(said?.attributes ?? {})).toHaveLength(1);
    expect(said?.textContent).toBe(sentence);
    expect(said?.children).toEqual([]);
  });
});
