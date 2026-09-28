import { describe, expect, test } from "bun:test";
import { readSource } from "../safety/source.test-support.ts";
import { characterCountSentence } from "./field-chrome.ts";

describe("the counter's words", () => {
  test("the design bench draws the same words, which it restates rather than imports", () => {
    // `design/scripts/` is the contract page's own code and imports nothing of the product's, so
    // the counter is written out there a second time. This is what keeps the two from drifting:
    // a wording change that reached only one of them used to rewrite the counter mid-keystroke.
    const bench = readSource("design/scripts/controls-main.js");

    // Read off the leaf rather than retyped, so a reworded counter fails here rather than
    // drifting: the bench interpolates the figure and the plural, so the words either side of
    // them are what both sides have in common.
    const over = characterCountSentence(1, 2);
    const singular = characterCountSentence(2, 1);

    expect(bench).toContain(over.slice(over.indexOf(" ") + 1));
    for (const word of singular.split(" ").slice(1)) {
      expect(bench, `the bench does not draw "${word}"`).toContain(word);
    }
  });
});

// Small caps is a role the design system owns, and the sheet used to copy all five of its
// declarations out under `.field__label` — the restate-instead-of-reuse this epic removed.
describe("a field label takes the shared caps role rather than restating it", () => {
  test("the sheet states only what the role does not", () => {
    const rule =
      /\.field__label \{([\s\S]*?)\}/.exec(readSource("public/css/fields.css"))?.[1] ?? "";

    expect(rule).toContain("font-family");
    expect(rule).toContain("line-height");
    for (const restated of [
      "font-size",
      "font-weight",
      "text-transform",
      "letter-spacing",
      "color",
    ]) {
      expect(
        rule,
        `.field__label restates \`${restated}\`, which \`.caps\` already says`,
      ).not.toContain(restated);
    }
  });
});
