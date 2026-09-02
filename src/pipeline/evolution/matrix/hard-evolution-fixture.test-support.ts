// Test support for the bounded-repair battery (`evolution-frozen-repair.test.ts`).
// Not a test file itself; bun never runs it, and no composition root can reach it.
//
// The repair story is the hardest part of the Gate to *prove*: on a healthy build it never
// happens, and manufacturing a real behavioral failure by prompting for one is a coin
// flip. So this fixture manufactures one deterministically. Injected through the
// `firstPassHandlerFixture` seam, the first pass writes an `update` Handler that quietly
// accepts a blank required field — structurally sound, clean through the platform smoke
// round-trip, and in direct contradiction with the frozen case that says blanking a
// required field must emit `missing_required_fields`.
//
// What happens next is not staged. The blank field is rejected by the platform mutation
// port *inside* the Handler call, so the failure is attributed totally to `update` however
// large the surrounding evolution is — the battery pins the bounded repair, not an
// accidental five-Handler rewrite. The Gate then asks the provider to rewrite that one
// Handler against the frozen assertion and reruns the same frozen bytes.
//
// The fixture only ever replaces one first-pass Handler — never a test, and never a repair
// regeneration.

import type { GeneratedUnitName } from "../../../builder/index.ts";
import { activeSpecFields, type CapabilitySpec } from "../../../registry/index.ts";

/**
 * The first-pass bytes for one unit, or `undefined` to keep what the provider wrote. Only
 * `update` is substituted: it is the one Action whose frozen error case the always-on smoke
 * fixture does not also cover, so the failure this fixture creates reaches the behavioral
 * rung as a genuine first failure rather than being caught a rung earlier.
 */
export function hardEvolutionHandlerFixture(
  spec: CapabilitySpec,
  unit: GeneratedUnitName,
): string | undefined {
  if (unit !== "update") return undefined;
  // With no active required field, this Handler would not contradict the candidate's
  // frozen validation contract. Returning nothing keeps the injection seam honest: it may
  // manufacture a known failure, never merely replace healthy provider bytes.
  if (!activeSpecFields(spec.schema.fields).some((field) => field.required)) return undefined;
  return permissiveUpdateHandler(spec);
}

/**
 * An `update` Handler that writes every submitted active field and validates none of them.
 * Derived from the candidate spec so it type-checks and round-trips for any shape the
 * evolution produced — the single thing it gets wrong is the one the frozen suite is about
 * to catch it on.
 */
function permissiveUpdateHandler(spec: CapabilitySpec): string {
  const lines = [
    "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
    "  const patch: Record<string, unknown> = {};",
  ];
  for (const field of activeSpecFields(spec.schema.fields)) {
    const name = field.name;
    if (field.type === "boolean") {
      lines.push(
        `  if (input.submittedFields.has("${name}")) patch.${name} = input.values.${name} === "on" || input.values.${name} === "true";`,
      );
    } else if (field.type === "string[]") {
      lines.push(
        `  if ("${name}" in input.values) { const value = input.values.${name}; patch.${name} = Array.isArray(value) ? [...value] : value; }`,
      );
    } else {
      lines.push(`  if ("${name}" in input.values) patch.${name} = input.values.${name};`);
    }
  }
  lines.push("  return present(mutation.update(patch));", "}");
  return lines.join("\n");
}
