export class CapabilityDataValidationError extends Error {
  override readonly name: string = "CapabilityDataValidationError";
}

export function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
