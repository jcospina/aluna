// The Diff's fail-closed backstop: after every change fact has been accounted for, what is
// left of the two specs must be identical. A future admitted fact without a matrix row, or
// an immutable region validation should have frozen, throws here rather than becoming a
// silent no-op or an unproven copy.

import type { CapabilitySpec, SpecField } from "../../../registry/index.ts";

/**
 * The fail-closed guard: a committed→candidate difference the matrix
 * does not map. It carries the residual JSON of both sides so the shared build-error
 * preview surfaces exactly what could not be explained.
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

// A control-character sentinel that stands in for every region a change fact
// covers. Regions left un-neutralized are the immutable invariants (id, tools,
// each committed field's name/type) plus anything a future spec adds without a
// matrix row — those must be identical, or the difference is unmapped.
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

// Reduce a spec to only what no change fact explains: canonicalize the whole
// value, then blank every fact-bearing region. What survives — id, all three logo birth
// facts (`subject`, `ground`, `companion`), tools, and the committed fields' name/type —
// is the equality the diff cannot manufacture and must never silently ignore.
// A new admitted top-level key survives here too, so an unextended matrix fails closed
// rather than dropping it.
function residualProjection(spec: CapabilitySpec, committedNames: ReadonlySet<string>): unknown {
  const canonical = canonicalize(spec) as Record<string, unknown>;
  canonical.label = RESIDUAL_SENTINEL;
  canonical.noun = RESIDUAL_SENTINEL;
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

// Deep clone with object keys sorted; arrays keep their order (an ordered product
// fact), primitives pass through. This is what makes object-key reordering a no-op
// while preserving ordered facts.
/**
 * One committed field with every fact-bearing key blanked.
 *
 * Re-canonicalized *after* the blanking, not before: a key the projection adds to a field
 * that did not carry it would otherwise land at the end of the object while the same key on
 * a field that did carry it stays in sorted position, and the two would stringify
 * differently for no difference at all.
 */
function blankedField(field: SpecField): Record<string, unknown> {
  return canonicalize({
    ...field,
    label: RESIDUAL_SENTINEL,
    required: RESIDUAL_SENTINEL,
    lifecycle: RESIDUAL_SENTINEL,
    // Blanked unconditionally, unlike the two choice collections beside it: what the
    // `max_length` fact explains includes the key *arriving* and *going away*, so a
    // projection that only blanked a key it found would report adding or removing a limit
    // as an unmapped difference.
    max_length: RESIDUAL_SENTINEL,
    // A choice field's options are explained by the six option facts, and its group
    // declarations by `choice_option_groups`. Both regions blank wholesale: every key
    // inside an option — value, label, note, group, disabled — has a row, and a key added
    // to the option shape without one would still be caught, because the fact detectors
    // read only the keys they know and a new one would move nothing.
    ...(field.values === undefined ? {} : { values: RESIDUAL_SENTINEL }),
    ...(field.groups === undefined ? {} : { groups: RESIDUAL_SENTINEL }),
  }) as Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareStrings(left, right),
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

/** Codepoint order — deliberately locale-independent, unlike `localeCompare`. */
function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
