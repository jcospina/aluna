// A photo field's guidance slot has two authors: the photo control, which says its own refusals
// there (`design/scripts/file-field.js`), and this module, which says a save's. Each puts back
// only what it took, and a refusal that names the photo lands on the control a person can reach.

import { describe, expect, test } from "bun:test";

import { FILE_FIELD_HOOKS, FileRefusal, pickInto } from "#design/file-field.js";
import { NOT_ADMITTED_SENTENCES } from "../../platform/files/refusal-copy.ts";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import type { El } from "../controls/choice-picker.test-support.ts";
import { drawnFileFields, refusing } from "../controls/file-field.test-support.ts";
import { capabilityOf, requiredRefusal, scene, tick } from "./field-errors.test-support.ts";
import { probeField } from "./field-renderer.test-support.ts";

installDomGlobals();
const mountFileFields = drawnFileFields();

const REFUSAL = NOT_ADMITTED_SENTENCES.image;

/** An optional photo before a required caption, the photo drawn by its control. */
async function photoAndCaption() {
  const one = await scene(
    capabilityOf([
      probeField("file", { name: "photo", label: "Photo", required: false }),
      probeField("string", { name: "caption", label: "Caption" }),
    ]),
  );
  mountFileFields(one.doc, refusing(new FileRefusal("signature", REFUSAL)));
  const host = one.fieldNamed("photo");
  const pick = host.querySelector(`[${FILE_FIELD_HOOKS.focus}]`);
  expect(pick?.tag).toBe("button");
  return { ...one, host, pick: pick as El };
}

/** A pick into the empty field, which the control refuses in the field's own slot. */
async function refusePick(host: El) {
  pickInto(host as never, { name: "leaf.heic", type: "image/heic", size: 3 });
  await tick();
}

describe("a photo field's guidance, which the control also writes", () => {
  test("keeps the control's refusal through a save's answer about another field", async () => {
    const one = await photoAndCaption();
    await refusePick(one.host);
    one.landRefusal(requiredRefusal(["caption"]));
    expect(one.saidIn("photo")).toBe(REFUSAL);
    expect(one.isInvalid("photo")).toBe(true);
    expect(one.slotOf("photo").classList.contains("field__guidance--error")).toBe(true);
  });

  test("gives the control's refusal back, as it was, once a save's verdict on the photo goes", async () => {
    const one = await photoAndCaption();
    await refusePick(one.host);
    one.landRefusal(requiredRefusal(["photo"]));
    expect(one.saidIn("photo")).not.toBe(REFUSAL);
    expect(one.isInvalid("photo")).toBe(true);
    one.doc.fire("reset", one.form);
    expect(one.saidIn("photo")).toBe(REFUSAL);
    expect(one.isInvalid("photo")).toBe(true);
    expect(one.slotOf("photo").classList.contains("field__guidance--error")).toBe(true);
  });

  test("lets a verdict go without putting anything back once the control says itself again", async () => {
    const one = await photoAndCaption();
    one.landRefusal(requiredRefusal(["photo"]));
    await refusePick(one.host);
    one.doc.fire("reset", one.form);
    expect(one.saidIn("photo")).toBe(REFUSAL);
  });

  test("never counts the control's own refusal as a field the browser's check marked", async () => {
    const one = await photoAndCaption();
    await refusePick(one.host);
    one.reportMissing("caption");
    await tick();
    expect(one.doc.activeElement).toBe(one.doc.querySelector('[name="caption"]'));
  });

  test("puts a person on the photo control when a save's refusal names the photo", async () => {
    const one = await photoAndCaption();
    one.landRefusal(requiredRefusal(["photo"]));
    expect(one.doc.activeElement).toBe(one.pick);
    expect(one.pick.hasAttribute("aria-invalid")).toBe(false);
  });
});
