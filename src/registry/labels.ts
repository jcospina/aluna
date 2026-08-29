/**
 * The longest a capability name may be. Exported because the inline rename editor caps
 * the field at the same number the validator refuses past — a `maxlength` the person can
 * feel, rather than a refusal they only meet on submit.
 */
export const MAX_CAPABILITY_LABEL_CHARS = 48;
const MAX_CAPABILITY_LABEL_WORDS = 5;
const PRODUCT_VOICE_LABEL_START = /^(?:got it|i.?ll|i will|i.?m|we.?ll|we will|let.?s)\b/i;

export function isCapabilityNameLabel(value: string): boolean {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_CAPABILITY_LABEL_CHARS) return false;
  if (/[.!?]/.test(label)) return false;
  if (PRODUCT_VOICE_LABEL_START.test(label)) return false;
  return label.split(/\s+/).length <= MAX_CAPABILITY_LABEL_WORDS;
}

/**
 * The name a person reads, before it is checked: what they renamed this capability to,
 * or the label the model authored. One expression of `display_label_override ?? label`,
 * so no display path has to remember the precedence and none of them can disagree.
 *
 * A rename writes only the override. The authored label under it is never touched, which
 * is what keeps every immutable snapshot truthful about what was generated.
 *
 * The field is required rather than optional on purpose. A caller holding a projection of
 * a row — `Pick<CapabilityRow, "id" | "label">` is a shape this codebase already uses —
 * would otherwise compile clean, read the authored label back, and quietly un-rename the
 * capability on whatever surface it feeds. Made to opt in, it cannot.
 */
export function effectiveCapabilityLabel(row: {
  readonly label: string;
  readonly display_label_override: string | null;
}): string {
  return row.display_label_override ?? row.label;
}

/**
 * The effective label, checked. An override arrives through the same validator a
 * generated name does, so a hand-edited row cannot put a paragraph under a tile — and a
 * value that fails falls back the way an unusable authored label already does.
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
