// The photo control's host, in both renderer switches: what the server draws for
// `design/scripts/file-field.js` to fill and `public/file-field.js` to send, and what the form
// posts for the field before the browser has touched it.

import { describe, expect, test } from "bun:test";

import { admittedTypes } from "../../platform/files/admission.ts";
import { resolveMaxFileBytes } from "../../platform/files/file-cap.ts";
import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import { oversizeSentence } from "../../platform/files/refusal-copy.ts";
import { fileUploadPath } from "../../platform/files/upload-path.ts";
import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import {
  FILE_FIELD_TYPES,
  LIST_FIELD_TYPES,
  SCALAR_FIELD_TYPES,
  type SpecField,
} from "../../registry/index.ts";
import { FILE_CLEAR_VALUE } from "../../runtime/data/index.ts";
import { ALUNA_PRESENT_MARKER } from "../../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { submittedInputs } from "../fields/form-submission.test-support.ts";
import { renderableFromSpec } from "../fields/renderable-capability.ts";
import { codeOf } from "../safety/source.test-support.ts";

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

/** The host element's opening tag, which carries everything the browser reads. */
function hostTag(html: string): string {
  const start = html.indexOf('<div class="field file"');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf(">", start) + 1);
}

async function photoValue(html: string): Promise<string | undefined> {
  return (await submittedInputs(html)).find(([name]) => name === PHOTO_FIELD.name)?.[1];
}

describe("the photo control's host", () => {
  test("is the drawn control's mount, for the kind the field accepts, in the create form", () => {
    const tag = hostTag(renderCreateForm(photos()));
    expect(tag).toContain(`id="${CREATE_ID}" data-file-field data-kind="${KIND}"`);
    expect(renderCreateForm(photos())).toContain(
      `<span class="field__label caps" id="${CREATE_ID}-label">${PHOTO_FIELD.label}` +
        ` <span class="field__optional">optional</span></span><div data-file-body></div>`,
    );
  });

  test("names where its upload goes, the cap, and the sentence a file over the cap earns", () => {
    const tag = hostTag(renderCreateForm(photos()));
    const cap = resolveMaxFileBytes();
    expect(tag).toContain(
      `data-file-upload="${fileUploadPath(CAPABILITY, INCARNATION, PHOTO_FIELD.name)}"`,
    );
    expect(tag).toContain(`data-file-cap="${cap}"`);
    expect(tag).toContain(`data-file-oversize="${escapeHtml(oversizeSentence(cap))}"`);
  });

  test("offers every type admission takes a photo as, and no HEIC or HEIF", () => {
    const offered = /data-file-accept="([^"]*)"/.exec(hostTag(renderCreateForm(photos())))?.[1];
    expect(offered?.split(",")).toEqual([...admittedTypes(KIND)]);
    expect(offered).not.toContain("heic");
    expect(offered).not.toContain("heif");
  });

  test("has nowhere to send a file when the capability has no incarnation to receive it", () => {
    const { incarnationId: _, ...inspected } = photos();
    expect(hostTag(renderCreateForm(inspected))).not.toContain("data-file-upload");
  });

  test("posts its presence and an empty value on a create, and carries the clear", async () => {
    const form = renderCreateForm(photos());
    const inputs = await submittedInputs(form);
    expect(inputs).toContainEqual([ALUNA_PRESENT_MARKER, PHOTO_FIELD.name]);
    expect(await photoValue(form)).toBe("");
    expect(form).toContain(
      `data-file-value data-file-held-key="" data-file-clear-value="${FILE_CLEAR_VALUE}">`,
    );
  });

  test("opens an edit holding the record's photo, and posts its key to keep it", async () => {
    const key = mintFileKey();
    const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo: projection(key) });
    const tag = hostTag(form);
    expect(tag).toContain(`id="edit-${CAPABILITY}-${PHOTO_FIELD.name}"`);
    expect(tag).toContain(
      `data-holds-name="dawn.jpg" data-holds-size="2048" data-holds-src="${FILE_URL_PREFIX}${key}"`,
    );
    expect(await photoValue(form)).toBe(key);
    expect(form).toContain(`data-file-held-key="${key}"`);
  });

  test("opens an edit whose record holds no photo as an empty field posting nothing kept", async () => {
    const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo: null });
    expect(hostTag(form)).not.toContain("data-holds-");
    expect(await photoValue(form)).toBe("");
  });

  test("marks a required field, which the browser then refuses empty, and drops 'optional'", () => {
    const required = { ...PHOTO_FIELD, required: true };
    const form = renderCreateForm(photos({ fields: [CAPTION_FIELD, required] }));
    expect(form).toContain("data-file-required>");
    expect(form).toContain(`id="${CREATE_ID}-label">${PHOTO_FIELD.label}</span>`);
    expect(renderCreateForm(photos())).not.toContain("data-file-required");
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
      { ...projection(key), size: '1" data-file-upload="/elsewhere' },
      { ...projection(key), name: 7 },
      { ...projection(key), name: "" },
      { ...projection(key), extra: true },
    ];
    for (const photo of forged) {
      const form = renderEditForm(photos(), { id: "r1", caption: "Dawn", photo });
      expect(hostTag(form)).not.toContain("data-holds-");
      expect(hostTag(form)).not.toContain("/elsewhere");
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
      expect(form).toMatch(
        new RegExp(`type="submit"[^>]* data-held-save><span data-held-save-label>${words}</span>`),
      );
    }
  });

  test("is the only form whose save is held", () => {
    const textOnly = photos({ fields: [CAPTION_FIELD] });
    expect(renderCreateForm(textOnly)).not.toContain("data-held-save");
    expect(renderEditForm(textOnly, { id: "r1", caption: "Dawn" })).not.toContain("data-held-save");
  });
});

/**
 * A file field is its own kind of type, never a list or a scalar (PLAN decision 18), and a save
 * never carries bytes: an upload travels ahead of it (decision 8), so no form is ever multipart.
 */
describe("file fields in the form renderer", () => {
  test("stay apart from the list and scalar types", () => {
    for (const type of FILE_FIELD_TYPES) {
      expect([...SCALAR_FIELD_TYPES, ...LIST_FIELD_TYPES] as readonly string[]).not.toContain(type);
    }
  });

  test("never make a form carry a file's bytes", () => {
    const renderer = codeOf("src/presentation/fields/field-renderer.ts");
    for (const trace of ['type="file"', "FileList"]) {
      expect(renderer, `the field renderer names ${trace}`).not.toContain(trace);
    }
    for (const path of [
      "src/presentation/fields/field-renderer.ts",
      "src/presentation/controls/file-control.ts",
    ]) {
      for (const trace of ["multipart/form-data", "enctype", 'type="file"']) {
        expect(codeOf(path), `${path} names ${trace}`).not.toContain(trace);
      }
    }
  });
});
