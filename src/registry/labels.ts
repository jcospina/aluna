import { isCapabilityNameLabel } from "#shell/capability-name.js";

// The rename editor reads a name with this same function, so the two answers cannot drift apart.
export { isCapabilityNameLabel, MAX_CAPABILITY_LABEL_CHARS } from "#shell/capability-name.js";

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
