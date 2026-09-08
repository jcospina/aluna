// The generated-unit sources the suites hand the Gate, written once.
//
// These are fixture *bytes*, not production code: the same escape helper and the same handlers
// were retyped in four files, and a fixture that drifts from its copies proves nothing about
// the copy under test. `few-shot-gallery.ts` holds its own escape helper as prompt text for the
// model; that one is production and keeps its own copy deliberately.

/** The escape helper every fixture renderer closes over. */
export const ESCAPE_HELPER = [
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

/** An item renderer whose body returns `bodyExpr` (an interpolated template). */
export function itemRendererReturning(bodyExpr: string): string {
  return [
    "export default function renderItem(record: Record<string, unknown>): string {",
    '  const text = escapeHtml(record.text ?? "");',
    `  return ${bodyExpr};`,
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");
}

export const ITEM_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  "  const text = escapeHtml(record.text);",
  '  return `<div class="stack"><span class="text-lg text-bold truncate">$' +
    "{text}</span></div>`;",
  "}",
  "",
  ESCAPE_HELPER,
].join("\n");

export const READ_HANDLER = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const notes = query.records({",
  '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "  });",
  '  return notes.map(({ record }) => present(record)).join("");',
  "}",
].join("\n");

export const DELETE_HANDLER = [
  "export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string> {",
  "  mutation.delete();",
  '  return "";',
  "}",
].join("\n");
