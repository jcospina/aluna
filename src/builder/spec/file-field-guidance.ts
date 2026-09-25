// What both builder prompts say about a file field (Module 7 PLAN decision 36): when to declare
// one, what it accepts, and that search never reads it.

import { FILE_FAMILIES } from "../../registry/index.ts";

/** The pantry lines the spec prompt and the candidate prompt both carry for a file field. */
export const FILE_FIELD_PROMPT_LINES: readonly string[] = [
  `- a file field holds one picture a person adds from their device, such as a photo, a cover or a scan. Declare one when the capability holds pictures because the person asked to keep them, and never add one nobody asked for. A file field declares accepts: ${JSON.stringify(FILE_FAMILIES)}; every other field sends accepts as null.`,
  "- search never reads a file field: its only text is a file name like IMG_4821.JPG. A capability that holds pictures and wants to find them by words also gets a string field, such as a title or a caption, that a person fills in.",
];
