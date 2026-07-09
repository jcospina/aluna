// Tests for the capability spec shape (Epic 2.1 plus Module 3.3's presentation
// intent reshape). The headline guarantees: the pantry is exactly five field types
// (the M2 four plus M3's date) each with `required`; `ui_intent` records only item,
// closed collection layout, and detail order; and anything outside the contract —
// list types, files, relations, the `auto` concept, old `views`, platform-owned
// column names — fails validation loudly instead of flowing downstream into DDL or
// generation.

import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  capabilityRowSchema,
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  fieldTypeSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
} from "./spec.ts";

// A minimal valid spec, fresh per call so tests can mutate freely. Overrides
// merge shallowly — pass a whole `schema`/`ui_intent` object to change those.
function validSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const spec: CapabilitySpec = {
    id: "notes",
    label: "Notes",
    schema: { fields: [{ name: "text", type: "string", required: true }] },
    ui_intent: {
      item: "A text-forward card that emphasizes the note text.",
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };

  const normalizedSpec = {
    ...spec,
    ...(overrides.schema && !("ui_intent" in overrides)
      ? {
          ui_intent: {
            ...spec.ui_intent,
            detail: { shows: spec.schema.fields.map((field) => field.name) },
          },
        }
      : {}),
    ...(overrides.schema && !("behavioral_errors" in overrides)
      ? { behavioral_errors: defaultBehavioralErrorsForSchema(spec.schema) }
      : {}),
  };

  if (overrides.schema || !("behavioral_errors" in overrides)) {
    return normalizedSpec;
  }

  return spec;
}

describe("capability spec shape", () => {
  test("accepts a valid reshaped spec", () => {
    const spec = validSpec();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
  });

  test("accepts exactly the five field types (the M2 four plus date), each with required", () => {
    expect(fieldTypeSchema.options).toEqual(["string", "number", "boolean", "datetime", "date"]);

    for (const type of fieldTypeSchema.options) {
      for (const required of [true, false]) {
        const spec = validSpec({
          schema: { fields: [{ name: "value", type, required }] },
        });
        expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
      }
    }
  });

  test("rejects list types (M4) and file types (M6) loudly", () => {
    for (const type of ["string[]", "number[]", "file", "file[]"]) {
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
      // @ts-expect-error — deliberately outside the enum.
      schema: { fields: [{ name: "author", type: "relation", required: true }] },
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

  test("rejects platform-owned column names as spec fields", () => {
    for (const name of PLATFORM_COLUMNS) {
      const spec = validSpec({
        schema: { fields: [{ name, type: "string", required: true }] },
      });
      expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
    }
  });

  test("rejects duplicate field names and an empty field list", () => {
    const duplicates = validSpec({
      schema: {
        fields: [
          { name: "text", type: "string", required: true },
          { name: "text", type: "number", required: false },
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
        schema: { fields: [{ name, type: "string", required: true }] },
      });
      expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
      expect(capabilitySpecSchema.safeParse(validSpec({ id: name })).success).toBe(false);
    }
  });

  test("ui_intent records item, closed collection layout, and real detail fields only", () => {
    const grid = validSpec({
      ui_intent: {
        item: "A visual tile that foregrounds the primary field.",
        collection: { layout: "grid" },
        detail: { shows: ["text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(grid).success).toBe(true);

    // @ts-expect-error — M2's generated-view state is retired from ui_intent.
    const oldViews = validSpec({ ui_intent: { views: ["list", "create"] } });
    expect(capabilitySpecSchema.safeParse(oldViews).success).toBe(false);

    const unknownLayout = validSpec({
      ui_intent: {
        item: "A visual tile that foregrounds the primary field.",
        // @ts-expect-error — unknown collection layouts must fail closed.
        collection: { layout: "masonry" },
        detail: { shows: ["text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(unknownLayout).success).toBe(false);

    const unknownDetailField = validSpec({
      ui_intent: {
        item: "A text-forward card that emphasizes the note text.",
        collection: { layout: "feed" },
        detail: { shows: ["missing"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(unknownDetailField).success).toBe(false);

    const duplicateDetailField = validSpec({
      ui_intent: {
        item: "A text-forward card that emphasizes the note text.",
        collection: { layout: "feed" },
        detail: { shows: ["text", "text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(duplicateDetailField).success).toBe(false);

    const modalFlag = validSpec({
      ui_intent: {
        item: "A text-forward card that emphasizes the note text.",
        collection: { layout: "feed" },
        detail: { shows: ["text"] },
        // @ts-expect-error — the shared modal is a platform invariant, not stored state.
        modal: true,
      },
    });
    expect(capabilitySpecSchema.safeParse(modalFlag).success).toBe(false);
  });

  test("tools still speak only M2's two actions", () => {
    // @ts-expect-error — `delete` is a later module's tool.
    const deleteTool = validSpec({ tools: ["create", "read", "delete"] });
    expect(capabilitySpecSchema.safeParse(deleteTool).success).toBe(false);

    const noTools = validSpec({ tools: [] });
    expect(capabilitySpecSchema.safeParse(noTools).success).toBe(false);
  });

  test("requires stable behavioral error markers for missing required fields", () => {
    const missingContract = validSpec({ behavioral_errors: [] });
    expect(capabilitySpecSchema.safeParse(missingContract).success).toBe(false);

    const wrongFields = validSpec({
      behavioral_errors: [
        {
          action: "create",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["unknown"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
    });
    expect(capabilitySpecSchema.safeParse(wrongFields).success).toBe(false);

    const optionalOnly = validSpec({
      schema: { fields: [{ name: "text", type: "string", required: false }] },
      behavioral_errors: [],
    });
    expect(capabilitySpecSchema.parse(optionalOnly)).toEqual(optionalOnly);
  });

  test("rejects unknown top-level keys and blank free text", () => {
    // @ts-expect-error — strictness applies at the top level too.
    const extraKey = validSpec({ migrations: ["CREATE TABLE evil;"] });
    expect(capabilitySpecSchema.safeParse(extraKey).success).toBe(false);

    expect(capabilitySpecSchema.safeParse(validSpec({ behavior: "   " })).success).toBe(false);
    expect(capabilitySpecSchema.safeParse(validSpec({ label: "" })).success).toBe(false);
  });

  test("generated labels must be short names, not product-voice sentences", () => {
    expect(capabilitySpecSchema.safeParse(validSpec({ label: "Reading list" })).success).toBe(true);
    expect(
      capabilitySpecSchema.safeParse(
        validSpec({ label: "We'll set up a space to capture and organize all your notes." }),
      ).success,
    ).toBe(false);
  });
});

describe("capability row shape", () => {
  test("a row is the spec plus platform-assigned version and artifacts_path", () => {
    const row = { ...validSpec(), version: 1, artifacts_path: "capabilities/notes/v1/" };
    expect(capabilityRowSchema.parse(row)).toEqual(row);

    // The spec shape itself must NOT accept the platform-assigned values — the
    // AI authors the spec; the platform assigns version and pointer at commit.
    expect(capabilitySpecSchema.safeParse(row).success).toBe(false);
  });

  test("version must be a positive integer", () => {
    const spec = validSpec();
    const artifacts_path = "capabilities/notes/v1/";

    for (const version of [0, -1, 1.5]) {
      const result = capabilityRowSchema.safeParse({ ...spec, version, artifacts_path });
      expect(result.success).toBe(false);
    }
  });

  test("a bare spec without version/artifacts_path is not a row", () => {
    expect(capabilityRowSchema.safeParse(validSpec()).success).toBe(false);
  });

  test("legacy rows with sentence labels still parse for display fallback", () => {
    const row = {
      ...validSpec(),
      label: "We'll set up a space to capture and organize all your notes.",
      version: 1,
      artifacts_path: "capabilities/notes/v1/",
    };

    expect(capabilityRowSchema.safeParse(row).success).toBe(true);
  });
});
