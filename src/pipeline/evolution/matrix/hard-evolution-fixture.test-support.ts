// Test support for the bounded-repair battery (`evolution-frozen-repair.test.ts`). Not a test
// file itself; bun never runs it, and no composition root can reach it.
//
// The repair story is the hardest part of the Gate to prove, and prompting for a real behavioral
// failure is a coin flip. Through the `firstPassHandlerFixture` seam the first pass writes an
// `update` Handler that accepts a blank required field — clean through smoke, contradicting the
// frozen case that says blanking a required field must emit `missing_required_fields`.
//
// What happens next is not staged. The platform mutation port rejects the blank field inside the
// Handler call, so the failure is attributed totally to `update` however large the evolution is,
// which lets the battery pin bounded repair rather than an accidental five-Handler rewrite.
//
// The fixture only ever replaces one first-pass Handler — never a test, never a repair.

import type { GeneratedUnitName } from "../../../builder/index.ts";
import { activeSpecFields, type CapabilitySpec } from "../../../registry/index.ts";

/**
 * The first-pass bytes for one unit, or `undefined` to keep the provider's. Only `update` is
 * substituted: its frozen error case is the one smoke does not also catch a rung earlier.
 */
export function hardEvolutionHandlerFixture(
  spec: CapabilitySpec,
  unit: GeneratedUnitName,
): string | undefined {
  if (unit !== "update") return undefined;
  // With no active required field this Handler contradicts nothing, and the seam may manufacture
  // a known failure but never merely replace healthy provider bytes.
  if (!activeSpecFields(spec.schema.fields).some((field) => field.required)) return undefined;
  return permissiveUpdateHandler(spec);
}

/**
 * An `update` Handler that writes every submitted active field and validates none. Derived from
 * the candidate spec, so the one thing it gets wrong is the one the frozen suite will catch.
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
