// The stable validation-error contract a capability authors, and the platform-owned codes
// it may not. Split out of the spec shape so the contract reads on its own; the spec
// schema runs `validateBehavioralErrors` as one clause of its own semantics.

import { z } from "zod";
import type { CapabilitySpec, SpecField } from "../spec/spec.ts";
import { allUnique, sameOrderedStrings, sqlNameText } from "../spec/spec-text.ts";
import { capabilityToolSchema, FULL_CAPABILITY_TOOLS } from "../tools.ts";
import { CHOICE_DISABLED_ERROR_CODE, INVALID_CHOICE_ERROR_CODE } from "./choice.ts";
import { MAX_LENGTH_EXCEEDED_ERROR_CODE } from "./max-length.ts";

export const MISSING_REQUIRED_FIELDS_ERROR_CODE = "missing_required_fields";
export const MAX_BEHAVIORAL_ERRORS = 8;
export const BEHAVIORAL_ERROR_MARKERS = {
  role_attribute: "data-role",
  role: "error",
  code_attribute: "data-error-code",
  fields_attribute: "data-error-fields",
  fields_separator: " ",
} as const;

export const behavioralErrorMarkersSchema = z.strictObject({
  role_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.role_attribute),
  role: z.literal(BEHAVIORAL_ERROR_MARKERS.role),
  code_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.code_attribute),
  fields_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.fields_attribute),
  fields_separator: z.literal(BEHAVIORAL_ERROR_MARKERS.fields_separator),
});
export type BehavioralErrorMarkers = z.infer<typeof behavioralErrorMarkersSchema>;

const behavioralErrorCaseShape = {
  trigger: sqlNameText,
  code: sqlNameText,
  fields: z.array(sqlNameText).min(1).refine(allUnique, "behavioral error fields must be unique"),
  expected_markers: behavioralErrorMarkersSchema,
};

export const behavioralErrorCaseSchema = z.strictObject({
  action: capabilityToolSchema,
  ...behavioralErrorCaseShape,
});
export type BehavioralErrorCase = z.infer<typeof behavioralErrorCaseSchema>;

export function defaultBehavioralErrorsForSchema(
  schema: CapabilitySpec["schema"],
): BehavioralErrorCase[] {
  const fields = schema.fields
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);
  if (fields.length === 0) return [];

  // The fixed five-Action shape owns a missing_required_fields case on each writing
  // Action that revalidates required fields: create and update.
  const actions = ["create", "update"] as const;
  return actions.map((action) => ({
    action,
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields,
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  }));
}

/**
 * Structural failures the platform raises itself, before any generated Handler runs. A
 * capability may not author them: the one authored platform sentence is already written,
 * and a second copy in `behavioral_errors` would make the contract two contracts.
 */
const PLATFORM_OWNED_ERROR_CODES = [
  "record_not_found",
  INVALID_CHOICE_ERROR_CODE,
  CHOICE_DISABLED_ERROR_CODE,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
] as const;

function validatePlatformOwnedErrorCodes(
  ctx: z.RefinementCtx,
  errorCase: BehavioralErrorCase,
  index: number,
): void {
  for (const platformCode of PLATFORM_OWNED_ERROR_CODES) {
    if (errorCase.trigger !== platformCode && errorCase.code !== platformCode) continue;
    ctx.addIssue({
      code: "custom",
      message: `${platformCode} is platform-owned and must not be authored by a capability`,
      path: ["behavioral_errors", index],
    });
  }
}

export function validateBehavioralErrors(
  spec: Pick<CapabilitySpec, "schema" | "behavioral_errors" | "tools">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const requiredFieldNames = spec.schema.fields
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);

  const seenOwnership = new Set<string>();
  for (const [index, errorCase] of spec.behavioral_errors.entries()) {
    validateBehavioralErrorFields(ctx, fieldsByName, errorCase, index);
    validatePlatformOwnedErrorCodes(ctx, errorCase, index);
    if (!spec.tools.includes(errorCase.action)) {
      ctx.addIssue({
        code: "custom",
        message: `behavioral error Action "${errorCase.action}" is not present in tools`,
        path: ["behavioral_errors", index, "action"],
      });
    }
    const ownership = `${errorCase.action}\u0000${errorCase.trigger}\u0000${errorCase.code}`;
    if (seenOwnership.has(ownership)) {
      ctx.addIssue({
        code: "custom",
        message: "behavioral error Action ownership must be unique per trigger/code",
        path: ["behavioral_errors", index, "action"],
      });
    }
    seenOwnership.add(ownership);
  }

  if (!hasExactRequiredFieldsErrors(spec.behavioral_errors, requiredFieldNames)) {
    ctx.addIssue({
      code: "custom",
      message:
        "behavioral_errors must contain the exact missing_required_fields cases for the admitted Action shape and active required fields",
      path: ["behavioral_errors"],
    });
  }
}

function validateBehavioralErrorFields(
  ctx: z.RefinementCtx,
  fieldsByName: ReadonlyMap<string, SpecField>,
  errorCase: BehavioralErrorCase,
  index: number,
): void {
  for (const fieldName of errorCase.fields) {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      addBehavioralErrorFieldIssue(ctx, index, fieldName, "is not in schema.fields");
      continue;
    }
    if (field.lifecycle !== "active") {
      addBehavioralErrorFieldIssue(ctx, index, fieldName, "must be active");
    }
  }
}

function addBehavioralErrorFieldIssue(
  ctx: z.RefinementCtx,
  index: number,
  fieldName: string,
  reason: string,
): void {
  ctx.addIssue({
    code: "custom",
    message: `behavioral error field "${fieldName}" ${reason}`,
    path: ["behavioral_errors", index, "fields"],
  });
}

export function validateActionShapePair(
  spec: Pick<CapabilitySpec, "tools" | "read_dependencies">,
  ctx: z.RefinementCtx,
): void {
  const dependencyKeys = Object.keys(spec.read_dependencies);
  if (!sameOrderedStrings(dependencyKeys, FULL_CAPABILITY_TOOLS)) {
    ctx.addIssue({
      code: "custom",
      message: "tools and read_dependencies must be the complete fixed five-Action shape",
      path: ["read_dependencies"],
    });
  }
}

function hasExactRequiredFieldsErrors(
  errorCases: readonly BehavioralErrorCase[],
  requiredFieldNames: readonly string[],
): boolean {
  const requiredCases = errorCases.filter(
    (errorCase) =>
      errorCase.trigger === MISSING_REQUIRED_FIELDS_ERROR_CODE ||
      errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE,
  );
  if (requiredFieldNames.length === 0) return requiredCases.length === 0;
  // The writing Actions that revalidate required fields, in canonical order.
  const expectedActions = ["create", "update"] as const;
  return (
    requiredCases.length === expectedActions.length &&
    requiredCases.every(
      (errorCase, index) =>
        errorCase.action === expectedActions[index] &&
        errorCase.trigger === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
        errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
        sameOrderedStrings(errorCase.fields, requiredFieldNames),
    )
  );
}
