// The browser reads the pending sentence off the attribute the server wrote, so neither side
// holds a copy of the words. What neither side can check for itself is that they still agree on
// the attribute names — a rename leaves every markup test green and every submit button silent,
// so the reader is run on what the renderers write. The logo's rename Save is run the same way,
// on its real markup, by `logo-menu.test.ts` ("the rename that is on its way").

import { describe, expect, test } from "bun:test";
import { BUSY_LABEL_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { setPending } from "#shell/records/record-mutations.js";
import { renderCreateForm } from "../fields/field-renderer.ts";
import {
  CAPABILITY,
  RECORD,
  TEMPLATE_ID,
} from "../records/record-view/record-view.test-support.ts";
import { renderRecordView } from "../records/record-view/record-view.ts";
import {
  ADDING_LABEL,
  busyLabelAttribute,
  DELETING_RECORD_LABEL,
  SAVING_RECORD_LABEL,
} from "./busy-label.ts";
import { installDomGlobals } from "./double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "./double/choice-picker.test-support.ts";

installDomGlobals();

describe("the busy-label seam", () => {
  test("every record form's submit says the server's sentence while it waits, then its own", () => {
    const page = parseHtml(
      renderCreateForm(CAPABILITY) + renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID),
      new Doc(),
    );
    const said = page.querySelectorAll("form").map((form) => {
      const submit = form.querySelector('button[type="submit"]') as El;
      const idle = submit.textContent;
      setPending(form as never, true, "[data-no-cancel]");
      const busy = [submit.textContent, submit.disabled];
      setPending(form as never, false, "[data-no-cancel]");
      expect(submit.textContent).toBe(idle);
      expect(submit.disabled).toBe(false);
      return busy;
    });
    expect(said).toEqual([
      [ADDING_LABEL, true],
      [SAVING_RECORD_LABEL, true],
      [DELETING_RECORD_LABEL, true],
    ]);
  });

  test("the attribute helper escapes what it writes", () => {
    expect(busyLabelAttribute("x")).toBe(` ${BUSY_LABEL_ATTRIBUTE}="x"`);
    expect(busyLabelAttribute('a"b')).toBe(` ${BUSY_LABEL_ATTRIBUTE}="a&quot;b"`);
    for (const label of [ADDING_LABEL, SAVING_RECORD_LABEL, DELETING_RECORD_LABEL]) {
      expect(label.trim()).not.toBe("");
    }
  });
});
