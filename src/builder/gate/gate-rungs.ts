// The Gate's rung vocabulary, alone in a module that imports nothing.
//
// The metrics schema needs these as runtime values to build its enums, and metrics sits below the
// builder. Importing them from `gate.ts` would close a cycle through the builder barrel, so the
// two names both sides need live here instead of being restated on each side of the boundary.

/** The rungs, in the order the Gate runs and reports them. Publication verifies this sequence. */
export const GATE_RUNG_ORDER = ["structural", "smoke", "behavioral", "design-lint"] as const;

export const GATE_RUNG_STATUSES = ["passed", "failed", "skipped"] as const;

export type GateRungName = (typeof GATE_RUNG_ORDER)[number];
export type GateRungStatus = (typeof GATE_RUNG_STATUSES)[number];
