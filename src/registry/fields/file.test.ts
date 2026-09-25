// The file field's registry contract: a spec may declare one, `accepts` says which families it
// takes, and every way of saying that wrongly fails closed before anything downstream reads it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { zodSchema } from "ai";

import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import { FIRST_INCARNATION_ID } from "../incarnations.test-support.ts";
import {
  capabilityRowSchema,
  capabilitySpecSchema,
  FILE_FAMILIES,
  FILE_FIELD_TYPES,
  familiesSchema,
  fieldTypeSchema,
  GENERATION_FIELD_TYPES,
  getCapability,
  insertCapability,
  isFileFieldType,
  isListFieldType,
  isSearchableTextType,
  LIST_FIELD_TYPES,
  promptCapabilitySpecSchema,
  type SpecField,
} from "../index.ts";
import { CAPTION_FIELD, orderings, PHOTO_FIELD, photoSpec } from "./file.test-support.ts";

function refusal(value: unknown): string {
  const parsed = capabilitySpecSchema.safeParse(value);
  if (parsed.success) throw new Error("expected the spec to be refused");
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

function withPhoto(photo: Record<string, unknown>) {
  const spec = photoSpec() as unknown as { schema: { fields: Record<string, unknown>[] } };
  spec.schema.fields[1] = { ...PHOTO_FIELD, ...photo };
  return spec;
}

describe("a spec may declare a file field", () => {
  test("a file field accepting images round-trips through registry parsing", () => {
    const spec = photoSpec();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
  });

  describe("and the registry stores it", () => {
    let env: ScratchDbEnv;
    beforeEach(() => {
      env = createScratchDbEnv("omni-crud-file-field-");
    });
    afterEach(() => teardownScratchDbEnv(env));

    test("a registry row carrying one reads back exactly as written", () => {
      const row = capabilityRowSchema.parse({
        ...photoSpec(),
        incarnation_id: FIRST_INCARNATION_ID,
        version: 1,
        artifacts_path: "artifacts/photos/v1/",
        seed: 4821,
        logo: { status: "absent", attempts: 0 },
        display_label_override: null,
      });
      insertCapability(row, env.conns.readwrite);
      expect(getCapability("photos", env.conns.readonly)).toEqual(row);
    });
  });

  test("a file type stands apart from the list types", () => {
    expect(fieldTypeSchema.options).toEqual(expect.arrayContaining([...FILE_FIELD_TYPES]));
    for (const type of FILE_FIELD_TYPES) {
      expect(LIST_FIELD_TYPES as readonly string[]).not.toContain(type);
      expect(isListFieldType(type)).toBe(false);
      expect(isFileFieldType(type)).toBe(true);
    }
    for (const type of LIST_FIELD_TYPES) expect(isFileFieldType(type)).toBe(false);
  });

  test("a file field is not searchable", () => {
    for (const type of FILE_FIELD_TYPES) expect(isSearchableTextType(type)).toBe(false);
  });

  test("a file field may be required, now the form's control can fill one", () => {
    const spec = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }]);
    expect(capabilitySpecSchema.parse(spec).schema.fields[1]?.required).toBe(true);
  });

  test("a file field never takes a list-input intent", () => {
    const spec = photoSpec();
    spec.ui_intent.form.list_inputs = [{ field: "photo", mode: "repeatable" }];
    expect(refusal(spec)).toContain('field "photo" must be a list field');
  });
});

describe("accepts fails closed", () => {
  test("on a field that is not a file field", () => {
    const spec = photoSpec([{ ...CAPTION_FIELD, accepts: ["image"] }, PHOTO_FIELD]);
    expect(refusal(spec)).toContain("schema.fields.0.accepts: only a file field declares accepts");
  });

  test("when a file field leaves it out", () => {
    const { accepts: _omitted, ...bare } = PHOTO_FIELD;
    const spec = photoSpec([CAPTION_FIELD, bare as SpecField]);
    expect(refusal(spec)).toContain(
      "schema.fields.1.accepts: a file field must declare what it accepts",
    );
  });

  test("when it is null, empty, repeats a family, or names one outside the enum", () => {
    expect(refusal(withPhoto({ accepts: null }))).toContain("schema.fields.1.accepts");
    expect(refusal(withPhoto({ accepts: [] }))).toContain("accepts at least one family");
    expect(refusal(withPhoto({ accepts: ["image", "image"] }))).toContain("at most once");
    for (const family of ["video", "pdf", "IMAGE", ""]) {
      expect(refusal(withPhoto({ accepts: [family] }))).toContain("schema.fields.1.accepts.0");
    }
  });
});

describe("accepts is stored in canonical order", () => {
  // Four families, as Module 7 ends with; this epic admits one, and one cannot be reordered.
  const ORDER = ["image", "video", "audio", "document"] as const;

  test("every ordering of every selection parses to the order's own sequence", () => {
    const schema = familiesSchema(ORDER);
    for (const authored of orderings(ORDER)) {
      expect(schema.parse(authored)).toEqual(ORDER.filter((family) => authored.includes(family)));
    }
  });

  test("and the spec's own accepts is that rule over the admitted families", () => {
    for (const authored of orderings(FILE_FAMILIES)) {
      const canonical = FILE_FAMILIES.filter((family) => authored.includes(family));
      const parsed = capabilitySpecSchema.parse(withPhoto({ accepts: authored }));
      expect(parsed.schema.fields[1]?.accepts).toEqual(canonical);
    }
  });
});

describe("the provider schema", () => {
  function fieldSchemaOf(): Record<string, unknown> {
    const json = zodSchema(promptCapabilitySpecSchema).jsonSchema as {
      properties: { schema: { properties: { fields: { items: Record<string, unknown> } } } };
    };
    return json.properties.schema.properties.fields.items;
  }

  test("lists accepts in required, as nullable", () => {
    const field = fieldSchemaOf() as {
      required: string[];
      properties: { accepts: { anyOf?: { type?: string }[] } };
    };
    expect(field.required).toContain("accepts");
    expect(field.properties.accepts.anyOf?.map((branch) => branch.type)).toEqual(["array", "null"]);
  });

  test("emits no oneOf anywhere", () => {
    expect(JSON.stringify(zodSchema(promptCapabilitySpecSchema).jsonSchema)).not.toContain(
      '"oneOf"',
    );
  });

  test("offers the builder's types, the file type among them", () => {
    const field = fieldSchemaOf() as { properties: { type: { enum: string[] } } };
    expect(field.properties.type.enum).toEqual([...GENERATION_FIELD_TYPES]);
    for (const type of FILE_FIELD_TYPES) expect(field.properties.type.enum).toContain(type);
  });

  test("turns a null accepts into absence, so a non-file field has one spelling", () => {
    const wire = photoSpec([CAPTION_FIELD]) as unknown as {
      schema: { fields: Record<string, unknown>[] };
    };
    for (const field of wire.schema.fields) {
      Object.assign(field, { values: null, groups: null, max_length: null, accepts: null });
    }
    const parsed = promptCapabilitySpecSchema.parse(wire);
    expect("accepts" in (parsed.schema.fields[0] as object)).toBe(false);
  });

  test("takes a file field with its families, and refuses one that names none", () => {
    const wire = photoSpec() as unknown as { schema: { fields: Record<string, unknown>[] } };
    for (const field of wire.schema.fields) {
      Object.assign(field, { values: null, groups: null, max_length: null, accepts: null });
    }
    expect(promptCapabilitySpecSchema.safeParse(wire).success).toBe(false);
    Object.assign(wire.schema.fields[1] ?? {}, { accepts: [...FILE_FAMILIES] });
    const parsed = promptCapabilitySpecSchema.parse(wire);
    expect(parsed.schema.fields[1]?.accepts).toEqual([...FILE_FAMILIES]);
  });
});
