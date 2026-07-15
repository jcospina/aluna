// Behavioral and structural contract slices of the capability spec shape: the
// canonical transitional Action tuple, empty M4.1 read dependencies, the stable
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
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./spec.ts";

describe("capability spec shape — Action tuple & read dependencies", () => {
  test("requires the exact canonical transitional Action tuple", () => {
    for (const tools of [
      ["create"],
      ["read"],
      ["read", "create"],
      ["create", "read", "update"],
      ["create", "read", "delete"],
      ["create", "read", "search"],
      [],
    ]) {
      expect(capabilitySpecSchema.safeParse({ ...validSpec(), tools }).success).toBe(false);
    }
  });

  test("requires exactly empty create/read dependency arrays during M4.1", () => {
    const spec = validSpec();
    expect(spec.read_dependencies).toEqual({ create: [], read: [] });

    for (const read_dependencies of [
      { create: [] },
      { read: [] },
      { create: [], read: [], update: [] },
      {
        create: [
          {
            capability_id: "recipes",
            incarnation_id: "11111111-1111-4111-8111-111111111111",
          },
        ],
        read: [],
      },
      {
        create: [],
        read: [
          {
            capability_id: "recipes",
            incarnation_id: "11111111-1111-4111-8111-111111111111",
          },
        ],
      },
    ]) {
      expect(capabilitySpecSchema.safeParse({ ...spec, read_dependencies }).success).toBe(false);
    }
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
