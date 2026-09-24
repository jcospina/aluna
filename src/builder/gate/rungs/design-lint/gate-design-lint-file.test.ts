// A card may show a file field (PLAN decision 29), but until the Gate can mint a scratch
// reference (7.1/06) every probe holds `null` there. Design lint must not demand a contrast the
// field cannot make, and must still hold every other shown field to one.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import { describe, expect, test } from "bun:test";

import { photoSpec } from "../../../../registry/fields/file.test-support.ts";
import { ESCAPE_HELPER } from "../../../units/generation/unit-fixtures.test-support.ts";
import { findDesignViolation } from "./gate-design-lint.ts";

function showingThePhoto() {
  const spec = photoSpec();
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["caption", "photo"] } },
  };
}

const renderer = (caption: string) =>
  [
    "export default function renderItem(record: Record<string, unknown>): string {",
    `  const caption = ${caption};`,
    '  return `<span>${caption}</span><span>${record.photo === null ? "No photo" : "Photo"}</span>`;',
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");

describe("a card that shows a file field", () => {
  test("passes when every other shown field reaches the composition", () => {
    expect(
      findDesignViolation(showingThePhoto(), renderer('escapeHtml(record.caption ?? "")')),
    ).toBeUndefined();
  });

  test("still fails when a shown text field is discarded", () => {
    expect(findDesignViolation(showingThePhoto(), renderer('"A caption"'))).toContain(
      'declared item field "caption"',
    );
  });

  test("never meets a hostile string there: every probe leaves a file field empty", () => {
    // Writes the field raw if it ever holds text, so a hostile probe there would be neutralized.
    const trusting = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  const caption = escapeHtml(record.caption ?? "");',
      '  const photo = typeof record.photo === "string" ? record.photo : "No photo";',
      "  return `<span>${caption}</span><span>${photo}</span>`;",
      "}",
      "",
      ESCAPE_HELPER,
    ].join("\n");
    expect(findDesignViolation(showingThePhoto(), trusting)).toBeUndefined();
  });
});
