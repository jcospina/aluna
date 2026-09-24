// The form's file stand-in, in both renderer switches: it shows the field's label and hint and
// submits nothing, so the merge-patch rule decides what a save does to the column.

import { describe, expect, test } from "bun:test";

import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import { FILE_FIELD_TYPES, LIST_FIELD_TYPES, SCALAR_FIELD_TYPES } from "../../registry/index.ts";
import { ALUNA_PRESENT_MARKER } from "../../runtime/router/wire/wire-protocol.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { submittedInputs } from "../fields/form-submission.test-support.ts";
import { renderableFromSpec } from "../fields/renderable-capability.ts";
import { codeOf } from "../safety/source.test-support.ts";

const HINT = "A picture of the whole plant.";

function photos(guidance: readonly { field: string; text: string }[] = []) {
  const spec = photoSpec();
  const form = { ...spec.ui_intent.form, guidance: [...guidance] };
  return renderableFromSpec({ ...spec, ui_intent: { ...spec.ui_intent, form } });
}

/** The field names a form submits, whether as a value or as a presence marker. */
async function submittedNames(html: string): Promise<string[]> {
  return (await submittedInputs(html)).flatMap(([name, value]) =>
    name === ALUNA_PRESENT_MARKER ? [value] : [name],
  );
}

describe("the file stand-in", () => {
  test("shows the field's label in the create form and submits nothing for it", async () => {
    const form = renderCreateForm(photos());
    expect(form).toContain(
      `<div class="field" data-file-stand-in="${PHOTO_FIELD.name}">` +
        `<span class="field__label caps" id="cap-photos-photo-label">${PHOTO_FIELD.label}` +
        ` <span class="field__optional">optional</span></span>`,
    );
    expect(await submittedNames(form)).toEqual([CAPTION_FIELD.name, CAPTION_FIELD.name]);
  });

  test("shows the field's label in the edit form and submits nothing for it", async () => {
    const stored = { id: "r1", caption: "A day out", photo: { url: "/files/k", name: "a.jpg" } };
    const form = renderEditForm(photos(), stored);
    expect(form).toContain(`data-file-stand-in="${PHOTO_FIELD.name}"`);
    expect(form).not.toContain("/files/k");
    expect(await submittedNames(form)).not.toContain(PHOTO_FIELD.name);
  });

  test("shows the field's declared hint in the slot every field carries", () => {
    const form = renderCreateForm(photos([{ field: PHOTO_FIELD.name, text: HINT }]));
    expect(form).toContain(
      `<p class="field__guidance" id="cap-photos-photo-guidance" data-field-guidance>${HINT}</p>`,
    );
    const bare = renderCreateForm(photos());
    expect(bare).toContain('id="cap-photos-photo-guidance" data-field-guidance hidden>');
  });

  test("never claims the drawn control's mount hook", () => {
    expect(renderCreateForm(photos())).not.toContain("data-file-field");
  });

  test("escapes the label it shows", () => {
    const capability = photos();
    const hostile = { ...PHOTO_FIELD, label: '<img src=x onerror="alert(1)">' };
    const form = renderCreateForm({ ...capability, schema: { fields: [hostile] } });
    expect(form).not.toContain("<img");
    expect(form).toContain("&lt;img src=x");
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
      for (const trace of ["multipart/form-data", "enctype"]) {
        expect(codeOf(path), `${path} names ${trace}`).not.toContain(trace);
      }
    }
  });
});
