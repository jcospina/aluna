import { describe, expect, test } from "bun:test";
import { codeOf } from "../../safety/source.test-support.ts";

// The control is `design/scripts/controls/list-rows.js`; `public/controls/list-field.js` is only the product's
// half of the seam, and `list-field.test.ts` runs the gestures on the server's own rows.

const MODULE = codeOf("public/controls/list-field.js");
const GLUE = codeOf("public/app.js");

describe("the rows a list field is typed into", () => {
  test("the product answers no gesture itself: the control it takes does", () => {
    // A second dispatcher in the product is how the two halves drift apart.
    for (const gesture of ["click", "pointerdown", "pointermove", "pointerup", "keydown"]) {
      expect(MODULE, `the product answers ${gesture} itself`).not.toContain(`"${gesture}"`);
    }
  });

  test("the product takes the control from the design layer rather than keeping a copy", () => {
    // The rules live in `design/scripts/controls/list-rows.js` and nowhere else — a second
    // implementation under public/ is the defect this asserts against.
    for (const rule of ["querySelectorAll(ROW)", "cloneNode(true)", 'setAttribute("disabled"']) {
      expect(MODULE).not.toContain(rule);
    }
  });

  test("the glue kept none of it", () => {
    expect(GLUE).not.toContain("ListRow");
    expect(GLUE).not.toContain("data-list-field");
  });
});
