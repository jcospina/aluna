import { assertNever } from "../../platform/errors.ts";
import type { ListInputMode, UiFormIntent } from "../../registry/index.ts";

/**
 * Resolve the closed authored mode for one active list field. Validated specs always contain the
 * entry, so a hand-built render projection that dropped form intent fails loudly.
 */
export function listInputModeForField(form: UiFormIntent, fieldName: string): ListInputMode {
  const entry = form.list_inputs.find((candidate) => candidate.field === fieldName);
  if (!entry) throw new Error(`Missing list input mode for active field "${fieldName}".`);
  return entry.mode;
}

/**
 * Normalize the raw form representation before generated Handler code runs. Repeatable controls
 * drop blank rows; comma-separated ones flatten, trim and drop empty segments. Order is kept.
 */
export function normalizeListInputValues(
  mode: ListInputMode,
  repeated: readonly string[],
): readonly string[] {
  switch (mode) {
    case "repeatable":
      return repeated.filter((value) => value.trim().length > 0);
    case "comma_separated":
      return repeated.flatMap((raw) =>
        raw
          .split(",")
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0),
      );
    default:
      return assertNever(mode, "list input mode");
  }
}
