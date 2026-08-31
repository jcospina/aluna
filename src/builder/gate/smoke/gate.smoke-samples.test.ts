// The Gate's scratch samples for the two field types whose values are not free text: a
// `string[]` is an ordered list and a `choice` may only ever hold a value its field
// declares. Both drive one complete CRUD cycle plus the design probes.

import { describe, expect, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../../../capability-data/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import { isSearchSchemaInput, specActionTestInputs } from "../behavioral/behavioral-test-inputs.ts";
import { fullHandlersFor, gateInput, notesSpec } from "../gate.test-support.ts";
import { runCapabilityGate } from "../gate.ts";

describe("capability gate — string[] ordered-list samples", () => {
  test("Gate smoke and design samples exercise string[] as an ordered list", async () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
        ],
      },
      ui_intent: {
        form: {
          list_inputs: [{ field: "tags", mode: "repeatable" }],
          choice_inputs: [],
          long_text: [],
          guidance: [],
        },
        item: { direction: "Show each tag in order.", shows: ["tags"] },
        collection: { layout: "feed" },
      },
      behavior: "At least one tag is required and tag order is preserved.",
      behavioral_errors: [
        {
          action: "create",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["tags"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
        {
          action: "update",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["tags"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
    });
    const create = [
      "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
      "  const tags = input.values.tags;",
      '  if (!Array.isArray(tags)) return "<p>missing</p>";',
      "  return present(mutation.create({ tags: [...tags] }));",
      "}",
    ].join("\n");
    const read = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      "  });",
      '  return rows.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const tags = Array.isArray(record.tags) ? record.tags : [];",
      '  return `<div class="stack">$' +
        '{tags.map((tag) => `<span class="text-sm">$' +
        '{escapeHtml(String(tag))}</span>`).join("")}</div>`;',
      "}",
      "function escapeHtml(value: string): string {",
      '  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
      "}",
    ].join("\n");

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        handlers: fullHandlersFor(spec, { create, read }),
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });
});

/** The notes capability with one required choice field carrying two declared options. */
function choiceSpec() {
  return notesSpec({
    schema: {
      fields: [
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: true,
          lifecycle: "active",
          values: [
            { value: "draft", label: "Draft" },
            { value: "sent", label: "Sent" },
          ],
          groups: [],
        },
      ],
    },
    ui_intent: {
      form: {
        list_inputs: [],
        choice_inputs: [{ field: "stage", presentation: "picker" }],
        long_text: [],
        guidance: [],
      },
      item: { direction: "Show the stage plainly.", shows: ["stage"] },
      collection: { layout: "feed" },
    },
    behavior: "A stage is required and is one of the declared values.",
    behavioral_errors: (["create", "update"] as const).map((action) => ({
      action,
      trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["stage"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    })),
  });
}

describe("capability gate — choice samples", () => {
  test("Gate smoke and design samples drive a choice through its declared options", async () => {
    const spec = choiceSpec();
    const create = [
      "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
      "  const stage = input.values.stage;",
      '  if (typeof stage !== "string") return "<p>missing</p>";',
      "  return present(mutation.create({ stage }));",
      "}",
    ].join("\n");
    const read = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      "  });",
      '  return rows.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  return `<span class="text-sm">$' + '{escapeHtml(String(record.stage ?? ""))}</span>`;',
      "}",
      "function escapeHtml(value: string): string {",
      '  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
      "}",
    ].join("\n");

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        handlers: fullHandlersFor(spec, { create, read }),
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("a choice is searchable text, so its column reaches the generated search projection", () => {
    const spec = choiceSpec();
    const search = specActionTestInputs(spec).find((entry) => entry.action === "search");
    const schema = search?.schema;
    if (!schema || !isSearchSchemaInput(schema)) throw new Error("search projects no schema");
    // The Diff agrees that a new choice selects `search` — the matrix row in
    // `evolution-matrix.cases.ts` proves that half, and these two must never disagree or a
    // regenerated search Handler would be told nothing about the field that caused it.
    expect(schema.searchable_fields.map((field) => field.name)).toContain("stage");
    expect(schema.searchable_fields.every((field) => !("values" in field))).toBe(true);
  });
});
