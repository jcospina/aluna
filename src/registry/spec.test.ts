// Tests for the capability spec shape (Epic 2.1, PLAN decision 8). The headline
// guarantees: the M2 pantry is exactly four field types each with `required`,
// and anything outside it — list types, files, relations, the `auto` concept,
// platform-owned column names — fails validation loudly instead of flowing
// downstream into DDL or generation.

import { describe, expect, test } from "bun:test";

import {
  type CapabilitySpec,
  capabilityRowSchema,
  capabilitySpecSchema,
  fieldTypeSchema,
  PLATFORM_COLUMNS,
} from "./spec.ts";

// A minimal valid spec, fresh per call so tests can mutate freely. Overrides
// merge shallowly — pass a whole `schema`/`ui_intent` object to change those.
function validSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: { fields: [{ name: "text", type: "string", required: true }] },
    ui_intent: { views: ["list", "create"] },
    behavior: "Text is required. Newest notes appear first.",
    tools: ["create", "read"],
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

describe("capability spec shape", () => {
  test("accepts a valid M2 spec", () => {
    const spec = validSpec();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
  });

  test("accepts exactly the four M2 field types, each with required", () => {
    expect(fieldTypeSchema.options).toEqual(["string", "number", "boolean", "datetime"]);

    for (const type of fieldTypeSchema.options) {
      for (const required of [true, false]) {
        const spec = validSpec({
          schema: { fields: [{ name: "value", type, required }] },
        });
        expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
      }
    }
  });

  test("rejects list types (M3) and file types (M5) loudly", () => {
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

  test("ui_intent speaks only M2's two views; tools only M2's two actions", () => {
    // @ts-expect-error — `detail` is a later module's view.
    const detailView = validSpec({ ui_intent: { views: ["list", "detail"] } });
    expect(capabilitySpecSchema.safeParse(detailView).success).toBe(false);

    // @ts-expect-error — `delete` is a later module's tool.
    const deleteTool = validSpec({ tools: ["create", "read", "delete"] });
    expect(capabilitySpecSchema.safeParse(deleteTool).success).toBe(false);

    const dupView = validSpec({ ui_intent: { views: ["list", "list"] } });
    expect(capabilitySpecSchema.safeParse(dupView).success).toBe(false);

    const noTools = validSpec({ tools: [] });
    expect(capabilitySpecSchema.safeParse(noTools).success).toBe(false);
  });

  test("rejects unknown top-level keys and blank free text", () => {
    // @ts-expect-error — strictness applies at the top level too.
    const extraKey = validSpec({ migrations: ["CREATE TABLE evil;"] });
    expect(capabilitySpecSchema.safeParse(extraKey).success).toBe(false);

    expect(capabilitySpecSchema.safeParse(validSpec({ behavior: "   " })).success).toBe(false);
    expect(capabilitySpecSchema.safeParse(validSpec({ label: "" })).success).toBe(false);
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
});
