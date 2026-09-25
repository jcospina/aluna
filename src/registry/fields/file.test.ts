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
  fieldTypeSchema,
  getCapability,
  insertCapability,
  isSearchableTextType,
  promptCapabilitySpecSchema,
  type SpecField,
} from "../index.ts";
import { CAPTION_FIELD, orderings, PHOTO_FIELD, photoSpec } from "./file.test-support.ts";
import { familiesSchema } from "./file.ts";

/** Where a refused spec was refused; the sentence is the schema's own, so it is not restated. */
function refusedAt(value: unknown): string[] {
  const parsed = capabilitySpecSchema.safeParse(value);
  if (parsed.success) throw new Error("expected the spec to be refused");
  return parsed.error.issues.map((issue) => issue.path.join("."));
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
    expect(refusedAt(spec)).toContain("ui_intent.form.list_inputs.0.field");
  });
});

describe("accepts fails closed", () => {
  test("on a field that is not a file field", () => {
    const spec = photoSpec([{ ...CAPTION_FIELD, accepts: ["image"] }, PHOTO_FIELD]);
    expect(refusedAt(spec)).toEqual(["schema.fields.0.accepts"]);
  });

  test("when a file field leaves it out", () => {
    const { accepts: _omitted, ...bare } = PHOTO_FIELD;
    const spec = photoSpec([CAPTION_FIELD, bare as SpecField]);
    expect(refusedAt(spec)).toEqual(["schema.fields.1.accepts"]);
  });

  test("when it is null, empty, repeats a family, or names one outside the enum", () => {
    for (const accepts of [null, [], [...FILE_FAMILIES, ...FILE_FAMILIES]]) {
      expect(refusedAt(withPhoto({ accepts }))).toEqual(["schema.fields.1.accepts"]);
    }
    for (const family of ["video", "pdf", "IMAGE", ""]) {
      expect(refusedAt(withPhoto({ accepts: [family] }))).toEqual(["schema.fields.1.accepts.0"]);
    }
  });
});

describe("accepts is stored in canonical order", () => {
  // Longer than `FILE_FAMILIES`, which one family cannot reorder.
  const ORDER = ["image", "video", "audio", "document"] as const;

  test("every ordering of every selection parses to the order's own sequence", () => {
    const schema = familiesSchema(ORDER);
    for (const authored of orderings(ORDER)) {
      expect(schema.parse(authored)).toEqual(ORDER.filter((family) => authored.includes(family)));
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

  test("offers every field type", () => {
    const field = fieldSchemaOf() as { properties: { type: { enum: string[] } } };
    expect(field.properties.type.enum).toEqual([...fieldTypeSchema.options]);
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
