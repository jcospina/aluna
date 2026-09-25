// The file field type (ADR-0009; `modules/07-files-upload-store-serve/PLAN.md` decisions 5, 18,
// 20 and 36).
//
// A file field's column holds one reference to a file the platform stores, as JSON in TEXT, the
// way `string[]` stores its array. It is a type of its own, not a list type (decision 18).
//
// `accepts` names the families a field takes. It is authored by the model and gated here before
// anything downstream reads it.

import { z } from "zod";

import type { CapabilitySpec, SpecField } from "../spec/spec.ts";
import { allUnique } from "../spec/spec-text.ts";

export const FILE_FIELD_TYPES = ["file"] as const;

/** A save naming a file this field may not claim: platform-owned, like an undeclared choice. */
export const INVALID_FILE_REFERENCE_ERROR_CODE = "invalid_file_reference";
/** An edit whose file field no longer matches what its record holds: it changed in another window. */
export const RECORD_CHANGED_ERROR_CODE = "record_changed";
export type FileFieldType = (typeof FILE_FIELD_TYPES)[number];

export function isFileFieldType(type: string): type is FileFieldType {
  return (FILE_FIELD_TYPES as readonly string[]).includes(type);
}

function isActiveFileField(field: Pick<SpecField, "type" | "lifecycle">): boolean {
  return field.lifecycle === "active" && isFileFieldType(field.type);
}

/** The active fields that hold a file, in spec order. */
export function activeFileFields<Field extends Pick<SpecField, "type" | "lifecycle">>(
  fields: readonly Field[],
): Field[] {
  return fields.filter(isActiveFileField);
}

/** Whether any active field holds a file, so records and inputs can carry its projection. */
export function hasActiveFileField(
  fields: readonly Pick<SpecField, "type" | "lifecycle">[],
): boolean {
  return fields.some(isActiveFileField);
}

/** The families a file field may take, in their canonical order. */
export const FILE_FAMILIES = ["image"] as const;
export type FileFamily = (typeof FILE_FAMILIES)[number];

/**
 * A family list over `order`, handed on in that order whatever order it was authored in, so a
 * candidate that only reorders it makes no evolution fact. Exported so its suite can prove the rule
 * over an order longer than `FILE_FAMILIES`.
 */
export function familiesSchema<const Order extends readonly [string, ...string[]]>(order: Order) {
  return z
    .array(z.enum(order))
    .min(1, "a file field accepts at least one family")
    .refine(allUnique, "a family appears in accepts at most once")
    .transform((families): Order[number][] =>
      order.filter((family) => (families as readonly string[]).includes(family)),
    );
}

export const acceptsSchema = familiesSchema(FILE_FAMILIES);

/** Every file field declares `accepts`, and only a file field does. */
export function validateFileFields(
  spec: Pick<CapabilitySpec, "schema">,
  ctx: z.RefinementCtx,
): void {
  for (const [index, field] of spec.schema.fields.entries()) {
    const path = ["schema", "fields", index, "accepts"];
    if (!isFileFieldType(field.type)) {
      if (field.accepts === undefined) continue;
      ctx.addIssue({ code: "custom", message: "only a file field declares accepts", path });
      continue;
    }
    if (field.accepts === undefined) {
      ctx.addIssue({ code: "custom", message: "a file field must declare what it accepts", path });
    }
  }
}
