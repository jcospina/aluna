/** `text` as a whole number when it is decimal digits only; NaN for anything else, "1e3" included. */
export function parseWholeNumber(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}
