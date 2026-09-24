// What a person reads when a file is refused: the upload's sentences in the words
// `design/controls.html` settles, and the save's as the router says it. A leaf at runtime: the one
// import is a type.

import type { FileFamily } from "../../registry/fields/file.ts";

/** A key a save may not claim, or an upload whose bytes were taken before it answered. */
export const ADD_FILE_AGAIN_SENTENCE =
  "I can't save that file in this field. Mind adding it here again?";

/** What a field says of a file admission refused, by the family the field takes. */
export const NOT_ADMITTED_SENTENCES = {
  image: "That isn't a photo I can show here. Mind picking a different one?",
} as const satisfies Record<FileFamily, string>;

/** The cap as a person reads it: whole megabytes, as the drawn "500 MB" is, and never rounded up. */
function sizeInWords(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** A file over the cap, whatever its kind. */
export function oversizeSentence(maxFileBytes: number): string {
  return `That's over ${sizeInWords(maxFileBytes)}, more than I can keep in one file. Mind picking a smaller one?`;
}
