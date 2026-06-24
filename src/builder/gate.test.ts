// Tests for the first always-on gate rungs (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  applyCapabilityTableDdl,
  createCapabilityDataTool,
  deriveCapabilityTableDdl,
} from "../capability-data/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import { CapabilityGateError, runCapabilityGate } from "./gate.ts";
import type { HandlerUnitName } from "./units.ts";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", type: "string", required: true },
        { name: "pinned", type: "boolean", required: false },
      ],
    },
    ui_intent: { views: ["list", "create"] },
    behavior: "Text is required. Newest notes appear first.",
    tools: ["create", "read"],
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

const CREATE_HANDLER = [
  "export default async function create({ input, data }: CapabilityContext): Promise<string> {",
  "  const note = data.insert({",
  "    text: input.text,",
  '    pinned: input.pinned === "on" || input.pinned === "true",',
  "  });",
  '  return `<article class="note"><p>$' + "{escapeHtml(note.text)}</p></article>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

const READ_HANDLER = [
  "export default async function read({ data }: CapabilityContext): Promise<string> {",
  "  const notes = data.select();",
  '  if (notes.length === 0) return \'<ul class="notes" data-empty="true"></ul>\';',
  "  const items = notes",
  '    .map((note) => `<li class="note">$' + "{escapeHtml(note.text)}</li>`)",
  '    .join("");',
  '  return `<ul class="notes">$' + "{items}</ul>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

const GOOD_HANDLERS: Readonly<Record<HandlerUnitName, string>> = {
  create: CREATE_HANDLER,
  read: READ_HANDLER,
};

function gateInput(
  overrides: Partial<Parameters<typeof runCapabilityGate>[0]> = {},
): Parameters<typeof runCapabilityGate>[0] {
  const spec = notesSpec();
  return {
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: GOOD_HANDLERS,
    ...overrides,
  };
}

async function expectGateFailure(
  input: Parameters<typeof runCapabilityGate>[0],
): Promise<CapabilityGateError> {
  try {
    await runCapabilityGate(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CapabilityGateError);
    return error as CapabilityGateError;
  }

  throw new Error("expected gate to fail");
}

describe("capability gate", () => {
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

      expect(result.outcomes.map((outcome) => outcome.rung)).toEqual(["structural", "smoke"]);
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

      expect(realTool.select()).toMatchObject([{ text: "Real note", pinned: false }]);
    } finally {
      realDatabase.close();
    }
  });

  test("signature assertion catches named exports, non-functions, and non-async functions", async () => {
    const cases: Array<{
      readonly label: string;
      readonly create: string;
      readonly message: RegExp;
    }> = [
      {
        label: "named export",
        create:
          "export async function create(_context: CapabilityContext): Promise<string> { return '<p>ok</p>'; }",
        message: /export default async function/,
      },
      {
        label: "default non-function",
        create: "export default '<p>nope</p>';",
        message: /default-export an async function declaration/,
      },
      {
        label: "non-async default function",
        create:
          "export default function create(_context: CapabilityContext): string { return '<p>nope</p>'; }",
        message: /export default async function/,
      },
    ];

    for (const entry of cases) {
      const error = await expectGateFailure(
        gateInput({ handlers: { ...GOOD_HANDLERS, create: entry.create } }),
      );

      expect(error.failedRung, entry.label).toBe("structural");
      expect(error.outcomes).toHaveLength(1);
      expect(error.outcomes[0]).toMatchObject({ rung: "structural", status: "failed" });
      expect(error.outcomes[0]?.error).toMatch(entry.message);
    }
  });

  test("structural type-check failure stops before smoke", async () => {
    const badCreate = [
      "export default async function create({ input, data }: CapabilityContext): Promise<string> {",
      "  data.insert({ text: input.text });",
      "  return 123;",
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, create: badCreate } }),
    );

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes.map((outcome) => outcome.rung)).toEqual(["structural"]);
    expect(error.outcomes[0]?.error).toContain("Type 'number' is not assignable");
  });

  test("smoke runs the real handlers against scratch and fails when no row lands", async () => {
    const noInsertCreate = [
      "export default async function create(_context: CapabilityContext): Promise<string> {",
      "  return '<p>looked fine, but wrote nothing</p>';",
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, create: noInsertCreate } }),
    );

    expect(error.failedRung).toBe("smoke");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:failed",
    ]);
    expect(error.outcomes[1]?.error).toContain("expected exactly one scratch row");
  });
});
