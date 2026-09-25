// The Diff's fail-closed backstop: after every change fact has been accounted for, what is
// left of the two specs must be identical. A future admitted fact without a matrix row, or
// an immutable region validation should have frozen, throws here rather than becoming a
// silent no-op or an unproven copy.

import { canonicalizeJson, compareStrings } from "../../../platform/canonical-json.ts";
import type { CapabilitySpec, SpecField } from "../../../registry/index.ts";

/**
 * The fail-closed guard: a committed→candidate difference the matrix does not map. It carries
 * both residuals, so the build-error preview shows exactly what could not be explained.
 */
export class UnmappedChangeFactError extends Error {
  override readonly name = "UnmappedChangeFactError";
  readonly diagnostic: { readonly committedResidual: unknown; readonly candidateResidual: unknown };

  constructor(committedResidual: unknown, candidateResidual: unknown) {
    super(
      "Unmapped evolution difference: the candidate differs from the committed spec in a " +
        "region no change-fact row covers; failing closed before publication.",
    );
    this.diagnostic = { committedResidual, candidateResidual };
  }
}

// ── Totality: fail closed on the unexplained ────────────────────────────────

// A control-character sentinel standing in for every region a change fact covers. What is left
// un-neutralized — the immutable invariants, and any unmatrixed future key — must be identical.
const RESIDUAL_SENTINEL = "\u0000diff-covered\u0000";

export function assertTotalCoverage(committed: CapabilitySpec, candidate: CapabilitySpec): void {
  const committedNames = new Set(committed.schema.fields.map((field) => field.name));
  const committedResidual = residualProjection(committed, committedNames);
  const candidateResidual = residualProjection(candidate, committedNames);
  // Both residuals are deeply key-sorted, so stringify is an order-stable deep-equal.
  if (JSON.stringify(committedResidual) !== JSON.stringify(candidateResidual)) {
    throw new UnmappedChangeFactError(committedResidual, candidateResidual);
  }
}

// Reduce a spec to what no change fact explains: canonicalize, then blank every fact-bearing
// region. A new admitted top-level key survives here, so an unextended matrix fails closed.
function residualProjection(spec: CapabilitySpec, committedNames: ReadonlySet<string>): unknown {
  const canonical = canonicalizeJson(spec) as Record<string, unknown>;
  canonical.label = RESIDUAL_SENTINEL;
  canonical.noun = RESIDUAL_SENTINEL;
  canonical.plural_noun = RESIDUAL_SENTINEL;
  canonical.prompt_context = RESIDUAL_SENTINEL;
  canonical.behavior = RESIDUAL_SENTINEL;
  canonical.behavioral_errors = RESIDUAL_SENTINEL;
  canonical.read_dependencies = RESIDUAL_SENTINEL;
  canonical.ui_intent = RESIDUAL_SENTINEL;
  canonical.schema = {
    fields: spec.schema.fields
      .filter((field) => committedNames.has(field.name))
      .map((field): Record<string, unknown> => blankedField(field))
      .sort((left, right) => compareStrings(String(left.name), String(right.name))),
  };
  return canonical;
}

/**
 * One committed field with every fact-bearing key blanked. Re-canonicalized *after* the
 * blanking: an added key would otherwise land last, and stringify differently for no reason.
 */
function blankedField(field: SpecField): Record<string, unknown> {
  return canonicalizeJson({
    ...field,
    label: RESIDUAL_SENTINEL,
    required: RESIDUAL_SENTINEL,
    lifecycle: RESIDUAL_SENTINEL,
    // Blanked unconditionally, unlike the choice collections below: the `max_length` fact
    // covers the key arriving and going away, and blanking only what is there would not.
    max_length: RESIDUAL_SENTINEL,
    // The six option facts explain these regions, so both blank wholesale. A key added to the
    // option shape without a row is still caught: no detector reads it, so it moves nothing.
    ...(field.values === undefined ? {} : { values: RESIDUAL_SENTINEL }),
    ...(field.groups === undefined ? {} : { groups: RESIDUAL_SENTINEL }),
  }) as Record<string, unknown>;
}
