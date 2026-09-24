// The builder's own refusal of a field type it does not offer the model. The provider schema's
// type enum already keeps one out (`GENERATION_FIELD_TYPES`); this holds against a lax provider,
// until 7.1/06 offers `file` and the list matches the pantry.

import { fieldTypeSchema, GENERATION_FIELD_TYPES } from "../../registry/index.ts";

export interface UnofferedFieldTypeIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Every field whose type the builder does not offer, read from the spec as it arrived rather than
 * from a parsed one, so a refusal names it even beside a shape error.
 */
export function unofferedFieldTypeIssues(authored: unknown): readonly UnofferedFieldTypeIssue[] {
  return authoredFields(authored).flatMap((field) => {
    const type = fieldTypeSchema.safeParse(field.type);
    if (!type.success || (GENERATION_FIELD_TYPES as readonly string[]).includes(type.data)) {
      return [];
    }
    const name = String(field.name);
    return [
      {
        path: `schema.fields.${name}.type`,
        message: `field "${name}" is a ${type.data} field, which the builder does not offer yet`,
      },
    ];
  });
}

function authoredFields(authored: unknown): readonly Record<string, unknown>[] {
  const schema = isRecord(authored) ? authored.schema : undefined;
  const fields = isRecord(schema) ? schema.fields : undefined;
  return Array.isArray(fields) ? fields.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
