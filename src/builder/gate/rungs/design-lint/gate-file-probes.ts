// What a design-lint probe holds in a file field, and what the rung says of a card's file fields
// (Module 7 PLAN decision 38). A `file` holds one projection or `null`, and a `file[]` several, or
// `[]`, the empty list a template forgets as often as the empty field.

import { admittedTypes } from "../../../../platform/files/admission/admission.ts";
import type { PresentableRecord } from "../../../../presentation/index.ts";
import {
  type CapabilitySpec,
  type FileFamily,
  isFileFieldType,
  isFileListFieldType,
  type SpecField,
} from "../../../../registry/index.ts";
import { scratchFileProjection } from "../../gate-scratch-files.ts";
import { fileNoun } from "./gate-file-kinds.ts";

/**
 * How many files a probe's `file[]` holds: more than a card drawing the first few as a preview
 * would draw, so one that leaves the rest out is seen.
 */
const LISTED = 7;

/** A probe's file field holding files named `name`: one, or a list of several. */
export function probeFiles(
  spec: CapabilitySpec,
  field: SpecField,
  name: string,
  family?: FileFamily,
  type?: string,
): unknown {
  if (!isFileListFieldType(field.type))
    return scratchFileProjection(spec, field, name, family, type);
  return Array.from({ length: LISTED }, (_, entry) =>
    scratchFileProjection(spec, field, name, family, type, entry),
  );
}

/**
 * Records for each shown list: one file of each family and document type, and shorter lists of
 * every length, the families in turn, so a card that draws a short list and names a long one is read
 * drawing; then, for several families or for documents, a mixed list and a PDF either side of
 * another document type, so a card that draws every file by its first one's kind or type is read
 * drawing the others wrong.
 */
export function mixedLists(
  spec: CapabilitySpec,
  baseline: PresentableRecord,
  name: string,
): { readonly label: string; readonly record: PresentableRecord }[] {
  return shownFileFields(spec)
    .filter((field) => isFileListFieldType(field.type))
    .flatMap((field) => {
      const families = field.accepts ?? [];
      const [pdf, ...others] = admittedTypes("document");
      const list = (entries: readonly [FileFamily, string?][]) => {
        const held = [...new Set(entries.map(([family, type]) => type ?? family))];
        const count = `${entries.length} ${entries.length === 1 ? "file" : "files"}`;
        return {
          label: `synthetic list "${field.name}" (${count}: ${held.join(", ")})`,
          record: {
            ...baseline,
            [field.name]: entries.map(([family, type], entry) =>
              scratchFileProjection(spec, field, name, family, type, entry),
            ),
          },
        };
      };
      const byFamily = Array.from({ length: Math.max(LISTED, families.length) }, (_, entry) => [
        families[entry % families.length] as FileFamily,
      ]) as [FileFamily][];
      const documents = families.includes("document");
      return [
        ...families.map((family) => list([[family]])),
        ...(documents ? others.map((type) => list([["document", type]])) : []),
        ...(families.length > 0
          ? Array.from({ length: LISTED - 2 }, (_, index) => list(byFamily.slice(0, index + 2)))
          : []),
        ...(families.length > 1 ? [list(byFamily)] : []),
        ...(documents && others[0]
          ? [
              list([
                ["document", pdf],
                ["document", others[0]],
                ["document", pdf],
              ]),
            ]
          : []),
      ];
    });
}

/** A file field holding nothing: `null`, or `[]` for a list. */
export function noFiles(field: SpecField): null | readonly never[] {
  return isFileListFieldType(field.type) ? [] : null;
}

/** The files a field's value holds, whichever shape it has. */
function filesIn(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function shownFileFields(spec: CapabilitySpec): SpecField[] {
  return spec.schema.fields.filter(
    (field) => isFileFieldType(field.type) && spec.ui_intent.item.shows.includes(field.name),
  );
}

/** Whether a shown field that may hold a photo or a video holds none: a frame may stand empty. */
export function missesAPicture(spec: CapabilitySpec, record: PresentableRecord): boolean {
  return shownFileFields(spec).some(
    (field) =>
      field.accepts?.some((family) => family === "image" || family === "video") &&
      filesIn(record[field.name]).length === 0,
  );
}

/** What to say of an empty frame: the kinds `record` shows that have no picture, if any. */
export function pictureless(spec: CapabilitySpec, record: PresentableRecord): string {
  const kinds = shownFileFields(spec)
    .flatMap((field) => filesIn(record[field.name]))
    .map((file) => (file as { kind?: unknown } | null)?.kind)
    .filter((kind): kind is string => kind === "audio" || kind === "document");
  const nouns = [...new Set(kinds)].map(fileNoun).join(" or ");
  if (nouns === "")
    return "Frame only a photo or a video, and leave a frame empty only for one the record is missing.";
  return `${nouns[0]?.toUpperCase()}${nouns.slice(1)} has no picture: say in words what the record holds, and draw no frame.`;
}

export function isFileField(spec: CapabilitySpec, name: string): boolean {
  return spec.schema.fields.some((field) => field.name === name && isFileFieldType(field.type));
}
