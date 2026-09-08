/**
 * The message of an unknown error value. A leaf with no imports, so every layer can reach it and
 * nothing can cycle through it — which is why the four copies of this line had no shared home.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compile-time exhaustiveness guard: reached only if a union case is unhandled. `subject` names
 * the union in the message, which is all the four copies of this ever differed on.
 */
export function assertNever(value: never, subject: string): never {
  throw new Error(`Unhandled ${subject}: ${String(value)}`);
}
