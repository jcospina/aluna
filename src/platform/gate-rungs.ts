// The Gate's rung vocabulary, alone in a module that imports nothing.
//
// The metrics schema needs these as runtime values to build its enums, and metrics sits below the
// builder. So the shared name lives in the lower layer, the way `errors.ts` and `table-names.ts`
// do: `gate.ts` re-exports it, and nothing under `src/platform/` reaches up for a value.

/** The rungs, in the order the Gate runs and reports them. Publication verifies this sequence. */
export const GATE_RUNG_ORDER = ["structural", "smoke", "behavioral", "design-lint"] as const;

export const GATE_RUNG_STATUSES = ["passed", "failed", "skipped"] as const;

export type GateRungName = (typeof GATE_RUNG_ORDER)[number];
export type GateRungStatus = (typeof GATE_RUNG_STATUSES)[number];
