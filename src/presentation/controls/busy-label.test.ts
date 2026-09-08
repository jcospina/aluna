// The browser reads the pending sentence off the attribute the server wrote, so neither side
// holds a copy of the words. What neither side can check for itself is that they still agree on
// the attribute names — a rename leaves every markup test green and every submit button silent.

import { describe, expect, test } from "bun:test";
import { BUSY_LABEL_ATTRIBUTE, IDLE_LABEL_ATTRIBUTE } from "#shell/shell-dom.js";
import { LOGO_ABSENT, NEVER_RENAMED } from "../../server/http/fragments.test-support.ts";
import { renderCapabilityLogo } from "../../server/http/fragments.ts";
import { readSource } from "../safety/source.test-support.ts";
import {
  ADDING_LABEL,
  busyLabelAttribute,
  DELETING_RECORD_LABEL,
  SAVING_RECORD_LABEL,
} from "./busy-label.ts";

const READERS = ["public/record-mutations.js", "public/logo-menu.js"] as const;

describe("the busy-label seam", () => {
  test("every browser reader reads the attributes through the shared names", () => {
    for (const reader of READERS) {
      const source = readSource(reader);
      expect(source, reader).toContain('from "./shell-dom.js"');
      expect(source, reader).toContain("BUSY_LABEL_ATTRIBUTE");
      expect(source, reader).toContain("IDLE_LABEL_ATTRIBUTE");
      // A literal here is a copy that a rename would leave behind.
      expect(source, reader).not.toContain(`"${BUSY_LABEL_ATTRIBUTE}"`);
      expect(source, reader).not.toContain(`"${IDLE_LABEL_ATTRIBUTE}"`);
    }
  });

  test("no reader restates a label the server authored", () => {
    for (const reader of READERS) {
      const source = readSource(reader);
      for (const label of ["Add", "Save", "Delete record", ADDING_LABEL, SAVING_RECORD_LABEL]) {
        expect(source, `${reader} restates ${label}`).not.toContain(`"${label}"`);
      }
    }
  });

  test("every submit control the platform renders carries its busy sentence", () => {
    // The rename editor's Save is the one the record-form tests cannot see.
    const logo = renderCapabilityLogo({
      id: "notes",
      label: "Notes",
      incarnation_id: "11111111-1111-4111-8111-111111111111",
      logo: LOGO_ABSENT,
      ...NEVER_RENAMED,
    });
    expect(logo).toContain(`${BUSY_LABEL_ATTRIBUTE}=`);
  });

  test("the attribute helper escapes what it writes", () => {
    expect(busyLabelAttribute("x")).toBe(` ${BUSY_LABEL_ATTRIBUTE}="x"`);
    expect(busyLabelAttribute('a"b')).toBe(` ${BUSY_LABEL_ATTRIBUTE}="a&quot;b"`);
    for (const label of [ADDING_LABEL, SAVING_RECORD_LABEL, DELETING_RECORD_LABEL]) {
      expect(label.trim()).not.toBe("");
    }
  });
});
