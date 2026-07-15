// Tests for the capability spec shape (Epic 2.1 plus Module 3.3's presentation
// intent reshape). The headline guarantees: the pantry is the five scalar types
// plus M4's one list type, each with `required`; `ui_intent` records only item,
// closed collection layout, and detail order; and anything outside the contract —
// list types, files, relations, the `auto` concept, old `views`, platform-owned
// column names — fails validation loudly instead of flowing downstream into DDL or
// generation.
//
// This file covers field-type and field-name shape. Presentation (`ui_intent`,
// labels, lifecycle) lives in `spec.presentation.test.ts`; the Action tuple,
// behavioral errors, top-level strictness, and rows live in
// `spec.behavior.test.ts`. The shared `validSpec` fixture lives in
// `spec.test-support.ts`.

import { describe, expect, test } from "bun:test";
import { validSpec } from "./spec.test-support.ts";
import {
  type CapabilitySpec,
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  fieldTypeSchema,
  isListFieldType,
  LIST_FIELD_TYPES,
  LIST_INPUT_MODES,
  PLATFORM_COLUMNS,
} from "./spec.ts";

describe("capability spec shape — valid shapes & pantry types", () => {
  test("accepts a valid reshaped spec", () => {
    const spec = validSpec();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
  });

  test("accepts the scalar pantry plus string[], each with required", () => {
    expect(fieldTypeSchema.options).toEqual([
      "string",
      "number",
      "boolean",
      "datetime",
      "date",
      "string[]",
    ]);
    expect(LIST_FIELD_TYPES).toEqual(["string[]"]);
    expect(isListFieldType("string[]")).toBe(true);
    expect(isListFieldType("number[]")).toBe(false);

    for (const type of fieldTypeSchema.options) {
      for (const required of [true, false]) {
        const spec = validSpec({
          schema: {
            fields: [{ name: "value", label: "Value", type, required, lifecycle: "active" }],
          },
        });
        expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
      }
    }
  });
});

describe("capability spec shape — list-input modes", () => {
  test("requires one closed list-input mode per active string[] in schema-field order", () => {
    expect(LIST_INPUT_MODES).toEqual(["comma_separated", "repeatable"]);
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
        },
        item: { direction: "Show the title with its tags.", shows: ["title", "tags"] },
        collection: { layout: "feed" },
        detail: { shows: ["title", "tags", "quotes"] },
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

describe("capability spec shape — rejected types & relations", () => {
  test("rejects unadmitted list types and file types loudly", () => {
    for (const type of ["number[]", "boolean[]", "date[]", "datetime[]", "file", "file[]"]) {
      const spec = validSpec({
        // @ts-expect-error — the type system already excludes these; the runtime gate must too.
        schema: { fields: [{ name: "value", type, required: true }] },
      });
      expect(() => capabilitySpecSchema.parse(spec)).toThrow();
    }
  });

  test("rejects relation shapes — no foreign keys, ever", () => {
    // A relation as a type string fails the enum…
    const relationType = validSpec({
      schema: {
        fields: [
          {
            name: "author",
            label: "Author",
            // @ts-expect-error — deliberately outside the enum.
            type: "relation",
            required: true,
            lifecycle: "active",
          },
        ],
      },
    });
    expect(capabilitySpecSchema.safeParse(relationType).success).toBe(false);

    // …and a relation smuggled in as an extra key fails strictness.
    const relationKey = validSpec({
      schema: {
        // @ts-expect-error — unknown keys must be rejected, not stripped.
        fields: [{ name: "author", type: "string", required: true, references: "people" }],
      },
    });
    expect(capabilitySpecSchema.safeParse(relationKey).success).toBe(false);
  });

  test("rejects the `auto` concept — the recorded deviation from ARCH §6.3's example", () => {
    const spec = validSpec({
      schema: {
        // @ts-expect-error — `auto` does not exist in M2's pantry (PLAN decision 8).
        fields: [{ name: "logged_at", type: "datetime", required: false, auto: true }],
      },
    });
    expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
  });
});

describe("capability spec shape — rejected & reserved field names", () => {
  test("rejects platform-owned column names as spec fields", () => {
    for (const name of PLATFORM_COLUMNS) {
      const spec = validSpec({
        schema: {
          fields: [
            { name, label: "Reserved", type: "string", required: true, lifecycle: "active" },
          ],
        },
      });
      expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
    }
  });

  test("rejects the reserved __aluna_ wire-protocol prefix", () => {
    const parsed = capabilitySpecSchema.safeParse({
      ...validSpec(),
      schema: {
        fields: [
          {
            name: "__aluna_present",
            label: "Reserved",
            type: "string",
            required: true,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "A reserved-name probe.", shows: ["__aluna_present"] },
        collection: { layout: "feed" },
        detail: { shows: ["__aluna_present"] },
      },
      behavioral_errors: [],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("reserved __aluna_"))).toBe(
        true,
      );
    }
  });

  test("rejects duplicate field names and an empty field list", () => {
    const duplicates = validSpec({
      schema: {
        fields: [
          { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
          { name: "text", label: "Text", type: "number", required: false, lifecycle: "active" },
        ],
      },
    });
    expect(capabilitySpecSchema.safeParse(duplicates).success).toBe(false);

    const empty = validSpec({ schema: { fields: [] } });
    expect(capabilitySpecSchema.safeParse(empty).success).toBe(false);
  });

  test("field and capability names must be safe SQL identifiers", () => {
    for (const name of ["My Field", "1st", "UPPER", "dash-ed", ""]) {
      const spec = validSpec({
        schema: {
          fields: [{ name, label: "Field", type: "string", required: true, lifecycle: "active" }],
        },
      });
      expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
      expect(capabilitySpecSchema.safeParse(validSpec({ id: name })).success).toBe(false);
    }
  });
});
