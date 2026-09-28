// What both builder prompts say about a file field (Module 7 PLAN decision 36): when to declare
// one, what it accepts, and that search never reads it.

import { FILE_FAMILIES } from "../../registry/index.ts";

/** The pantry lines the spec prompt and the candidate prompt both carry for a file field. */
export const FILE_FIELD_PROMPT_LINES: readonly string[] = [
  `- a file field holds one file a person adds from their device: a picture, such as a photo, a cover or a scan, or a video, such as a clip of a first step. Declare one when the capability holds pictures or videos because the person asked to keep them, and never add one nobody asked for. A file field declares accepts, the families it takes from ${JSON.stringify(FILE_FAMILIES)}: "image" for pictures, "video" for videos, and both when either will do. Every other field sends accepts as null.`,
  "- search never reads a file field: its only text is a file name like IMG_4821.JPG. A capability that holds pictures or videos and wants to find them by words also gets a string field, such as a title or a caption, that a person fills in.",
];
