import { describe, expect, test } from "bun:test";
import { readSource } from "../safety/source.test-support.ts";

// What the two stylesheets have to be saying for a marked field to show at all.

describe("the paint the marked state depends on", () => {
  const DESIGN = readSource("design/styles/components/form-controls.css");
  const PRODUCT = readSource("public/css/fields.css");

  /** One rule's body, by its exact selector list. */
  const body = (css: string, selector: string) => css.split(selector).at(1)?.split("}").at(0) ?? "";

  test("an empty slot takes no line, which the guidance's own display would deny it", () => {
    // `.field__guidance { display: block }` outranks the user agent's `[hidden]`, so
    // without this restatement every field on the form grows a blank line under it.
    expect(body(DESIGN, ".field__guidance[hidden] {")).toContain("display: none");
  });

  test("signal goes to the line that is the error, not to every line beside it", () => {
    expect(body(DESIGN, ".field.is-invalid .field__control {")).toContain("var(--well-alert)");
    expect(
      body(
        DESIGN,
        [
          ".field.is-invalid .field__guidance--error,",
          ".field.is-invalid .field__guidance.is-over {",
        ].join("\n"),
      ),
    ).toContain("var(--signal)");
    // And not the blanket rule this replaced: a declared hint and a character count stay
    // what they were while the field is invalid.
    expect(DESIGN).not.toContain(".field.is-invalid .field__guidance {");
  });

  test("the three controls with no well of their own still take the fill", () => {
    // A radio group and a segmented row are sets of their own marks and a checkbox is a
    // mark, so `.field__control` — the only thing the design recolours — is not there.
    expect(
      body(
        PRODUCT,
        [
          '.field--choice[data-choice-presentation="radio"].is-invalid,',
          '.field--choice[data-choice-presentation="segmented"].is-invalid,',
          ".field--inline.is-invalid {",
        ].join("\n"),
      ),
    ).toContain("var(--well-alert)");
  });
});
