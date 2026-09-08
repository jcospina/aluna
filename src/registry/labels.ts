/**
 * The longest a capability name may be. Exported because the inline rename editor caps
 * the field at the same number the validator refuses past — a `maxlength` the person can
 * feel, rather than a refusal they only meet on submit.
 */
export const MAX_CAPABILITY_LABEL_CHARS = 48;
const MAX_CAPABILITY_LABEL_WORDS = 5;
const PRODUCT_VOICE_LABEL_START = /^(?:got it|i.?ll|i will|i.?m|we.?ll|we will|let.?s)\b/i;

/**
 * `<img src=x onerror=alert(1)>` is three words with no sentence punctuation, so every rule above
 * admits it. Angle brackets only: `&`, an apostrophe and a quote belong to real names.
 */
const MARKUP_SHAPED = /[<>]/;

export function isCapabilityNameLabel(value: string): boolean {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_CAPABILITY_LABEL_CHARS) return false;
  if (/[.!?]/.test(label)) return false;
  // Every sink escapes this label, so this is not what makes it safe. What it refuses is a name
  // that is not a name.
  if (MARKUP_SHAPED.test(label)) return false;
  if (PRODUCT_VOICE_LABEL_START.test(label)) return false;
  return label.split(/\s+/).length <= MAX_CAPABILITY_LABEL_WORDS;
}

/**
 * The one expression of `display_label_override ?? label`, so no display path can disagree. The
 * field is required, or a `Pick<CapabilityRow, "id" | "label">` would compile and un-rename.
 */
export function effectiveCapabilityLabel(row: {
  readonly label: string;
  readonly display_label_override: string | null;
}): string {
  return row.display_label_override ?? row.label;
}

/**
 * The effective label, checked. An override goes through the same validator a generated name does,
 * so a hand-edited row cannot put a paragraph under a tile; a value that fails falls back.
 */
export function canonicalCapabilityLabel(row: {
  readonly id: string;
  readonly label: string;
  readonly display_label_override: string | null;
}): string {
  const label = effectiveCapabilityLabel(row).trim();
  if (isCapabilityNameLabel(label)) return label;
  const authored = row.label.trim();
  return isCapabilityNameLabel(authored) ? authored : titleCaseCapabilityId(row.id);
}

function titleCaseCapabilityId(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
