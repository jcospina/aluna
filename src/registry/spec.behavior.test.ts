// Behavioral and structural contract slices of the capability spec shape: the fixed
// five-Action tuple, the complete per-Action read_dependencies shape, the stable
// missing-required behavioral error markers, top-level key strictness, and the
// separate capability row shape. Field-type and field-name shape live in
// `spec.test.ts`; presentation lives in `spec.presentation.test.ts`. The shared
// `validSpec` fixture lives in `spec.test-support.ts`.

import { describe, expect, test } from "bun:test";
import { validSpec } from "./spec.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  capabilityRowSchema,
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./spec.ts";

describe("capability spec shape — Action tuple & read dependencies", () => {
  test("admits only the exact ordered five-Action inventory", () => {
    // The transitional two-Action shape and every subset, superset, and misordering
    // are rejected — from the 4.4 cutover the only admitted tuple is the fixed five.
    for (const tools of [
      ["create"],
      ["read"],
      ["create", "read"],
      ["read", "create"],
      ["create", "read", "update"],
      ["create", "read", "delete"],
      ["create", "read", "search"],
      ["create", "read", "update", "delete"],
      ["read", "create", "update", "delete", "search"],
      ["create", "read", "update", "delete", "search", "create"],
      [],
    ]) {
      expect(capabilitySpecSchema.safeParse({ ...validSpec(), tools }).success).toBe(false);
    }
    expect(
      capabilitySpecSchema.safeParse({ ...validSpec(), tools: [...FULL_CAPABILITY_TOOLS] }).success,
    ).toBe(true);
  });

  test("requires the complete per-Action read_dependencies key shape", () => {
    const spec = validSpec();
    expect(spec.read_dependencies).toEqual({
      create: [],
      read: [],
      update: [],
      delete: [],
      search: [],
    });

    for (const read_dependencies of [
      { create: [], read: [] }, // the removed transitional two-key shape
      { create: [], read: [], update: [], delete: [] }, // missing search
      { create: [], read: [], update: [], delete: [], search: {} }, // non-array value
      { create: [], read: [], update: [], delete: [], search: [], extra: [] }, // unknown key
    ]) {
      expect(capabilitySpecSchema.safeParse({ ...spec, read_dependencies }).success).toBe(false);
    }
  });

  test("admits only the complete five-Action shape pair", () => {
    const base = validSpec();
    const full = {
      ...base,
      tools: [...FULL_CAPABILITY_TOOLS],
      read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
      behavioral_errors: defaultBehavioralErrorsForSchema(base.schema),
    };
    expect(capabilitySpecSchema.parse(full)).toEqual(full);

    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        tools: ["create", "read", "update", "delete"],
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        read_dependencies: { create: [], read: [], update: [], delete: [] },
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        behavioral_errors: full.behavioral_errors.slice(0, 1),
      }).success,
    ).toBe(false);
  });

  test("full Action dependencies reject self, duplicates, and non-canonical order", () => {
    const base = validSpec();
    const dependency = (capability_id: string, incarnation_id: string) => ({
      capability_id,
      incarnation_id,
    });
    const a = dependency("recipes", "11111111-1111-4111-8111-111111111111");
    const b = dependency("tasks", "22222222-2222-4222-8222-222222222222");
    const full = {
      ...base,
      tools: [...FULL_CAPABILITY_TOOLS],
      behavioral_errors: defaultBehavioralErrorsForSchema(base.schema),
      read_dependencies: { create: [], read: [a, b], update: [], delete: [], search: [] },
    };
    expect(capabilitySpecSchema.safeParse(full).success).toBe(true);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        read_dependencies: { ...full.read_dependencies, read: [b, a] },
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        read_dependencies: { ...full.read_dependencies, read: [a, a] },
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        read_dependencies: {
          ...full.read_dependencies,
          read: [dependency("notes", "33333333-3333-4333-8333-333333333333")],
        },
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        behavioral_errors: [
          ...full.behavioral_errors,
          {
            action: "update",
            trigger: "record_not_found",
            code: "record_not_found",
            fields: ["text"],
            expected_markers: BEHAVIORAL_ERROR_MARKERS,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("capability spec shape — behavioral error ownership", () => {
  test("admits unique errors for present Actions and rejects malformed ownership", () => {
    const base = validSpec();
    const full = {
      ...base,
      tools: [...FULL_CAPABILITY_TOOLS],
      read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
      behavioral_errors: [
        ...defaultBehavioralErrorsForSchema(base.schema),
        {
          action: "search" as const,
          trigger: "invalid_query",
          code: "invalid_query",
          fields: ["text"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
    };
    expect(capabilitySpecSchema.safeParse(full).success).toBe(true);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        behavioral_errors: [...full.behavioral_errors, full.behavioral_errors[2]],
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        behavioral_errors: full.behavioral_errors.map((errorCase, index) =>
          index === 2 ? { ...errorCase, action: "unknown" } : errorCase,
        ),
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...full,
        behavioral_errors: full.behavioral_errors.map((errorCase, index) => {
          if (index !== 2) return errorCase;
          const { action: _action, ...withoutAction } = errorCase;
          return withoutAction;
        }),
      }).success,
    ).toBe(false);
  });
});

describe("capability spec shape — behavioral error contract", () => {
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
      schema: {
        fields: [
          { name: "text", label: "Text", type: "string", required: false, lifecycle: "active" },
        ],
      },
      behavioral_errors: [],
    });
    expect(capabilitySpecSchema.parse(optionalOnly)).toEqual(optionalOnly);

    for (const action of ["read", "update", "delete", "search"]) {
      expect(
        capabilitySpecSchema.safeParse({
          ...validSpec(),
          behavioral_errors: [{ ...validSpec().behavioral_errors[0], action }],
        }).success,
      ).toBe(false);
    }
  });
});

describe("capability spec shape — behavioral error field identity", () => {
  test("missing-required error fields are exactly the active required fields", () => {
    const schema: CapabilitySpec["schema"] = {
      fields: [
        { name: "text", label: "Entry", type: "string", required: true, lifecycle: "active" },
        { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
        {
          name: "retired_note",
          label: "Retired note",
          type: "string",
          required: true,
          lifecycle: "inactive",
        },
      ],
    };
    expect(defaultBehavioralErrorsForSchema(schema)[0]?.fields).toEqual(["text"]);

    const valid = validSpec({
      schema,
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the entry.", shows: ["text"] },
        collection: { layout: "feed" },
        detail: { shows: ["text", "note"] },
      },
      behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    });
    expect(capabilitySpecSchema.safeParse(valid).success).toBe(true);
    expect(
      capabilitySpecSchema.safeParse({
        ...valid,
        behavioral_errors: [
          {
            ...valid.behavioral_errors[0],
            fields: ["text", "retired_note"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...valid,
        behavioral_errors: [valid.behavioral_errors[0], valid.behavioral_errors[0]],
      }).success,
    ).toBe(false);

    const twoRequired = validSpec({
      schema: {
        fields: [
          { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
          { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        ],
      },
    });
    expect(twoRequired.behavioral_errors[0]?.fields).toEqual(["title", "text"]);
    expect(
      capabilitySpecSchema.safeParse({
        ...twoRequired,
        behavioral_errors: [{ ...twoRequired.behavioral_errors[0], fields: ["text", "title"] }],
      }).success,
    ).toBe(false);
  });
});

describe("capability spec shape — top-level key strictness", () => {
  test("rejects unknown top-level keys and blank free text", () => {
    // @ts-expect-error — strictness applies at the top level too.
    const extraKey = validSpec({ migrations: ["CREATE TABLE evil;"] });
    expect(capabilitySpecSchema.safeParse(extraKey).success).toBe(false);

    expect(capabilitySpecSchema.safeParse(validSpec({ behavior: "   " })).success).toBe(false);
    expect(capabilitySpecSchema.safeParse(validSpec({ label: "" })).success).toBe(false);
  });
});

describe("capability row shape", () => {
  const incarnation_id = "11111111-1111-4111-8111-111111111111";

  test("a row is the spec plus platform-assigned incarnation, version, and artifacts_path", () => {
    const row = {
      ...validSpec(),
      incarnation_id,
      version: 1,
      artifacts_path: `capabilities/notes/${incarnation_id}/v1/`,
    };
    expect(capabilityRowSchema.parse(row)).toEqual(row);

    // The spec shape itself must NOT accept the platform-assigned values — the
    // AI authors the spec; the platform assigns version and pointer at commit.
    expect(capabilitySpecSchema.safeParse(row).success).toBe(false);
  });

  test("the AI-authored spec cannot include a capability incarnation", () => {
    expect(capabilitySpecSchema.safeParse({ ...validSpec(), incarnation_id }).success).toBe(false);
  });

  test("version must be a positive integer", () => {
    const spec = validSpec();
    const artifacts_path = `capabilities/notes/${incarnation_id}/v1/`;

    for (const version of [0, -1, 1.5]) {
      const result = capabilityRowSchema.safeParse({
        ...spec,
        incarnation_id,
        version,
        artifacts_path,
      });
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
      incarnation_id,
      version: 1,
      artifacts_path: `capabilities/notes/${incarnation_id}/v1/`,
    };

    expect(capabilityRowSchema.safeParse(row).success).toBe(true);
  });
});
