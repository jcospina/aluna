// Structural-rung tests for the always-on gate (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { expectGateFailure, GOOD_HANDLERS, gateInput } from "./gate.test-support.ts";

setDefaultTimeout(15_000);

describe("capability gate — signature assertion", () => {
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
});

describe("capability gate — structural rung", () => {
  test("structural type-check failure stops before smoke", async () => {
    const badCreate = [
      "export default async function create({ input, mutation }: CapabilityCreateContext): Promise<string> {",
      "  mutation.create({ text: input.values.text });",
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

  test("structural rung type-checks the generated item renderer", async () => {
    // A renderer that returns the raw `unknown` record value fails the item-renderer
    // type-check — the gate asserts the renderer contract alongside the handlers.
    const badRenderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  return record.text;",
      "}",
    ].join("\n");

    const error = await expectGateFailure(gateInput({ itemRenderer: badRenderer }));

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes.map((outcome) => outcome.rung)).toEqual(["structural"]);
    expect(error.outcomes[0]?.error).toContain("is not assignable to type 'string'");
  });

  test("structural rung rejects an async (non-synchronous) item renderer", async () => {
    const asyncRenderer = [
      "export default async function renderItem(record: Record<string, unknown>): Promise<string> {",
      "  return String(record.text);",
      "}",
    ].join("\n");

    const error = await expectGateFailure(gateInput({ itemRenderer: asyncRenderer }));

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toMatch(/synchronous/);
  });
});
