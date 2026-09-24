// What a Handler may declare a projected column to be. A leaf over the registry's spec and file
// modules, never its index: the index reaches the store, and the store opens the database, which
// the generated-code checker must not do just to read a list of type names.

import { type FileFieldType, isFileFieldType } from "../../registry/fields/file.ts";
import { type FieldType, fieldTypeSchema } from "../../registry/spec/spec.ts";

/**
 * Every pantry type but a file: what reading a file column yields is the save's to define
 * (7.1/04), so until then declaring one is refused rather than guessed.
 */
export type CapabilityQueryResultType = Exclude<FieldType, FileFieldType>;
export const QUERY_RESULT_TYPES = fieldTypeSchema.options.filter(
  (type): type is CapabilityQueryResultType => !isFileFieldType(type),
);
