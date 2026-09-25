import { type SubmittedFiles, submittedFileProjection } from "../data/index.ts";
import type { CapabilityInput, CapabilitySaveInput, CapabilitySaveInputValue } from "./contract.ts";

/** A Handler's input, with each submitted file field's wire value replaced by its projection. */
export function withFileProjections(
  input: CapabilityInput,
  files: SubmittedFiles,
): CapabilitySaveInput {
  const values: Record<string, CapabilitySaveInputValue> = { ...input.values };
  for (const [field, file] of files) values[field] = submittedFileProjection(file);
  return { values: Object.freeze(values), submittedFields: input.submittedFields };
}
