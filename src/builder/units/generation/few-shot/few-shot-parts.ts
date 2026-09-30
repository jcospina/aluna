// What the few-shot gallery's exemplars are written with: the escaping helper each renderer
// carries, and the fields its capability declares. A leaf the gallery and its media exemplars share.

import {
  FILE_FAMILIES,
  type FieldType,
  type FileFamily,
  isFileFieldType,
  type SpecField,
} from "../../../../registry/index.ts";

export const ESCAPE_HELPER_SOURCE = [
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

/** A file field takes the families its row names, every family when it names none. */
export function fields(
  rows: readonly (readonly [
    name: string,
    type: FieldType,
    required: boolean,
    accepts?: readonly FileFamily[],
  ])[],
): SpecField[] {
  return rows.map(([name, type, required, accepts = FILE_FAMILIES]) => ({
    name,
    label: name,
    type,
    required,
    lifecycle: "active",
    ...(isFileFieldType(type) ? { accepts: [...accepts] } : {}),
  }));
}
