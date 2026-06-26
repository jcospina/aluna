const MAX_CAPABILITY_LABEL_CHARS = 48;
const MAX_CAPABILITY_LABEL_WORDS = 5;
const PRODUCT_VOICE_LABEL_START = /^(?:got it|i.?ll|i will|i.?m|we.?ll|we will|let.?s)\b/i;

export function isCapabilityNameLabel(value: string): boolean {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_CAPABILITY_LABEL_CHARS) return false;
  if (/[.!?]/.test(label)) return false;
  if (PRODUCT_VOICE_LABEL_START.test(label)) return false;
  return label.split(/\s+/).length <= MAX_CAPABILITY_LABEL_WORDS;
}

export function canonicalCapabilityLabel(row: {
  readonly id: string;
  readonly label: string;
}): string {
  const label = row.label.trim();
  return isCapabilityNameLabel(label) ? label : titleCaseCapabilityId(row.id);
}

function titleCaseCapabilityId(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
