import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  type SpecField,
} from "../../../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../../../runtime/data/index.ts";
import { buildUnitPrompt } from "../../../units/generation/unit-prompts.ts";
import {
  createHandlerFor,
  expectGateFailure,
  fullHandlersFor,
  gateInput,
  generatedUnitsFor,
  makeBehaviorProvider,
  makeSequenceProvider,
  notesSpec,
  readHandlerFor,
  searchHandlerFor,
} from "../../gate.test-support.ts";
import { runCapabilityGate } from "../../gate.ts";

setDefaultTimeout(15_000);

const FIVE_ACTION_SPEC = notesSpec();
const FIVE_ACTION_UNITS = generatedUnitsFor(FIVE_ACTION_SPEC);

const itemRenderer = FIVE_ACTION_UNITS.find((unit) => unit.kind === "item-renderer")?.content;

function referenceHandlers(): Record<string, string> {
  return Object.fromEntries(
    FIVE_ACTION_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
      unit.name,
      unit.content,
    ]),
  );
}

function reverseOnlyNonblankSearch(source: string): string {
  return source
    .replace("  return query.records({", "  const records = query.records({")
    .replace(
      '  }).map(({ record }) => present(record)).join("");',
      [
        "  });",
        "  const ordered = terms.length === 0 ? records : [...records].reverse();",
        '  return ordered.map(({ record }) => present(record)).join("");',
      ].join("\n"),
    );
}

function rankPinnedFirstOnlyNonblank(source: string): string {
  const reranked = source.replace(
    'ORDER BY "target"."created_at" DESC, "target"."id" DESC',
    'ORDER BY CASE WHEN EXISTS (SELECT 1 FROM "search_terms") THEN "target"."pinned" ELSE 0 END DESC, "target"."created_at" DESC, "target"."id" DESC',
  );
  if (reranked === source) throw new Error("reference search ordering clause missing");
  return reranked;
}

describe("capability gate — frozen adversarial search and repair", () => {
  test.each([
    [
      "lower()",
      FIVE_ACTION_UNITS.find(
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
        '    sql: \'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT "target"."id" AS "target_id" FROM "cap_notes" AS "target" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE coalesce(instr("target"."text" COLLATE NOCASE, "search_term"."term" COLLATE NOCASE), 0) = 0) ORDER BY "target"."created_at" DESC, "target"."id" DESC\',',
        "    parameters: [JSON.stringify(terms)],",
        "  });",
        '  return rows.map(({ record }) => present(record)).join("");',
        "}",
      ].join("\n"),
    ],
    [
      "a narrow whitespace splitter",
      FIVE_ACTION_UNITS.find(
        (unit) => unit.kind === "handler" && unit.name === "search",
      )?.content.replace(/\\s\+\/u/, "[ \\t\\n\\u2003\\u2009]+/u"),
    ],
  ])("rejects search implemented with %s", async (_label, poisonedSearch) => {
    if (!itemRenderer || !poisonedSearch) throw new Error("generated Gate unit missing");
    const handlers = referenceHandlers();
    const error = await expectGateFailure(
      gateInput({
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
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
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
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
    const searchPrompt = buildUnitPrompt(FIVE_ACTION_SPEC, { kind: "handler", name: "search" });
    expect(prompts[0]?.startsWith(searchPrompt)).toBe(true);
  });
});

describe("capability gate — search ordering", () => {
  test("rejects reversing the ranking-neutral tie fallback", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");

    const error = await expectGateFailure(
      gateInput({
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
        handlers: { ...handlers, search: reverseOnlyNonblankSearch(goodSearch) },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );

    expect(error.failedRung).toBe("smoke");
    expect(error.outcomes.at(-1)?.error).toContain("deterministic ranking-neutral tie fallback");
  });

  test("preserves an explicit deterministic nonblank search reranking", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");
    const rerankedSpec = notesSpec({
      behavior: "Matching search results show pinned notes first, then newest notes.",
    });
    const rerankedSearch = rankPinnedFirstOnlyNonblank(goodSearch);

    const result = await runCapabilityGate(
      gateInput({
        spec: rerankedSpec,
        ddl: deriveCapabilityTableDdl(rerankedSpec),
        handlers: { ...handlers, search: rerankedSearch },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ rung: "smoke", status: "passed" }),
    );
    expect(result.handlers.search).toBe(rerankedSearch);
  });
});

describe("capability gate — adversarial search failure integrity", () => {
  test("rejects Handler-authored no-match markup", async () => {
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const handlers = referenceHandlers();
    const goodSearch = handlers.search;
    if (!goodSearch) throw new Error("reference search Handler missing");
    const handlerOwnedNoMatches = goodSearch
      .replace("  return query.records({", "  const rows = query.records({")
      .replace(
        '  }).map(({ record }) => present(record)).join("");',
        [
          "  });",
          '  const fragment = rows.map(({ record }) => present(record)).join("");',
          '  return fragment.length > 0 ? fragment : "<p>No matches.</p>";',
        ].join("\n"),
      );

    const error = await expectGateFailure(
      gateInput({
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
        handlers: { ...handlers, search: handlerOwnedNoMatches },
        itemRenderer,
        provider: undefined,
        behavioralTier: { enabled: false },
      }),
    );

    expect(error.failedRung).toBe("smoke");
    expect(error.diagnostic).toMatchObject({ smoke: { action: "search" } });
    expect(error.outcomes.at(-1)?.error).toContain(
      "search Handler must return an empty string when no records are presented",
    );
  });

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
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
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
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC LIMIT 1\',',
      '  }).map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    const error = await expectGateFailure(
      gateInput({
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
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
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
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

const TEXT: SpecField = {
  name: "text",
  label: "Text",
  type: "string",
  required: true,
  lifecycle: "active",
};

function choice(name: string, options: readonly string[]): SpecField {
  const values = options.map((value) => ({ value, label: value }));
  return {
    name,
    label: name,
    type: "choice",
    required: true,
    lifecycle: "active",
    values,
    groups: [],
  };
}

/** The notes capability holding exactly `fields`, with the form and error cases they imply. */
function specOf(fields: readonly SpecField[]): CapabilitySpec {
  const base = notesSpec();
  const schema = { fields: [...fields] };
  const named = (type: string) => fields.filter((field) => field.type === type);
  return notesSpec({
    schema,
    behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: named("choice").map(({ name }) => ({ field: name, presentation: "picker" })),
        list_inputs: named("string[]").map(({ name }) => ({ field: name, mode: "repeatable" })),
      },
      item: { ...base.ui_intent.item, shows: fields.slice(0, 1).map(({ name }) => name) },
    },
  });
}

const textAndChoice = (options: readonly string[]) => specOf([TEXT, choice("stage", options)]);

/** The reference search Handler for `spec` with `fields` left out, as a Handler blind to them is. */
function searchWithout(spec: CapabilitySpec, ...fields: readonly string[]): string {
  const kept = spec.schema.fields.filter(({ name }) => !fields.includes(name));
  return searchHandlerFor({ ...spec, schema: { fields: kept } });
}

function choiceGateInput(spec: CapabilitySpec, search: string) {
  const handlers = fullHandlersFor(spec, {
    create: createHandlerFor(spec),
    read: readHandlerFor(spec),
    search,
  });
  const units = generatedUnitsFor(spec, handlers);
  return gateInput({
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers,
    itemRenderer: units.find((unit) => unit.kind === "item-renderer")?.content ?? "",
    provider: undefined,
    behavioralTier: { enabled: false },
  });
}

async function expectSearchRejected(spec: CapabilitySpec, search: string): Promise<void> {
  const error = await expectGateFailure(choiceGateInput(spec, search));
  expect(error.failedRung).toBe("smoke");
  expect(error.diagnostic).toMatchObject({ smoke: { action: "search" } });
}

async function expectSearchPasses(spec: CapabilitySpec): Promise<void> {
  const result = await runCapabilityGate(choiceGateInput(spec, searchHandlerFor(spec)));
  expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
}

describe("capability gate — a choice is searched", () => {
  // An option the needle row's own text holds would let a Handler blind to the choice pass.
  test.each([
    [["draft", "sent"]],
    [["needle", "sent"]],
  ])("rejects a search Handler that reads no choice field, offering %p", async (options) => {
    const spec = textAndChoice(options);
    await expectSearchRejected(spec, searchWithout(spec, "stage"));
  });

  test("rejects a search Handler that reads only one of two choices", async () => {
    const spec = specOf([
      TEXT,
      choice("stage", ["draft", "sent"]),
      choice("tone", ["calm", "loud"]),
    ]);
    await expectSearchRejected(spec, searchWithout(spec, "tone"));
  });

  test.each([
    ["exactly as stored", '("target"."stage" = "search_term"."term")'],
    ["without the normalizer", '(coalesce(instr("target"."stage", "search_term"."term"), 0) > 0)'],
    [
      "only whole",
      '(platform_search_normalize("target"."stage") = platform_search_normalize("search_term"."term"))',
    ],
  ])("rejects a search Handler that matches a choice %s", async (_, clause) => {
    const spec = textAndChoice(["draft", "sent"]);
    const normalized =
      '(coalesce(instr(platform_search_normalize("target"."stage"), platform_search_normalize("search_term"."term")), 0) > 0)';
    const broken = searchHandlerFor(spec).replace(normalized, clause);
    if (broken === searchHandlerFor(spec)) throw new Error("reference choice clause missing");
    await expectSearchRejected(spec, broken);
  });

  // Both choices may hold "x", so only "y" tells Stage apart; a probe matched through Phase proves nothing.
  test("rejects a search Handler blind to one of two choices that are the only text", async () => {
    const spec = specOf([
      { name: "on", label: "On", type: "date", required: false, lifecycle: "active" },
      choice("stage", ["x", "y"]),
      choice("phase", ["x"]),
    ]);
    await expectSearchRejected(spec, searchWithout(spec, "stage"));
  });

  test("rejects a choice-blind search Handler when the choices are the only text", async () => {
    const spec = specOf([choice("stage", ["draft", "sent"])]);
    const blind = searchHandlerFor(spec).replace(
      /WHERE NOT EXISTS \(SELECT 1 FROM "search_terms" AS "search_term" WHERE NOT \(.*?\)\) ORDER BY/,
      'WHERE NOT EXISTS (SELECT 1 FROM "search_terms") ORDER BY',
    );
    if (blind === searchHandlerFor(spec)) throw new Error("reference search clause missing");
    await expectSearchRejected(spec, blind);
  });

  test("still rejects a broken search Handler beside a choice, so the guard keeps every other case", async () => {
    const spec = textAndChoice(["draft", "sent"]);
    await expectSearchRejected(
      spec,
      searchHandlerFor(spec).replaceAll("platform_search_normalize", "lower"),
    );
  });

  test.each([
    ["an option holds the fixture's own words", textAndChoice(["cafe", "gate update", "sent"])],
    ["the only option is in the needle", textAndChoice(["needle"])],
    ["the choices are the only text", specOf([choice("stage", ["draft", "sent"])])],
    [
      "two choices hold the same lone option, so neither can be told apart",
      specOf([
        { name: "on", label: "On", type: "date", required: false, lifecycle: "active" },
        choice("stage", ["x"]),
        choice("phase", ["x"]),
      ]),
    ],
    [
      "the only text field is a list",
      specOf([{ ...TEXT, name: "tags", type: "string[]" }, choice("stage", ["draft", "sent"])]),
    ],
  ])("a correct search Handler passes when %s", async (_, spec) => {
    await expectSearchPasses(spec);
  });
});
