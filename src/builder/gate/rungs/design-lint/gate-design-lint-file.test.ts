// A card may show a file field (PLAN decision 29). Design lint hands the renderer a scratch file
// named with markup, a bidirectional override and an emoji, and contrasts it with no file at all,
// the case a template most often forgets (PLAN decision 38).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import { describe, expect, test } from "bun:test";
import { enforceItemMarkup } from "../../../../presentation/index.ts";
import { photoSpec } from "../../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec } from "../../../../registry/index.ts";
import { validSpec } from "../../../../registry/spec/spec.test-support.ts";
import { FEW_SHOT_DESIGN_EXAMPLES } from "../../../units/generation/few-shot-gallery.ts";
import { ESCAPE_HELPER } from "../../../units/generation/unit-fixtures.test-support.ts";
import { loadItemRenderer } from "../../gate-internal.ts";
import { findDesignViolation } from "./gate-design-lint.ts";

function showingThePhoto() {
  const spec = photoSpec();
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["caption", "photo"] } },
  };
}

const renderer = (photo: string) =>
  [
    "export default function renderItem(record: Record<string, unknown>): string {",
    '  const caption = escapeHtml(record.caption ?? "");',
    "  const file = record.photo as { url: string; name: string } | null;",
    `  const photo = ${photo};`,
    "  return `<span>${caption}</span>${photo}`;",
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");

const DRAWS_BOTH =
  'file ? `<img src="${escapeHtml(file.url)}" alt="">` : "<span>No photo yet</span>"';

describe("a card that shows a file field", () => {
  test("passes when it draws the picture from its url and an empty state for none", () => {
    expect(findDesignViolation(showingThePhoto(), renderer(DRAWS_BOTH))).toBeUndefined();
  });

  test("fails when it forgets the empty field", () => {
    const forgets = '`<img src="${escapeHtml(file!.url)}" alt="">`';
    expect(findDesignViolation(showingThePhoto(), renderer(forgets))).toContain(
      "the renderer threw",
    );
  });

  test("fails when it never draws the photo it declares", () => {
    expect(findDesignViolation(showingThePhoto(), renderer('""'))).toContain(
      'declared item field "photo"',
    );
  });

  test("says so when a card that shows only the photo draws nothing without one", () => {
    const photoOnly = {
      ...showingThePhoto(),
      ui_intent: {
        ...showingThePhoto().ui_intent,
        item: { ...showingThePhoto().ui_intent.item, shows: ["photo"] },
      },
    };
    const source = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const file = record.photo as { url: string } | null;",
      '  return file ? `<img src="${escapeHtml(file.url)}" alt="">` : "";',
      "}",
      "",
      ESCAPE_HELPER,
    ].join("\n");
    expect(findDesignViolation(photoOnly, source)).toContain(
      'drew nothing for a record whose file field "photo" holds no file',
    );
  });

  test("fails when it writes the file's name unescaped", () => {
    const raw = 'file ? `<span>${file.name}</span>` : "<span>No photo yet</span>"';
    expect(findDesignViolation(showingThePhoto(), renderer(raw))).toContain(
      "the platform enforcer had to neutralize the output",
    );
  });

  test("still fails when a shown text field is discarded", () => {
    const discards = renderer(DRAWS_BOTH).replace(
      'escapeHtml(record.caption ?? "")',
      '"A caption"',
    );
    expect(findDesignViolation(showingThePhoto(), discards)).toContain(
      'declared item field "caption"',
    );
  });
});

describe("the photo exemplar", () => {
  const example = FEW_SHOT_DESIGN_EXAMPLES.find(({ id }) => id === "photo_grid_tile");
  if (!example) throw new Error("Expected the photo_grid_tile exemplar.");

  function exemplarSpec(): CapabilitySpec {
    const base = validSpec();
    const fields = example?.capability.schema.fields ?? [];
    return validSpec({
      id: example?.capability.id,
      label: example?.capability.label,
      noun: example?.capability.noun,
      schema: { fields: fields.map((field) => ({ ...field })) },
      ui_intent: {
        ...base.ui_intent,
        collection: { ...base.ui_intent.collection, layout: "grid" },
        item: { ...base.ui_intent.item, shows: fields.map((field) => field.name) },
      },
    });
  }

  test("declares a file field that accepts images", () => {
    const photo = example.capability.schema.fields.find(({ name }) => name === "photo");
    expect(photo).toMatchObject({ type: "file", accepts: ["image"], required: false });
  });

  test("clears design lint over its own capability", () => {
    expect(findDesignViolation(exemplarSpec(), example.rendererSource)).toBeUndefined();
  });

  test("renders each preview as drawn, the picture from its url and none as the empty frame", () => {
    const renderItem = loadItemRenderer(example.rendererSource);
    const collapse = (markup: string) => markup.replace(/>\s+</g, "><");
    for (const sample of example.previewSamples) {
      expect(collapse(enforceItemMarkup(renderItem(sample.record)))).toBe(sample.previewInnerHtml);
    }
    expect(example.previewSamples.map(({ record }) => record.photo === null)).toEqual([
      false,
      true,
    ]);
  });
});
