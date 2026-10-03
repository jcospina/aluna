// What both builder prompts say about a file field (Module 7 PLAN decisions 5, 18 and 36): when to
// declare one or a list of them, which families it accepts and that search never reads it, and,
// for a new capability only, that its card shows it.

import { FILE_FAMILIES } from "../../registry/index.ts";

/** The pantry lines the spec prompt and the candidate prompt both carry for a file field. */
export const FILE_FIELD_PROMPT_LINES: readonly string[] = [
  `- a file field holds one file a person adds from their device: a picture, such as a photo, a cover or a scan, a video, such as a clip of a first step, a sound, such as a voice memo or a song, or a document, such as a manual, a receipt or a lease. Declare one when the capability holds pictures, videos, sounds or documents because the person asked to keep them, and never add one nobody asked for. A file field declares accepts, the families it takes from ${JSON.stringify(FILE_FAMILIES)}: "image" for pictures, "video" for videos, "audio" for sounds, "document" for documents. Name only the families the person's files come in, read from what they said they keep: a garden journal that keeps photos of its plants accepts ["image"], a dance class log that keeps a clip of each routine accepts ["video"], and a podcast archive that keeps episodes and show notes takes "audio" for the episodes and "document" for the notes. Name more than one family on one field only when that one file may truly be either, such as a moment kept as a photo or a clip; never name every family because it seems safe. Every other field sends accepts as null.`,
  "- a file[] field holds several files of those families in the order a person adds them, such as the photos of one trip or the manuals of one appliance. Declare file[] when one record keeps more than one file, and file when it keeps one: a field never changes between the two later. A file[] field declares accepts as a file field does, and it is not a list input, so it never appears in list_inputs.",
  "- search never reads a file field: its only text is a file name like IMG_4821.JPG. A capability that holds pictures, videos, sounds or documents and wants to find them by words also gets a string field, such as a title or a caption, that a person fills in.",
];

/** The spec prompt's line on showing a new capability's files; an evolution changes only what it is asked to. */
export const FILE_FIELD_CARD_LINE =
  "- a file the person asked to keep is what their record looks like, so name its file field in ui_intent.item.shows: the card draws a photo or a video and names a sound or a document. A capability that keeps files and shows none of them on its cards hides the very thing it was built to hold.";
