// Smoke-rung and sample-generation tests for the always-on gate (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { applyCapabilityTableDdl, deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { FIELD_LIFECYCLE_DEMO_SPEC, FIELD_LIFECYCLE_DEMO_UNITS } from "../demo/field-lifecycle.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  createCapabilityDataTool,
  expectGateFailure,
  GOOD_HANDLERS,
  gateInput,
  notesSpec,
} from "./gate.test-support.ts";
import { runCapabilityGate } from "./gate.ts";

setDefaultTimeout(15_000);

describe("capability gate — smoke rung", () => {
  test("runs structural before smoke and captures metrics for passing handlers", async () => {
    const realDatabase = new Database(":memory:");
    const spec = notesSpec();
    try {
      applyCapabilityTableDdl(spec, realDatabase);
      const realTool = createCapabilityDataTool(spec, {
        readwrite: realDatabase,
        readonly: realDatabase,
      });
      realTool.insert({ text: "Real note", pinned: false });

      const result = await runCapabilityGate(gateInput({ spec, realDatabase }));

      expect(result.outcomes.map((outcome) => outcome.rung)).toEqual([
        "structural",
        "smoke",
        "behavioral",
        "design-lint",
      ]);
      expect(result.outcomes.every((outcome) => outcome.status === "passed")).toBe(true);
      expect(result.outcomes.every((outcome) => outcome.durationMs >= 0)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.smoke).toMatchObject({
        tableName: "cap_notes",
        rowCount: 1,
        realDatabaseUnchanged: true,
      });
      expect(result.smoke.createFragmentLength).toBeGreaterThan(0);
      expect(result.smoke.readFragmentLength).toBeGreaterThan(0);
      expect(result.smoke.insertedRowId).toBeTruthy();
      expect(result.behavioral).toMatchObject({
        tier: "on",
        status: "passed",
        testGen: {
          outcome: "passed",
          testCount: 1,
          usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
        },
        testRun: { outcome: "passed" },
      });
      expect(
        result.behavioral.tier === "on" ? result.behavioral.testGen.durationMs : -1,
      ).toBeGreaterThanOrEqual(0);
      expect(
        result.behavioral.tier === "on" ? result.behavioral.testRun.durationMs : -1,
      ).toBeGreaterThanOrEqual(0);
      expect(result.behavioral.tier === "on" ? result.behavioral.testRun.cases : []).toEqual([
        expect.objectContaining({ name: "stores and renders note text", status: "passed" }),
      ]);

      expect(realTool.select()).toMatchObject([{ text: "Real note", pinned: false }]);
    } finally {
      realDatabase.close();
    }
  });

  test("smoke renders create and read through the real presentation adapter", async () => {
    // With present-calling handlers and a real renderer, both rungs run records through
    // the same `present` adapter the router injects — the item wrapper appears in the
    // rendered output (create + read cannot drift, ADR-0005 §2).
    const result = await runCapabilityGate(gateInput());

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
    expect(result.smoke.createFragmentLength).toBeGreaterThan(0);
    expect(result.smoke.readFragmentLength).toBeGreaterThan(0);
  });

  test("smoke runs the real handlers against scratch and fails when no row lands", async () => {
    const noInsertCreate = [
      "export default async function create(_context: CapabilityContext): Promise<string> {",
      "  return '<p>looked fine, but wrote nothing</p>';",
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({
        handlers: { ...GOOD_HANDLERS, create: noInsertCreate },
        provider: undefined,
      }),
    );

    expect(error.failedRung).toBe("smoke");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:failed",
    ]);
    expect(error.outcomes[1]?.error).toContain("expected exactly one scratch row");
  });
});

describe("capability gate — five-Action reference scratch catalog", () => {
  const dependencyIncarnation = "22222222-2222-4222-8222-222222222222";
  const dependencySpec = notesSpec({
    id: "scratch_catalog",
    label: "Scratch catalog",
    prompt_context: "Synthetic catalog data used only by the Gate.",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        {
          name: "retired_note",
          label: "Retired note",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
  });
  const referenceSpec: CapabilitySpec = {
    ...FIELD_LIFECYCLE_DEMO_SPEC,
    read_dependencies: {
      ...FIELD_LIFECYCLE_DEMO_SPEC.read_dependencies,
      read: [
        {
          capability_id: dependencySpec.id,
          incarnation_id: dependencyIncarnation,
        },
      ],
    },
  };
  const referenceHandlers = {
    ...Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    ),
    read: [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.records({",
      '    sql: \'SELECT target."id" AS "target_id" FROM "cap_field_lifecycle_demo" AS target CROSS JOIN "cap_scratch_catalog" AS catalog WHERE catalog."text" = ? AND catalog."retired_note" = ? ORDER BY target."created_at" DESC, target."id" DESC\',',
      '    parameters: ["synthetic only", "compatibility only"],',
      "  });",
      '  return rows.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n"),
  };
  const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
    (unit) => unit.kind === "item-renderer",
  )?.content;

  test("applies every declared schema and seeds only supplied synthetic rows", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const result = await runCapabilityGate(
      gateInput({
        spec: referenceSpec,
        ddl: deriveCapabilityTableDdl(referenceSpec),
        handlers: referenceHandlers,
        itemRenderer,
        behavioralTier: { enabled: false },
        scratchCatalog: [
          {
            spec: dependencySpec,
            incarnationId: dependencyIncarnation,
            rows: [{ text: "synthetic only", retired_note: "compatibility only" }],
          },
        ],
      }),
    );

    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "passed",
      "passed",
      "skipped",
      "passed",
    ]);
  });

  test("structural validation fails before Handler execution when a declared scratch schema is absent", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const error = await expectGateFailure(
      gateInput({
        spec: referenceSpec,
        ddl: deriveCapabilityTableDdl(referenceSpec),
        handlers: referenceHandlers,
        itemRenderer,
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toContain("expected exactly one dependency");
  });
});

describe("capability gate — complete five-Action smoke", () => {
  const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
    (unit) => unit.kind === "item-renderer",
  )?.content;

  test("the exact published five-Action reference inventory passes its applicable Gate", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );

    const result = await runCapabilityGate(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers,
        itemRenderer,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:passed",
    ]);
    expect(result.smoke).toMatchObject({
      rowCount: 1,
      fixed: false,
      attempts: [{ attempt: 1 }],
    });
    expect(result.smoke.updateFragmentLength).toBeGreaterThan(0);
    expect(result.smoke.searchCaseCount).toBe(26);
    expect(result.smoke.deleteFragmentLength).toBeGreaterThanOrEqual(0);
  });
});

describe("capability gate — item renderer samples", () => {
  test("Gate samples supply declared created_at and never expose inactive item fields", async () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "pinned",
            label: "Pinned",
            type: "boolean",
            required: false,
            lifecycle: "active",
          },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: true,
            lifecycle: "inactive",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the entry and its age.", shows: ["text", "created_at"] },
        collection: { layout: "feed" },
        detail: { shows: ["text", "created_at"] },
      },
    });
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  if (typeof record.created_at !== "string") return "";',
      "  return '<div class=\"stack\"><span class=\"text-lg\">' + escapeHtml(record.text) + '</span></div>';",
      "}",
      "function escapeHtml(value: unknown): string {",
      '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
      "}",
    ].join("\n");

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );
    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("Gate rejects item renderers that read fields outside item.shows", async () => {
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  return '<div class=\"stack\"><span class=\"text-lg\">' + String(record.created_at) + '</span></div>';",
      "}",
    ].join("\n");

    await expect(
      runCapabilityGate(
        gateInput({
          itemRenderer: renderer,
          behavioralTier: { enabled: false },
        }),
      ),
    ).rejects.toThrow(/not declared by ui_intent\.item\.shows: created_at/);
  });
});

describe("capability gate — string[] ordered-list samples", () => {
  test("Gate smoke and design samples exercise string[] as an ordered list", async () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
        ],
      },
      ui_intent: {
        form: { list_inputs: [{ field: "tags", mode: "repeatable" }] },
        item: { direction: "Show each tag in order.", shows: ["tags"] },
        collection: { layout: "feed" },
        detail: { shows: ["tags"] },
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
        handlers: { create, read },
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });
});
