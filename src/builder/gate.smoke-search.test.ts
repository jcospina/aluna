import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { FIELD_LIFECYCLE_DEMO_SPEC, FIELD_LIFECYCLE_DEMO_UNITS } from "../demo/field-lifecycle.ts";
import {
  expectGateFailure,
  gateInput,
  makeBehaviorProvider,
  makeSequenceProvider,
} from "./gate.test-support.ts";
import { runCapabilityGate } from "./gate.ts";

setDefaultTimeout(15_000);

const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
  (unit) => unit.kind === "item-renderer",
)?.content;

function referenceHandlers(): Record<string, string> {
  return Object.fromEntries(
    FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
      unit.name,
      unit.content,
    ]),
  );
}

describe("capability gate — frozen adversarial search and repair", () => {
  test.each([
    [
      "lower()",
      FIELD_LIFECYCLE_DEMO_UNITS.find(
        (unit) => unit.kind === "handler" && unit.name === "search",
      )?.content.replaceAll("platform_search_normalize", "lower"),
    ],
    [
      "COLLATE NOCASE",
      [
        "export default async function search({ input, query, present }: CapabilityContext): Promise<string> {",
        "  const raw = input.values.q;",
        '  const terms = (typeof raw === "string" ? raw : "").trim().split(/\\s+/u).filter(Boolean);',
        "  const rows = query.records({",
        '    sql: \'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT "target"."id" AS "target_id" FROM "cap_field_lifecycle_demo" AS "target" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE coalesce(instr("target"."entry" COLLATE NOCASE, "search_term"."term" COLLATE NOCASE), 0) = 0) ORDER BY "target"."created_at" DESC, "target"."id" DESC\',',
        "    parameters: [JSON.stringify(terms)],",
        "  });",
        '  return rows.map(({ record }) => present(record)).join("");',
        "}",
      ].join("\n"),
    ],
    [
      "a narrow whitespace splitter",
      FIELD_LIFECYCLE_DEMO_UNITS.find(
        (unit) => unit.kind === "handler" && unit.name === "search",
      )?.content.replace(/\\s\+\/u/, "[ \\t\\n\\u2003\\u2009]+/u"),
    ],
  ])("rejects search implemented with %s", async (_label, poisonedSearch) => {
    if (!itemRenderer || !poisonedSearch) throw new Error("reference fixture unit missing");
    const handlers = referenceHandlers();
    const error = await expectGateFailure(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers: { ...handlers, search: poisonedSearch },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("smoke");
    expect(error.diagnostic).toMatchObject({ smoke: { action: "search" } });
  });

  test("repairs only search and reruns the unchanged full fixture", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");
    const { provider, prompts } = makeBehaviorProvider({ content: goodSearch });
    const result = await runCapabilityGate(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers: {
          ...handlers,
          search: goodSearch.replaceAll("platform_search_normalize", "lower"),
        },
        itemRenderer,
        provider,
        behavioralTier: { enabled: false },
      }),
    );
    expect(result.smoke.fixed).toBe(true);
    expect(result.smoke.attempts).toHaveLength(2);
    expect(result.smoke.attempts[0]).toMatchObject({ action: "search", error: expect.any(String) });
    expect(result.handlers.search).toBe(goodSearch);
    expect(result.handlers.create).toBe(handlers.create);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Generate the search.ts handler");
  });
});

describe("capability gate — adversarial search failure integrity", () => {
  test("rejects a search Handler that discards presented HTML", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");
    const discardedSearch = goodSearch
      .replace("  return query.records({", "  const ignored = query.records({")
      .replace(
        '  }).map(({ record }) => present(record)).join("");',
        '  }).map(({ record }) => present(record)).join("");\n  return ignored.slice(0, 0);',
      );
    const error = await expectGateFailure(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers: { ...handlers, search: discardedSearch },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("smoke");
    expect(error.outcomes.at(-1)?.error).toContain("discarded or reordered");
  });

  test("attributes the adversarial baseline read failure to read", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const shortRead = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  return query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_field_lifecycle_demo" ORDER BY "created_at" DESC, "id" DESC LIMIT 1\',',
      '  }).map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    const error = await expectGateFailure(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers: { ...handlers, read: shortRead },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );
    expect(error.failedRung).toBe("smoke");
    expect(error.diagnostic).toMatchObject({ smoke: { action: "read" } });
  });

  test("continues after a structurally invalid regeneration", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");
    const { provider, prompts } = makeSequenceProvider([
      { content: 'export default async function search(): Promise<string> { return "invalid"; }' },
      { content: goodSearch },
    ]);
    const result = await runCapabilityGate(
      gateInput({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl: deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC),
        handlers: {
          ...handlers,
          search: goodSearch.replaceAll("platform_search_normalize", "lower"),
        },
        itemRenderer,
        provider,
        smoke: { maxAttempts: 3 },
        behavioralTier: { enabled: false },
      }),
    );
    expect(result.smoke.attempts).toHaveLength(3);
    expect(result.smoke.attempts[1]).toMatchObject({
      action: "search",
      error: expect.stringContaining("structural validation"),
    });
    expect(result.handlers.search).toBe(goodSearch);
    expect(prompts).toHaveLength(2);
  });
});
