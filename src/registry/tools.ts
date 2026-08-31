// The fixed Action inventory every capability is born with, and the read dependencies each
// Action declares. Split from the spec shape so the per-contract modules built on top of
// it (behavioral errors, choice) can reach the Action vocabulary without importing the
// whole spec.

import { z } from "zod";

import { incarnationIdSchema } from "./identifiers.ts";
import { sameOrderedStrings, sqlNameText } from "./spec-text.ts";

/**
 * From the 4.4 steady-state cutover the five Actions are mandatory and fixed
 * every capability is born with the complete ordered inventory and
 * no evolution can drop one. There is no longer any narrower admitted shape.
 */
export const FULL_CAPABILITY_TOOLS = ["create", "read", "update", "delete", "search"] as const;
export const capabilityToolSchema = z.enum(FULL_CAPABILITY_TOOLS);
export type CapabilityTool = z.infer<typeof capabilityToolSchema>;

// Model this as a homogeneous fixed-length array for provider JSON Schema: OpenAI
// rejects tuple-style positional `items: [...]`. The refinement keeps the authored
// contract narrow — only the exact ordered five-Action value crosses the local hard
// gate — while the emitted wire schema uses one item object.
export const capabilityToolsSchema = z
  .array(capabilityToolSchema)
  .length(FULL_CAPABILITY_TOOLS.length)
  .refine(
    (tools) => sameOrderedStrings(tools, FULL_CAPABILITY_TOOLS),
    `must be exactly [${FULL_CAPABILITY_TOOLS.join(", ")}] in canonical order`,
  );

/**
 * One read-dependency identity: which prior capability incarnation an Action reads.
 */
export const readDependencySchema = z.strictObject({
  capability_id: sqlNameText,
  incarnation_id: incarnationIdSchema,
});
export type ReadDependency = z.infer<typeof readDependencySchema>;

/**
 * One key per fixed Action — the same complete five-Action inventory as `tools`.
 */
export const readDependenciesSchema = z.strictObject({
  create: z.array(readDependencySchema),
  read: z.array(readDependencySchema),
  update: z.array(readDependencySchema),
  delete: z.array(readDependencySchema),
  search: z.array(readDependencySchema),
});
export type ReadDependencies = z.infer<typeof readDependenciesSchema>;
