import {
  CHOICE_DISABLED_ERROR_CODE,
  INVALID_CHOICE_ERROR_CODE,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../registry/index.ts";

// The platform's typed data-validation failures. The base class and the three structural refusals
// live together so the router has one place to read the mutation contract from.

export class CapabilityDataValidationError extends Error {
  override readonly name: string = "CapabilityDataValidationError";
}

export class MissingRequiredFieldsError extends CapabilityDataValidationError {
  override readonly name = "MissingRequiredFieldsError";
  readonly action: "create" | "update";
  readonly code = MISSING_REQUIRED_FIELDS_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(
    capabilityId: string,
    fields: readonly string[],
    action: "create" | "update" = "create",
  ) {
    super(`Missing required fields for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}

/**
 * A *newly chosen* disabled option, refused before canonical state moves. Its own code rather than
 * {@link InvalidChoiceError}: what is refused is arriving at the option, not carrying it.
 */
export class ChoiceDisabledError extends CapabilityDataValidationError {
  override readonly name = "ChoiceDisabledError";
  readonly action: "create" | "update";
  readonly code = CHOICE_DISABLED_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(
    capabilityId: string,
    fields: readonly string[],
    action: "create" | "update" = "create",
  ) {
    super(`Disabled choice value for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}

/**
 * A submitted value outside a choice field's declared options, refused before canonical state
 * moves. Carries its fields like {@link MissingRequiredFieldsError}, so the router can relocate it.
 */
export class InvalidChoiceError extends CapabilityDataValidationError {
  override readonly name = "InvalidChoiceError";
  readonly action: "create" | "update";
  readonly code = INVALID_CHOICE_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(
    capabilityId: string,
    fields: readonly string[],
    action: "create" | "update" = "create",
  ) {
    super(`Undeclared choice value for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}

/**
 * A submitted string longer than its field's declared `max_length`. The native attribute already
 * stops the typing, so reaching this is a crafted request rather than a filled-in form.
 */
export class MaxLengthExceededError extends CapabilityDataValidationError {
  override readonly name = "MaxLengthExceededError";
  readonly action: "create" | "update";
  readonly code = MAX_LENGTH_EXCEEDED_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(
    capabilityId: string,
    fields: readonly string[],
    action: "create" | "update" = "create",
  ) {
    super(`Over-length value for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}
