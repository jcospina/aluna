import {
  CHOICE_DISABLED_ERROR_CODE,
  INVALID_CHOICE_ERROR_CODE,
  INVALID_FILE_REFERENCE_ERROR_CODE,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  RECORD_CHANGED_ERROR_CODE,
  RECORD_NOT_FOUND_ERROR_CODE,
} from "../../registry/index.ts";

// The platform's typed data-validation failures. The base class and the structural refusals live
// together so the router has one place to read the mutation contract from.

export class CapabilityDataValidationError extends Error {
  override readonly name: string = "CapabilityDataValidationError";
}

/**
 * A write to a file field from anything but the platform's own save. No control submits one, so
 * it is not a refusal a person can act on: it carries no code and answers as a failure.
 */
export class FileFieldWriteError extends CapabilityDataValidationError {
  override readonly name = "FileFieldWriteError";

  constructor(field: string) {
    super(`Field "${field}" holds a file reference, which only the platform writes.`);
  }
}

export { RECORD_NOT_FOUND_ERROR_CODE };

export class RecordNotFoundError extends CapabilityDataValidationError {
  override readonly name = "RecordNotFoundError";
  readonly code = RECORD_NOT_FOUND_ERROR_CODE;

  constructor(
    readonly capabilityId: string,
    readonly action: "update" | "delete",
  ) {
    super(`Record not found for ${action} in capability "${capabilityId}".`);
  }
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

/** Why a save's file reference was refused: its shape, its absence, whose it is, its kind or its state. */
export type FileReferenceRefusal =
  | "malformed"
  | "unknown"
  | "other_incarnation"
  | "other_field"
  | "not_accepted"
  | "owned"
  | "cleanup_enqueued";

/**
 * A file field naming anything but a pending key minted for this incarnation and field, refused
 * before generated code runs. One code for every reason: each asks the person for the file again.
 */
export class InvalidFileReferenceError extends CapabilityDataValidationError {
  override readonly name = "InvalidFileReferenceError";
  readonly action: "create" | "update";
  readonly code = INVALID_FILE_REFERENCE_ERROR_CODE;
  readonly fields: readonly string[];
  readonly reasons: Readonly<Record<string, FileReferenceRefusal>>;

  constructor(
    capabilityId: string,
    reasons: Readonly<Record<string, FileReferenceRefusal>>,
    action: "create" | "update",
  ) {
    const fields = Object.keys(reasons);
    super(`Refused file reference for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = fields;
    this.reasons = Object.freeze({ ...reasons });
  }
}

/**
 * An edit whose file field no longer matches what its record holds, because another window saved
 * the field after this form was drawn. Refused before anything is written, so that save stands.
 */
export class RecordChangedError extends CapabilityDataValidationError {
  override readonly name = "RecordChangedError";
  readonly action = "update";
  readonly code = RECORD_CHANGED_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(capabilityId: string, fields: readonly string[]) {
    super(`Kept file no longer held for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.fields = [...fields];
  }
}
