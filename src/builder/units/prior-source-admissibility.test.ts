// Prior-source admissibility (PLAN decision 21 ¶2; ADR-0006).
//
// Prior source is optional regeneration context, not an entitlement. These tests pin the
// proof: clean prior source is admitted verbatim, while source that reaches outside the
// candidate unit's current generation contract — a now-hidden field, a dependency this
// Action no longer declares, forbidden platform authority — is withheld, and a withheld
// unit's regeneration prompt carries none of its bytes.

// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures intentionally embed generated template-literal source.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ZodType } from "zod";

import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "../../provider/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  FULL_CAPABILITY_TOOLS,
} from "../../registry/index.ts";
import {
  admissiblePriorSource,
  buildUnitPrompt,
  checkPriorSourceAdmissibility,
  generateCapabilityUnit,
  type UnitDescriptor,
} from "../index.ts";

setDefaultTimeout(15_000);

const STUB_USAGE: TokenUsage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };
const JOURNALS_INCARNATION = "11111111-1111-4111-8111-111111111111";

// The candidate under evolution: `text` and `pinned` stay active, `legacy_note` has been
// hidden. The item renderer shows only `text`.
function candidateSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const schema: CapabilitySpec["schema"] = {
    fields: [
      { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      {
        name: "legacy_note",
        label: "Legacy note",
        type: "string",
        required: false,
        lifecycle: "inactive",
      },
    ],
  };
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "leaf",
    noun: "note",
    schema,
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card.", shows: ["text"] },
      collection: { layout: "feed" },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    tools: [...FULL_CAPABILITY_TOOLS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

/** The same candidate, but with `journals` declared as a read dependency. */
function candidateWithJournalsDependency(): CapabilitySpec {
  return candidateSpec({
    read_dependencies: {
      create: [],
      read: [{ capability_id: "journals", incarnation_id: JOURNALS_INCARNATION }],
      update: [],
      delete: [],
      search: [],
    },
  });
}

function candidateWithPinnedInactive(): CapabilitySpec {
  const spec = candidateSpec();
  return {
    ...spec,
    schema: {
      fields: spec.schema.fields.map((field) =>
        field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
      ),
    },
  };
}

/** The frozen catalog row for `journals`: one active field and one inactive field. */
function journalsCatalog(): readonly CapabilityRow[] {
  return [
    {
      ...candidateSpec(),
      id: "journals",
      label: "Journals",
      subject: "an open notebook",
      ground: "leaf",
      noun: "note",
      incarnation_id: JOURNALS_INCARNATION,
      version: 1,
      artifacts_path: `capabilities/journals/${JOURNALS_INCARNATION}/v1/`,
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
      schema: {
        fields: [
          {
            name: "public_text",
            label: "Public text",
            type: "string",
            required: false,
            lifecycle: "active",
          },
          {
            name: "hidden_text",
            label: "Hidden text",
            type: "string",
            required: false,
            lifecycle: "inactive",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show public text.", shows: ["public_text"] },
        collection: { layout: "feed" },
      },
      behavioral_errors: [],
    },
  ];
}

const CREATE: UnitDescriptor = { kind: "handler", name: "create" };
const READ: UnitDescriptor = { kind: "handler", name: "read" };
const ITEM: UnitDescriptor = { kind: "item-renderer", name: "item" };

// Prior source that stays inside the create contract: the two active fields, nothing else.
const CLEAN_CREATE = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  "  const values: Record<string, unknown> = {};",
  '  if ("text" in input.values) values.text = input.values.text;',
  '  values.pinned = input.values.pinned === "on" || input.values.pinned === "true";',
  "  return present(mutation.create(values));",
  "}",
].join("\n");

// The canonical read Handler: target ids only, no field named anywhere.
const READ_SOURCE = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const rows = query.records({",
  '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "  });",
  '  return rows.map(({ record }) => present(record)).join("");',
  "}",
].join("\n");

const CLEAN_ITEM = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  '  return `<div class="stack">${escapeHtml(record.text)}</div>`;',
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");',
  "}",
].join("\n");

function verdict(
  unit: UnitDescriptor,
  source: string,
  spec: CapabilitySpec = candidateSpec(),
  dependencyCatalog: readonly CapabilityRow[] = [],
) {
  return checkPriorSourceAdmissibility({ spec, unit, source, dependencyCatalog });
}

function reasonFor(...args: Parameters<typeof verdict>): string {
  const result = verdict(...args);
  if (result.admitted) throw new Error("expected the prior source to be withheld");
  return result.reason;
}

describe("prior-source admissibility", () => {
  test("admits clean prior source and hands back the exact bytes", () => {
    expect(verdict(CREATE, CLEAN_CREATE)).toEqual({ admitted: true });
    expect(verdict(ITEM, CLEAN_ITEM)).toEqual({ admitted: true });

    const spec = candidateSpec();
    expect(
      admissiblePriorSource({ spec, unit: CREATE, source: CLEAN_CREATE, dependencyCatalog: [] }),
    ).toBe(CLEAN_CREATE);
  });

  test("withholds source that reads a now-hidden field", () => {
    const source = CLEAN_CREATE.replace(
      "  return present",
      "  values.legacy_note = input.values.legacy_note;\n  return present",
    );

    expect(reasonFor(CREATE, source)).toContain("legacy_note");
    expect(
      admissiblePriorSource({
        spec: candidateSpec(),
        unit: CREATE,
        source,
        dependencyCatalog: [],
      }),
    ).toBeUndefined();
  });

  // The hidden field's *name* is the stale context, wherever it survives — a comment or a
  // marker attribute leaks it into the prompt just as a live read would.
  test("withholds source that names a hidden field only in text", () => {
    const commented = CLEAN_CREATE.replace(
      "  const values",
      "  // legacy_note is no longer written here.\n  const values",
    );
    const marker = CLEAN_CREATE.replace(
      "  return present",
      "  if (false) return '<div data-error-fields=\"legacy_note\">Required.</div>';\n  return present",
    );

    expect(reasonFor(CREATE, commented)).toContain("legacy_note");
    expect(reasonFor(CREATE, marker)).toContain("legacy_note");
  });

  // Whole-token matching: a hidden field's name *inside* a longer identifier is a derived
  // name, not a reference — the generated search Handler builds `<field>_element` aliases
  // exactly this way, and treating those as references would withhold every clean one.
  test("does not mistake a longer identifier for a hidden field reference", () => {
    const derived = (identifier: string) =>
      CLEAN_CREATE.replace(
        "  const values",
        `  const ${identifier} = 0;\n  void ${identifier};\n  const values`,
      );

    expect(verdict(CREATE, derived("legacy_note_count"))).toEqual({ admitted: true });
    expect(verdict(CREATE, derived("archived_legacy_note"))).toEqual({ admitted: true });
  });

  test("withholds Unicode-escaped hidden identifiers, strings, and comments", () => {
    const escapedIdentifier = CLEAN_CREATE.replaceAll("pinned", "pinn\\u0065d");
    const escapedString = CLEAN_CREATE.replace(
      "  const values",
      '  const stale = "pinn\\u0065d";\n  void stale;\n  const values',
    );
    const escapedComment = CLEAN_CREATE.replace(
      "  const values",
      "  // pinn\\u0065d was retired.\n  const values",
    );
    const spec = candidateWithPinnedInactive();

    expect(reasonFor(CREATE, escapedIdentifier, spec)).toContain("pinned");
    expect(reasonFor(CREATE, escapedString, spec)).toContain("pinned");
    expect(reasonFor(CREATE, escapedComment, spec)).toContain("pinned");
  });

  test("withholds hidden names assembled through constants, concatenation, or templates", () => {
    const cases = [
      '  const stale = "pin" + "ned";\n  void stale;',
      '  const prefix = "pin";\n  const stale = prefix + "ned";\n  void stale;',
      '  const prefix = "pin";\n  const stale = `${prefix}ned`;\n  void stale;',
    ];
    const spec = candidateWithPinnedInactive();

    for (const assembled of cases) {
      const source = CLEAN_CREATE.replace("  const values", `${assembled}\n  const values`);
      expect(reasonFor(CREATE, source, spec)).toContain("pinned");
    }
  });

  test("withholds unresolved computed property names rather than guessing", () => {
    const source = CLEAN_CREATE.replace(
      '  values.pinned = input.values.pinned === "on" || input.values.pinned === "true";',
      "  const field = String(input.values.text);\n  values[field] = true;",
    );

    expect(reasonFor(CREATE, source, candidateWithPinnedInactive())).toContain("cannot be proven");
  });
});

describe("runtime prior-source name assembly", () => {
  test("withholds runtime assembly, mutation, and shadowing at computed-name sinks", () => {
    const withoutPinned = CLEAN_CREATE.replace(
      '  values.pinned = input.values.pinned === "on" || input.values.pinned === "true";',
      "  // candidate no longer writes the inactive boolean",
    );
    const cases = [
      [
        '  const field = ["pin", "ned"].join("");',
        "  Object.assign(values, { [field]: true });",
      ].join("\n"),
      [
        '  let prefix = "safe";',
        '  prefix = "pin";',
        '  const field = prefix + "ned";',
        "  values[field] = true;",
      ].join("\n"),
      [
        '  const prefix = "pin";',
        '  { const prefix = "safe"; void prefix; }',
        '  values[prefix + "ned"] = true;',
      ].join("\n"),
    ];

    for (const assembled of cases) {
      const source = withoutPinned.replace("  return present", `${assembled}\n  return present`);
      expect(verdict(CREATE, source, candidateWithPinnedInactive())).toMatchObject({
        admitted: false,
      });
    }
  });

  test("withholds hidden names assembled for reflective property access", () => {
    const source = CLEAN_CREATE.replace(
      "  return present",
      '  Reflect.set(values, ["leg", "acy_note"].join(""), true);\n  return present',
    );

    expect(reasonFor(CREATE, source)).toContain("legacy_note");
  });
});

// The other three halves of the contract: dependency data, platform authority, and the item
// renderer's own declared field set.
describe("prior-source admissibility beyond the target's fields", () => {
  test("withholds source querying a dependency this Action no longer declares", () => {
    const source = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      "  });",
      "  query.all({",
      '    sql: \'SELECT "id" FROM "cap_journals"\',',
      '    result: [{ alias: "id", type: "string" }],',
      "  });",
      '  return rows.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");

    expect(reasonFor(READ, source)).toContain("cap_journals");
  });

  // The executable-SQL check only inspects `query` call sites. A dropped dependency's table
  // surviving in a comment or a dead constant is stale context just the same, so the sweep
  // reads the whole source.
  test("withholds a dropped dependency's table left behind in a comment or dead constant", () => {
    const commented = READ_SOURCE.replace(
      "  const rows",
      '  // Previously joined: SELECT "public_text" FROM "cap_journals".\n  const rows',
    );
    const dead = READ_SOURCE.replace(
      "  const rows",
      '  const legacySql = \'SELECT "public_text" FROM "cap_journals"\';\n  void legacySql;\n  const rows',
    );

    expect(reasonFor(READ, commented)).toContain("cap_journals");
    expect(reasonFor(READ, dead)).toContain("cap_journals");
  });

  test("withholds escaped and assembled dropped dependency table names", () => {
    const escaped = READ_SOURCE.replace(
      "  const rows",
      '  const oldTable = "cap_journ\\u0061ls";\n  void oldTable;\n  const rows',
    );
    const assembled = READ_SOURCE.replace(
      "  const rows",
      '  const oldTable = "cap_jour" + "nals";\n  void oldTable;\n  const rows',
    );

    expect(reasonFor(READ, escaped)).toContain("cap_journals");
    expect(reasonFor(READ, assembled)).toContain("cap_journals");
  });

  // An *active* field of the target is neither inactive nor undeclared: the spec's behavior
  // text reaches every Action's prompt, and read/search may query the target table. Treating
  // "not in this Action's field list" as out of contract withheld nearly every unit of a
  // behavior-change evolution — which regenerates all five Handlers.
  test("admits an active field named outside this Action's own field list", () => {
    const orderedRead = READ_SOURCE.replace(
      'ORDER BY "created_at" DESC',
      'ORDER BY "pinned" DESC, "created_at" DESC',
    );

    expect(verdict(READ, orderedRead)).toEqual({ admitted: true });
    // `pinned` is an active boolean, so it is outside `search`'s text-field projection —
    // and still inside its contract.
    expect(
      verdict(
        { kind: "handler", name: "search" },
        orderedRead.replace("function read(", "function search("),
      ),
    ).toEqual({ admitted: true });
  });

  test("admits a declared dependency's active data and withholds its inactive data", () => {
    const readWith = (column: string) =>
      [
        "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
        "  const rows = query.records({",
        '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
        "  });",
        "  query.all({",
        `    sql: 'SELECT "${column}" FROM "cap_journals"',`,
        `    result: [{ alias: "${column}", type: "string" }],`,
        "  });",
        '  return rows.map(({ record }) => present(record)).join("");',
        "}",
      ].join("\n");
    const spec = candidateWithJournalsDependency();

    expect(verdict(READ, readWith("public_text"), spec, journalsCatalog())).toEqual({
      admitted: true,
    });
    expect(reasonFor(READ, readWith("hidden_text"), spec, journalsCatalog())).toContain(
      "hidden_text",
    );
  });

  test("withholds source that claims platform authority the fresh unit cannot have", () => {
    const cases: Readonly<Record<string, string>> = {
      import: `import { readFileSync } from "node:fs";\n${CLEAN_CREATE}`,
      http: CLEAN_CREATE.replace(
        "  const values",
        '  await fetch("https://example.com/notes");\n  const values',
      ),
      "raw mutation SQL": CLEAN_CREATE.replace(
        "  const values",
        '  const statement = \'INSERT INTO "cap_notes" ("text") VALUES (?)\';\n  void statement;\n  const values',
      ),
      connection: CLEAN_CREATE.replace(
        "  const values",
        "  const database = mutation.database;\n  void database;\n  const values",
      ),
    };

    for (const [name, source] of Object.entries(cases)) {
      expect({ [name]: verdict(CREATE, source).admitted }).toEqual({ [name]: false });
    }
  });

  test("withholds an item renderer that reads a field the candidate no longer shows", () => {
    const source = CLEAN_ITEM.replace("record.text", "record.legacy_note");

    expect(reasonFor(ITEM, source)).toContain("legacy_note");
    // `pinned` is still an active field — but it is not in `item.shows`, so it is outside
    // *this* unit's contract just the same.
    expect(reasonFor(ITEM, CLEAN_ITEM.replace("record.text", "record.pinned"))).toContain("pinned");
  });

  test("withholds an item renderer that imports", () => {
    expect(verdict(ITEM, `import { escape } from "html";\n${CLEAN_ITEM}`).admitted).toBe(false);
  });

  // The field-access check finds the renderer by looking for a default *function
  // declaration*. An arrow-const default export would leave it with nothing to inspect, so
  // the export-shape rule has to run first — an unanalyzable shape is doubt, not a pass.
  test("withholds an item renderer whose export shape cannot be analyzed", () => {
    const arrowExport = [
      "const renderItem = (record: Record<string, unknown>): string =>",
      '  `<div class="stack">${String(record.created_at)}${String(record.legacy_note)}</div>`;',
      "export default renderItem;",
    ].join("\n");

    expect(verdict(ITEM, arrowExport).admitted).toBe(false);
  });
});

// The prompt is where admissibility becomes real: withheld source must not reach it in any
// form, and the builder itself decides nothing — it places only what it is handed.
describe("prior source in the regeneration prompt", () => {
  test("carries admitted source and is unchanged without it", () => {
    const spec = candidateSpec();
    const withPrior = buildUnitPrompt(spec, CREATE, undefined, [], CLEAN_CREATE);
    const withoutPrior = buildUnitPrompt(spec, CREATE, undefined, []);

    expect(withPrior).toContain(CLEAN_CREATE);
    expect(withPrior).toContain("Prior committed source for this create.ts handler");
    expect(withoutPrior).not.toContain("Prior committed source");
    expect(withPrior.startsWith(withoutPrior)).toBe(true);
  });

  // On a retry the source stays, but the failure to fix has to be the last thing read.
  test("keeps admitted source on a retry, with the failure feedback last", () => {
    const prompt = buildUnitPrompt(
      candidateSpec(),
      CREATE,
      { ...CREATE, message: "Generated handlers must not import anything." },
      [],
      CLEAN_CREATE,
    );

    expect(prompt).toContain(CLEAN_CREATE);
    expect(prompt.indexOf(CLEAN_CREATE)).toBeLessThan(prompt.indexOf("Previous attempt failed."));
    expect(prompt.trimEnd().endsWith("Generated handlers must not import anything.")).toBe(true);
  });

  // The backstop: a caller that hands over inadmissible source gets a prompt with none of
  // its bytes rather than a leak, whatever the caller believed.
  test("generation drops inadmissible prior source before the prompt is built", async () => {
    const inadmissible = CLEAN_CREATE.replace(
      "  return present",
      "  values.legacy_note = input.values.legacy_note;\n  return present",
    );
    const { provider, prompts } = recordingProvider();

    await expect(
      generateCapabilityUnit({
        provider,
        spec: candidateSpec(),
        unit: CREATE,
        maxAttempts: 1,
        priorSource: inadmissible,
      }),
    ).rejects.toThrow();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("Prior committed source");
    expect(prompts[0]).not.toContain("legacy_note");
    expect(prompts[0]).not.toContain('if ("text" in input.values)');
  });

  test("generation drops statically assembled hidden context before prompt construction", async () => {
    const assembled = CLEAN_CREATE.replace(
      "  const values",
      '  const stale = "pin" + "ned";\n  void stale;\n  const values',
    );
    const { provider, prompts } = recordingProvider();

    await expect(
      generateCapabilityUnit({
        provider,
        spec: candidateWithPinnedInactive(),
        unit: CREATE,
        maxAttempts: 1,
        priorSource: assembled,
      }),
    ).rejects.toThrow();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("Prior committed source");
    expect(prompts[0]).not.toContain('const stale = "pin" + "ned"');
  });

  test("generation keeps admissible prior source", async () => {
    const { provider, prompts } = recordingProvider();

    await expect(
      generateCapabilityUnit({
        provider,
        spec: candidateSpec(),
        unit: CREATE,
        maxAttempts: 1,
        priorSource: CLEAN_CREATE,
      }),
    ).rejects.toThrow();

    expect(prompts[0]).toContain(CLEAN_CREATE);
  });
});

/**
 * A provider that records every prompt and answers with content that fails the very first
 * static check — the loop then exhausts without paying for an isolated type-check, and the
 * recorded prompts are the whole point of the call.
 */
function recordingProvider(): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    provider: {
      generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
        prompts.push(prompt);
        const object = schema.parse({ content: "const notAUnit = 1;\n" });

        async function* stream(): AsyncGenerator<DeepPartial<T>> {
          yield object as DeepPartial<T>;
        }

        return {
          partialStream: stream(),
          object: Promise.resolve(object),
          usage: Promise.resolve(STUB_USAGE),
        };
      },
    },
  };
}
