// Regression coverage for the design-lint record-content probes. These tests exercise
// observable renderer behavior: declared item fields must affect perceivable composition,
// while the Gate remains neutral about the exact words and formatting used.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import { describe, expect, test } from "bun:test";

import type { CapabilitySpec } from "../registry/index.ts";
import { expectGateFailure, gateInput, notesSpec } from "./gate.test-support.ts";
import { findDesignViolation } from "./gate-design-lint.ts";

const ESCAPE_HELPER = [
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

const EMPTY_COMPOSITION_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  "  if (record.text) { /* declared access with no presentational effect */ }",
  '  return `<div class="stack"></div>`;',
  "}",
].join("\n");

describe("design-lint record-content integrity", () => {
  test("rejects discarded declared content through the complete Gate", async () => {
    const error = await expectGateFailure(
      gateInput({
        itemRenderer: EMPTY_COMPOSITION_RENDERER,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );

    expect(error.failedRung).toBe("design-lint");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:failed",
    ]);
    expect(error.outcomes.at(-1)?.error).toContain("meaningful, record-dependent content");
  });

  test("requires every declared item field to affect perceivable composition", () => {
    const spec = notesSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show note text and pinned state.", shows: ["text", "pinned"] },
        collection: { layout: "feed" },
        detail: { shows: ["text", "pinned"] },
      },
    });
    const partialComposition = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  if (record.text) { /* access text, but discard it */ }",
      '  return `<span>${record.pinned === true ? "Pinned" : "Not pinned"}</span>`;',
      "}",
    ].join("\n");

    expect(findDesignViolation(spec, partialComposition)).toContain('declared item field "text"');
  });

  test("does not mistake record-dependent ARIA state for perceivable record content", () => {
    const stateOnlyComposition = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  return `<span aria-hidden="${Boolean(record.text)}"></span>`;',
      "}",
    ].join("\n");

    expect(findDesignViolation(notesSpec(), stateOnlyComposition)).toContain(
      "meaningful, record-dependent content",
    );
  });

  test("accepts boolean, date, and list composition without prescribing format", () => {
    expect(
      findDesignViolation(singleFieldSpec("done", "boolean"), BOOLEAN_RENDERER),
    ).toBeUndefined();
    expect(findDesignViolation(singleFieldSpec("due_on", "date"), DATE_RENDERER)).toBeUndefined();
    expect(findDesignViolation(singleFieldSpec("tags", "string[]"), LIST_RENDERER)).toBeUndefined();
  });
});

function singleFieldSpec(name: string, type: "boolean" | "date" | "string[]"): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: [{ name, label: name, type, required: true, lifecycle: "active" }],
    },
    ui_intent: {
      form: {
        list_inputs: type === "string[]" ? [{ field: name, mode: "comma_separated" }] : [],
      },
      item: { direction: `Present ${name} clearly.`, shows: [name] },
      collection: { layout: "feed" },
      detail: { shows: [name] },
    },
  });
}

const BOOLEAN_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  '  return `<span>${record.done === true ? "Complete" : "Not complete"}</span>`;',
  "}",
].join("\n");

const DATE_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  '  const dueOn = escapeHtml(record.due_on ?? "");',
  '  return `<time datetime="${dueOn}">${dueOn}</time>`;',
  "}",
  "",
  ESCAPE_HELPER,
].join("\n");

const LIST_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  "  const tags = Array.isArray(record.tags) ? record.tags : [];",
  '  return `<ul>${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>`;',
  "}",
  "",
  ESCAPE_HELPER,
].join("\n");
