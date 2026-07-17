// Structural-rung tests for the always-on gate (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { FIELD_LIFECYCLE_DEMO_SPEC, FIELD_LIFECYCLE_DEMO_UNITS } from "../demo/field-lifecycle.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { expectGateFailure, GOOD_HANDLERS, gateInput } from "./gate.test-support.ts";
import { runStructuralRung } from "./gate-structural.ts";

setDefaultTimeout(60_000);

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

  test("plain query projections cannot cross the opaque presentation boundary", async () => {
    const unsafeRead = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.all({",
      '    sql: \'SELECT "text" AS "text" FROM "cap_notes"\',',
      '    result: [{ alias: "text", type: "string" }],',
      "  });",
      '  return rows.map((row) => present(row)).join("");',
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, read: unsafeRead } }),
    );

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes.map((outcome) => outcome.rung)).toEqual(["structural"]);
    expect(error.outcomes[0]?.error).toMatch(/CapabilityActionRecord/);
  });

  test("structural checks reject injected-toolbox bypasses before execution", async () => {
    for (const bypass of [
      'const fs = await import("node:fs"); void fs;',
      'const fs = require("node:fs"); void fs;',
      "void globalThis;",
      'const run = new Function("return 1"); void run;',
    ]) {
      const create = [
        "export default async function create(_context: CapabilityCreateContext): Promise<string> {",
        `  ${bypass}`,
        "  return '<p>nope</p>';",
        "}",
      ].join("\n");
      const error = await expectGateFailure(gateInput({ handlers: { ...GOOD_HANDLERS, create } }));
      expect(error.failedRung).toBe("structural");
      expect(error.outcomes[0]?.error).toContain("injected toolbox");
    }
  });
});

describe("capability gate — complete Handler static contract", () => {
  test("structural checks apply raw HTTP and mutation-SQL rejection to every advertised Handler", async () => {
    const handlers = Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );
    const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
      (unit) => unit.kind === "item-renderer",
    )?.content;
    if (!itemRenderer) throw new Error("reference item renderer missing");

    for (const [label, search, message] of [
      [
        "raw HTTP",
        'export default async function search(_context: CapabilityContext): Promise<string> { await fetch("https://example.com"); return "<p>nope</p>"; }',
        /raw HTTP/,
      ],
      [
        "raw mutation SQL",
        'export default async function search({ query }: CapabilityContext): Promise<string> { query.all({ sql: \'DELETE FROM "cap_field_lifecycle_demo"\', result: [] }); return "<p>nope</p>"; }',
        /raw mutation SQL/,
      ],
    ] as const) {
      const error = await expectGateFailure(
        gateInput({
          spec: FIELD_LIFECYCLE_DEMO_SPEC,
          ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
          handlers: { ...handlers, search },
          itemRenderer,
          behavioralTier: { enabled: false },
        }),
      );
      expect(error.failedRung, label).toBe("structural");
      expect(error.outcomes[0]?.error).toMatch(message);
    }
  });
});

function handlerContextType(action: string): string {
  if (action === "create") return "CapabilityCreateContext";
  if (action === "update") return "CapabilityUpdateContext";
  if (action === "delete") return "CapabilityDeleteContext";
  return "CapabilityContext";
}

function poisonedSqlHandler(action: string, sql: string): string {
  const functionName = action === "delete" ? "remove" : action;
  const contextType = handlerContextType(action);
  return `export default async function ${functionName}(_context: ${contextType}): Promise<string> { const sql = ${JSON.stringify(sql)}; void sql; return ""; }`;
}

describe("capability gate — Action-scoped catalog and connection isolation", () => {
  test("attributes every raw write and DDL family to the offending Action unit", async () => {
    const handlers = Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );
    const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
      (unit) => unit.kind === "item-renderer",
    )?.content;
    if (!itemRenderer) throw new Error("reference item renderer missing");

    const cases = [
      ["create", 'INSERT INTO "cap_field_lifecycle_demo" ("id") VALUES ("x")'],
      ["read", 'UPDATE "cap_field_lifecycle_demo" SET "entry" = "x"'],
      ["update", 'DELETE FROM "cap_field_lifecycle_demo"'],
      ["delete", 'CREATE UNIQUE INDEX generated_idx ON "cap_field_lifecycle_demo" ("entry")'],
      ["search", "CREATE TEMP TABLE generated_scratch (value TEXT)"],
    ] as const;

    for (const [action, sql] of cases) {
      const poisoned = poisonedSqlHandler(action, sql);
      const error = await expectGateFailure(
        gateInput({
          spec: FIELD_LIFECYCLE_DEMO_SPEC,
          ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
          handlers: { ...handlers, [action]: poisoned },
          itemRenderer,
          behavioralTier: { enabled: false },
        }),
      );
      expect(error.failedRung, action).toBe("structural");
      expect(error.outcomes[0]?.error, action).toContain(`handler "${action}"`);
      expect(error.outcomes[0]?.error, action).toContain("raw mutation SQL");
      expect(error.diagnostic).toMatchObject({
        structural: {
          units: expect.arrayContaining([
            expect.objectContaining({ name: action, status: "failed" }),
          ]),
        },
      });
    }
  });

  test("rejects direct connection access with an actionable per-unit failure", async () => {
    const connectionProbe = [
      "export default async function create({ mutation, query }: CapabilityCreateContext): Promise<string> {",
      "  void (query as unknown as { connection: unknown }).connection;",
      '  mutation.create({ text: "probe" });',
      '  return "";',
      "}",
    ].join("\n");
    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, create: connectionProbe } }),
    );

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toContain('handler "create"');
    expect(error.outcomes[0]?.error).toContain("must not access a database connection directly");
  });

  test("admits dependency SQL only when that Action declares the scratch catalog entry", () => {
    const dependencyIncarnation = "11111111-1111-4111-8111-111111111111";
    const handlers = Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );
    const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
      (unit) => unit.kind === "item-renderer",
    )?.content;
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const dependency = {
      ...FIELD_LIFECYCLE_DEMO_SPEC,
      id: "recipes",
      label: "Recipes",
    };
    const spec: CapabilitySpec = {
      ...FIELD_LIFECYCLE_DEMO_SPEC,
      read_dependencies: {
        create: [],
        read: [{ capability_id: dependency.id, incarnation_id: dependencyIncarnation }],
        update: [],
        delete: [],
        search: [],
      },
    };
    const declaredRead = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      "  const rows = query.all({",
      '    sql: \'SELECT "entry" FROM "cap_recipes"\',',
      '    result: [{ alias: "entry", type: "string" }],',
      "  });",
      "  return String(rows.length);",
      "}",
    ].join("\n");
    const input = gateInput({
      spec,
      ddl: deriveCapabilityTableDdl(spec),
      handlers: { ...handlers, read: declaredRead },
      itemRenderer,
      scratchCatalog: [{ spec: dependency, incarnationId: dependencyIncarnation, rows: [] }],
    });

    expect(() => runStructuralRung(input)).not.toThrow();
    expect(() =>
      runStructuralRung({
        ...input,
        spec: {
          ...spec,
          read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
        },
        scratchCatalog: [],
      }),
    ).toThrow(/handler "read".*undeclared capability table.*cap_recipes/);
  });
});

describe("capability gate — ambient runtime names", () => {
  test("a field named process is valid while ambient process access still fails", async () => {
    const spec: CapabilitySpec = {
      ...gateInput().spec,
      schema: {
        fields: [
          {
            name: "process",
            label: "Process",
            type: "string" as const,
            required: true,
            lifecycle: "active" as const,
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the process plainly.", shows: ["process"] },
        collection: { layout: "feed" as const },
        detail: { shows: ["process"] },
      },
      behavioral_errors: [
        {
          action: "create" as const,
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["process"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
    };
    const create = [
      "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
      "  return present(mutation.create({ process: input.values.process }));",
      "}",
    ].join("\n");
    const read = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  return query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      '  }).map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");

    const pass = await import("./gate.ts").then(({ runCapabilityGate }) =>
      runCapabilityGate(
        gateInput({
          spec,
          ddl: deriveCapabilityTableDdl(spec),
          handlers: { create, read },
          behavioralTier: { enabled: false },
        }),
      ),
    );
    expect(pass.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);

    const ambient = create.replace("return present", "void process.env; return present");
    const error = await expectGateFailure(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        handlers: { create: ambient, read },
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toContain("ambient runtime access");
  });
});

describe("capability gate — advertised Handler inventory", () => {
  test("a five-Action row fails closed when any advertised Handler is absent", async () => {
    const handlers = Object.fromEntries(
      FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );
    delete handlers.search;
    const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
      (unit) => unit.kind === "item-renderer",
    )?.content;
    if (!itemRenderer) throw new Error("reference item renderer missing");

    const error = await expectGateFailure(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers,
        itemRenderer,
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toContain('handler "search" is missing');
    expect(error.diagnostic).toMatchObject({
      structural: {
        units: expect.arrayContaining([
          expect.objectContaining({ name: "spec", status: "failed" }),
          expect.objectContaining({ name: "search", status: "failed" }),
        ]),
      },
    });
  });

  test("rejects Handler files absent from the spec inventory", () => {
    const handlers = { ...GOOD_HANDLERS } as Record<string, string>;
    handlers.search = GOOD_HANDLERS.read ?? "";

    expect(() => runStructuralRung(gateInput({ handlers }))).toThrow(/unexpected: search/);
  });
});
