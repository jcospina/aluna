// The photo control's host, in both renderer switches: what the server draws for
// `design/scripts/file-field.js` to fill and `public/file-field.js` to send, and what the form
// posts for the field before the browser has touched it.

import { describe, expect, test } from "bun:test";

import { FILE_FIELD_HOOKS as HOOKS } from "#design/file-field.js";
import { FILE_FIELD_ATTRIBUTES as WIRE } from "#shell/shell-dom.js";
import { admittedTypes } from "../../platform/files/admission.ts";
import { resolveMaxFileBytes } from "../../platform/files/file-cap.ts";
import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import { oversizeSentence } from "../../platform/files/refusal-copy.ts";
import { fileUploadPath } from "../../platform/files/upload-path.ts";
import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import type { SpecField } from "../../registry/index.ts";
import { FILE_CLEAR_VALUE } from "../../runtime/data/index.ts";
import { ALUNA_PRESENT_MARKER } from "../../runtime/router/wire/wire-protocol.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { submittedInputs } from "../fields/form-submission.test-support.ts";
import { renderableFromSpec } from "../fields/renderable-capability.ts";
import { codeOf } from "../safety/source.test-support.ts";
import { El, parseHtml } from "./choice-picker.test-support.ts";
import { hooked } from "./file-field.test-support.ts";

const HINT = "A picture of the whole plant.";
const INCARNATION = "inc-7";
const { id: CAPABILITY } = photoSpec();
const [KIND = ""] = PHOTO_FIELD.accepts ?? [];
const CREATE_ID = `cap-${CAPABILITY}-${PHOTO_FIELD.name}`;

function photos(
  options: { guidance?: { field: string; text: string }[]; fields?: SpecField[] } = {},
) {
  const spec = photoSpec(options.fields);
  const form = { ...spec.ui_intent.form, guidance: [...(options.guidance ?? [])] };
  const capability = renderableFromSpec({ ...spec, ui_intent: { ...spec.ui_intent, form } });
  return { ...capability, incarnationId: INCARNATION };
}

function projection(key: string, name = "dawn.jpg") {
  return { url: `${FILE_URL_PREFIX}${key}`, name, kind: KIND, mime: "image/jpeg", size: 2048 };
}

/** The form parsed, and the host element in it that carries everything the browser reads. */
function hostOf(html: string): El {
  const host = parseHtml(html, new El("div")).querySelector(hooked(HOOKS.field));
  expect(host).not.toBeNull();
  return host as El;
}

const postedInput = (host: El) => host.querySelector(hooked(WIRE.value)) as El;

async function photoValue(html: string): Promise<string | undefined> {
  return (await submittedInputs(html)).find(([name]) => name === PHOTO_FIELD.name)?.[1];
}

describe("the photo control's host", () => {
  test("is the drawn control's mount, for the kind the field accepts, in the create form", () => {
    const host = hostOf(renderCreateForm(photos()));
    expect(host.id).toBe(CREATE_ID);
    expect(host.getAttribute(HOOKS.kind)).toBe(KIND);
    const label = host.querySelector(`[id="${host.id}-label"]`);
    expect(label?.textContent).toStartWith(PHOTO_FIELD.label);
    expect(host.querySelector(hooked(HOOKS.body))?.children).toEqual([]);
  });

  test("names where its upload goes, the cap, and the sentence a file over the cap earns", () => {
    const host = hostOf(renderCreateForm(photos()));
    const cap = resolveMaxFileBytes();
    expect(host.getAttribute(WIRE.upload)).toBe(
      fileUploadPath(CAPABILITY, INCARNATION, PHOTO_FIELD.name),
    );
    expect(host.getAttribute(WIRE.cap)).toBe(String(cap));
    expect(host.getAttribute(WIRE.oversize)).toBe(oversizeSentence(cap));
  });

  test("offers every type admission takes a photo as, and no HEIC or HEIF", () => {
    const offered = hostOf(renderCreateForm(photos())).getAttribute(HOOKS.accept);
    expect(offered?.split(",")).toEqual([...admittedTypes(KIND)]);
    expect(offered).not.toContain("heic");
    expect(offered).not.toContain("heif");
  });

  test("has nowhere to send a file when the capability has no incarnation to receive it", () => {
    const { incarnationId: _, ...inspected } = photos();
    expect(hostOf(renderCreateForm(inspected)).hasAttribute(WIRE.upload)).toBe(false);
  });

  test("posts its presence and an empty value on a create, and carries the clear", async () => {
    const form = renderCreateForm(photos());
    const inputs = await submittedInputs(form);
    expect(inputs).toContainEqual([ALUNA_PRESENT_MARKER, PHOTO_FIELD.name]);
    expect(await photoValue(form)).toBe("");
    const value = postedInput(hostOf(form));
    expect(value.getAttribute(WIRE.heldKey)).toBe("");
    expect(value.getAttribute(WIRE.clearValue)).toBe(FILE_CLEAR_VALUE);
  });

  test("opens an edit holding the record's photo, and posts its key to keep it", async () => {
    const key = mintFileKey();
    const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo: projection(key) });
    const host = hostOf(form);
    expect(host.id).toBe(`edit-${CAPABILITY}-${PHOTO_FIELD.name}`);
    expect(host.getAttribute(HOOKS.holdsName)).toBe("dawn.jpg");
    expect(host.getAttribute(HOOKS.holdsSize)).toBe("2048");
    expect(host.getAttribute(HOOKS.holdsSrc)).toBe(`${FILE_URL_PREFIX}${key}`);
    expect(await photoValue(form)).toBe(key);
    expect(postedInput(host).getAttribute(WIRE.heldKey)).toBe(key);
  });

  test("opens an edit whose record holds no photo as an empty field posting nothing kept", async () => {
    const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo: null });
    expect(hostOf(form).hasAttribute(HOOKS.holdsName)).toBe(false);
    expect(await photoValue(form)).toBe("");
  });

  test("marks a required field, which the browser then refuses empty, and drops 'optional'", () => {
    const required = { ...PHOTO_FIELD, required: true };
    const host = hostOf(renderCreateForm(photos({ fields: [CAPTION_FIELD, required] })));
    expect(postedInput(host).hasAttribute(WIRE.required)).toBe(true);
    expect(host.querySelector(`[id="${host.id}-label"]`)?.textContent).toBe(PHOTO_FIELD.label);
    expect(postedInput(hostOf(renderCreateForm(photos()))).hasAttribute(WIRE.required)).toBe(false);
  });

  test("shows the field's declared hint in the slot every field carries", () => {
    const form = renderCreateForm(photos({ guidance: [{ field: PHOTO_FIELD.name, text: HINT }] }));
    expect(form).toContain(
      `<p class="field__guidance" id="${CREATE_ID}-guidance" data-field-guidance>${HINT}</p>`,
    );
    const bare = renderCreateForm(photos());
    expect(bare).toContain(`id="${CREATE_ID}-guidance" data-field-guidance hidden>`);
  });

  test("draws a held value that is not a whole projection as an empty field", async () => {
    const key = mintFileKey();
    const forged = [
      { ...projection(key), size: `1" ${WIRE.upload}="/elsewhere` },
      { ...projection(key), name: 7 },
      { ...projection(key), name: "" },
      { ...projection(key), extra: true },
    ];
    for (const photo of forged) {
      const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo });
      const host = hostOf(form);
      expect(host.hasAttribute(HOOKS.holdsName)).toBe(false);
      expect(form).not.toContain("/elsewhere");
      expect(await photoValue(form)).toBe("");
    }
  });

  test("escapes the label and the held file's name it draws", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const capability = photos({ fields: [CAPTION_FIELD, { ...PHOTO_FIELD, label: hostile }] });
    const record = { id: "r1", caption: "Dawn", photo: projection(mintFileKey(), hostile) };
    for (const form of [renderCreateForm(capability), renderEditForm(capability, record)]) {
      expect(form).not.toContain("<img");
      expect(form).toContain("&lt;img src=x");
    }
  });
});

describe("a form holding a photo", () => {
  test("has a save the control can hold, its words in a label of their own", () => {
    const record = { id: "r1", caption: "Dawn", photo: null };
    for (const [form, words] of [
      [renderCreateForm(photos()), "Add"],
      [renderEditForm(photos(), record), "Save"],
    ] as const) {
      const save = parseHtml(form, new El("div")).querySelector('button[type="submit"]');
      expect(save?.hasAttribute(HOOKS.save)).toBe(true);
      expect(save?.querySelector(hooked(HOOKS.saveLabel))?.textContent).toBe(words);
    }
  });

  test("is the only form whose save is held", () => {
    const textOnly = photos({ fields: [CAPTION_FIELD] });
    expect(renderCreateForm(textOnly)).not.toContain(HOOKS.save);
    expect(renderEditForm(textOnly, { id: "r1", caption: "Dawn" })).not.toContain(HOOKS.save);
  });
});

/** A save never carries bytes: an upload travels ahead of it (decision 8), so no form is multipart. */
describe("file fields in the form renderer", () => {
  test("never make a form carry a file's bytes", () => {
    for (const path of [
      "src/presentation/fields/field-renderer.ts",
      "src/presentation/controls/file-control.ts",
    ]) {
      for (const trace of ["multipart/form-data", "enctype", 'type="file"', "FileList"]) {
        expect(codeOf(path), `${path} names ${trace}`).not.toContain(trace);
      }
    }
  });
});
