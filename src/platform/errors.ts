/**
 * The message of an unknown error value. A leaf with no imports, so every layer can reach it and
 * nothing can cycle through it — which is why the four copies of this line had no shared home.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a `console.error` is handed beside its own sentence. An `Error` becomes its message, and
 * anything else crosses whole, so a thrown object still prints as itself rather than as the
 * `[object Object]` {@link errorMessage} would make of it. The sixteen copies of this line differed
 * on nothing.
 */
export function errorDetail(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

/**
 * Compile-time exhaustiveness guard: reached only if a union case is unhandled. `subject` names
 * the union in the message, which is all the four copies of this ever differed on.
 */
export function assertNever(value: never, subject: string): never {
  throw new Error(`Unhandled ${subject}: ${String(value)}`);
}
