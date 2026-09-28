// Tests for the capability spec shape (Epic 2.1 plus Module 3.3's presentation intent reshape).
// The headline guarantee: anything outside the contract — unknown types, relations, the `auto`
// concept, old `views`, platform-owned column names — fails validation loudly rather than flowing
// downstream into DDL or generation.
//
// This file covers field-type and field-name shape. Presentation lives in
// `spec.presentation.test.ts`; the Action tuple, behavioral errors, top-level strictness and rows
// live in `spec.behavior.test.ts`. The shared `validSpec` fixture lives in `spec.test-support.ts`.

import { describe, expect, test } from "bun:test";
import { FILE_FAMILIES } from "../fields/file.ts";
import { validSpec } from "./spec.test-support.ts";
import {
  ALUNA_RESERVED_FIELD_PREFIX,
  type CapabilitySpec,
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  FORM_SHADOWING_FIELD_NAMES,
  fieldTypeSchema,
  isChoiceFieldType,
  isListFieldType,
  PLATFORM_COLUMNS,
} from "./spec.ts";
import { MAX_SQL_NAME_LENGTH } from "./spec-text.ts";

/** One well-formed field of any pantry type; a choice carries its options, a file its families. */
function pantryField(type: CapabilitySpec["schema"]["fields"][number]["type"], required: boolean) {
  return {
    name: "value",
    label: "Value",
    type,
    required,
    lifecycle: "active" as const,
    ...(type === "choice" ? { values: [{ value: "one", label: "One" }], groups: [] } : {}),
    ...(type === "file" ? { accepts: [...FILE_FAMILIES] } : {}),
  };
}

describe("capability spec shape — valid shapes & pantry types", () => {
  test("accepts a valid reshaped spec", () => {
    const spec = validSpec();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
  });

  test("accepts every pantry type, each required or not", () => {
    expect(isListFieldType("string[]")).toBe(true);
    expect(isListFieldType("number[]")).toBe(false);
    expect(isChoiceFieldType("choice")).toBe(true);
    expect(isChoiceFieldType("string")).toBe(false);

    for (const type of fieldTypeSchema.options) {
      for (const required of [true, false]) {
        const spec = validSpec({
          schema: { fields: [pantryField(type, required)] },
        });
        expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
      }
    }
  });
});

describe("capability spec shape — list-input modes", () => {
  test("requires one closed list-input mode per active string[] in schema-field order", () => {
    const schema: CapabilitySpec["schema"] = {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        {
          name: "retired_aliases",
          label: "Retired aliases",
          type: "string[]",
          required: false,
          lifecycle: "inactive",
        },
        {
          name: "quotes",
          label: "Quotes",
          type: "string[]",
          required: false,
          lifecycle: "active",
        },
      ],
    };
    const accepted = validSpec({
      schema,
      ui_intent: {
        form: {
          list_inputs: [
            { field: "tags", mode: "comma_separated" },
            { field: "quotes", mode: "repeatable" },
          ],
          choice_inputs: [],
          long_text: [],
          guidance: [],
        },
        item: { direction: "Show the title with its tags.", shows: ["title", "tags"] },
        collection: { layout: "feed" },
      },
      behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    });
    expect(capabilitySpecSchema.parse(accepted)).toEqual(accepted);

    const invalidEntries: readonly (readonly Record<string, unknown>[])[] = [
      [{ field: "tags", mode: "comma_separated" }],
      [
        { field: "quotes", mode: "repeatable" },
        { field: "tags", mode: "comma_separated" },
      ],
      [
        { field: "tags", mode: "comma_separated" },
        { field: "tags", mode: "repeatable" },
      ],
      [
        { field: "title", mode: "comma_separated" },
        { field: "quotes", mode: "repeatable" },
      ],
      [
        { field: "retired_aliases", mode: "repeatable" },
        { field: "quotes", mode: "repeatable" },
      ],
      [
        { field: "unknown", mode: "repeatable" },
        { field: "quotes", mode: "repeatable" },
      ],
      [
        { field: "tags", mode: "invented" },
        { field: "quotes", mode: "repeatable" },
      ],
    ];

    for (const list_inputs of invalidEntries) {
      expect(
        capabilitySpecSchema.safeParse({
          ...accepted,
          ui_intent: { ...accepted.ui_intent, form: { list_inputs } },
        }).success,
      ).toBe(false);
    }
  });
});

/** The issue paths a spec raises when its one field is `field`; empty when it parses. */
function fieldIssuePaths(field: Record<string, unknown>): string[] {
  const spec = validSpec({
    schema: { fields: [field as CapabilitySpec["schema"]["fields"][number]] },
  });
  const parsed = capabilitySpecSchema.safeParse(spec);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("capability spec shape — rejected types & relations", () => {
  test("rejects every list spelling the pantry does not admit, on the field's type", () => {
    const admitted: readonly string[] = fieldTypeSchema.options;
    const unadmitted = admitted
      .map((type) => `${type}[]`)
      .filter((type) => !admitted.includes(type));
    expect(unadmitted.length).toBeGreaterThan(0);
    expect(fieldIssuePaths(pantryField("string", true))).toEqual([]);

    for (const type of unadmitted) {
      expect(fieldIssuePaths({ ...pantryField("string", true), type })).toContain(
        "schema.fields.0.type",
      );
    }
  });

  test("rejects relation shapes — no foreign keys, ever", () => {
    expect(fieldIssuePaths(pantryField("string", true))).toEqual([]);
    expect(fieldIssuePaths({ ...pantryField("string", true), type: "relation" })).toEqual([
      "schema.fields.0.type",
    ]);
    expect(fieldIssuePaths({ ...pantryField("string", true), references: "people" })).toEqual([
      "schema.fields.0",
    ]);
  });

  test("rejects the `auto` concept — the recorded deviation from ARCH §6.3's example", () => {
    const loggedAt = { ...pantryField("datetime", false), name: "logged_at" };
    expect(fieldIssuePaths(loggedAt)).toEqual([]);
    expect(fieldIssuePaths({ ...loggedAt, auto: true })).toEqual(["schema.fields.0"]);
  });
});

describe("capability spec shape — rejected & reserved field names", () => {
  // SQLite takes an identifier of any length, so an enormous id produced valid DDL and then a
  // path component past every filesystem's limit — discovered at publication, after the build.
  test("rejects an id longer than a path component may be", () => {
    const longest = `a${"b".repeat(MAX_SQL_NAME_LENGTH - 1)}`;
    expect(capabilitySpecSchema.safeParse(validSpec({ id: longest })).success).toBe(true);
    expect(capabilitySpecSchema.safeParse(validSpec({ id: `${longest}c` })).success).toBe(false);
  });

  test("rejects a field name longer than a path component may be", () => {
    const longest = `a${"b".repeat(MAX_SQL_NAME_LENGTH - 1)}`;
    const base = validSpec();
    const withField = (name: string) => ({
      ...base,
      schema: { fields: [...base.schema.fields, { ...pantryField("string", false), name }] },
    });
    expect(capabilitySpecSchema.safeParse(withField(longest)).success).toBe(true);
    expect(capabilitySpecSchema.safeParse(withField(`${longest}c`)).success).toBe(false);
  });

  test("rejects platform-owned column names as spec fields", () => {
    expect(fieldIssuePaths(pantryField("string", true))).toEqual([]);
    for (const name of PLATFORM_COLUMNS) {
      expect(fieldIssuePaths({ ...pantryField("string", true), name })).toEqual([
        "schema.fields.0.name",
      ]);
    }
  });

  test("rejects a name that would hide a form method the browser calls on submit", () => {
    for (const name of FORM_SHADOWING_FIELD_NAMES) {
      expect(fieldIssuePaths({ ...pantryField("string", true), name })).toEqual([
        "schema.fields.0.name",
      ]);
    }
    for (const name of ["title", "role", "name", "action"]) {
      expect(fieldIssuePaths({ ...pantryField("string", true), name })).toEqual([]);
    }
  });

  test("rejects the reserved __aluna_ wire-protocol prefix", () => {
    const reserved = `${ALUNA_RESERVED_FIELD_PREFIX}present`;
    expect(fieldIssuePaths({ ...pantryField("string", true), name: reserved.slice(2) })).toEqual(
      [],
    );
    const parsed = capabilitySpecSchema.safeParse(
      validSpec({ schema: { fields: [{ ...pantryField("string", true), name: reserved }] } }),
    );
    const nameIssues = parsed.success
      ? []
      : parsed.error.issues.filter((issue) => issue.path.join(".") === "schema.fields.0.name");
    expect(nameIssues.some((issue) => issue.message.includes(ALUNA_RESERVED_FIELD_PREFIX))).toBe(
      true,
    );
  });

  test("rejects duplicate field names and an empty field list", () => {
    const text = { name: "text", label: "Text", type: "string", required: true } as const;
    const fields = (second: string): CapabilitySpec["schema"]["fields"] => [
      { ...text, lifecycle: "active" },
      { ...text, name: second, type: "number", required: false, lifecycle: "active" },
    ];
    const paths = (spec: CapabilitySpec) => {
      const parsed = capabilitySpecSchema.safeParse(spec);
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
    };
    expect(paths(validSpec({ schema: { fields: fields("words") } }))).toEqual([]);
    expect(paths(validSpec({ schema: { fields: fields("text") } }))).toContain("schema.fields");
    expect(paths(validSpec({ schema: { fields: [] } }))).toContain("schema.fields");
  });

  test("field and capability names must be safe SQL identifiers", () => {
    expect(fieldIssuePaths({ ...pantryField("string", true), name: "safe_name_2" })).toEqual([]);
    expect(capabilitySpecSchema.safeParse(validSpec({ id: "safe_name_2" })).success).toBe(true);
    for (const name of ["My Field", "1st", "UPPER", "dash-ed", ""]) {
      expect(fieldIssuePaths({ ...pantryField("string", true), name })).toContain(
        "schema.fields.0.name",
      );
      expect(capabilitySpecSchema.safeParse(validSpec({ id: name })).success).toBe(false);
    }
  });
});
