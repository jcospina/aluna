/** `value` as a regular expression matching exactly it, every metacharacter escaped. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
