import type { ListInputMode, UiFormIntent } from "../registry/index.ts";

/**
 * Resolve the closed authored mode for one active list field. Validated specs
 * always contain the entry; hand-built render projections fail loudly if they
 * dropped form intent between the registry and the platform module.
 */
export function listInputModeForField(form: UiFormIntent, fieldName: string): ListInputMode {
  const entry = form.list_inputs.find((candidate) => candidate.field === fieldName);
  if (!entry) throw new Error(`Missing list input mode for active field "${fieldName}".`);
  return entry.mode;
}

/**
 * Normalize the raw form representation before generated Handler code runs.
 * Repeatable controls preserve each occurrence exactly. Comma-separated controls
 * flatten every occurrence, trim segment boundaries, and discard empty segments;
 * order and duplicates remain untouched.
 */
export function normalizeListInputValues(
  mode: ListInputMode,
  repeated: readonly string[],
): readonly string[] {
  switch (mode) {
    case "repeatable":
      return [...repeated];
    case "comma_separated":
      return repeated.flatMap((raw) =>
        raw
          .split(",")
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0),
      );
    default:
      return assertNever(mode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled list input mode: ${String(value)}`);
}
