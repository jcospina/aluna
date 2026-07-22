// Shared generation-measurement vocabulary. Both the historical terminal metrics
// store and the durable admitted-build lifecycle use these exact validated shapes;
// keeping them here prevents either persistence adapter from redefining the contract.

import { z } from "zod";

import type { GateRungName, GateRungStatus } from "../builder/index.ts";

export const FAILURE_STAGES = [
  "spec_gen",
  "migration",
  "unit_generation",
  "gate",
  "publication",
  "activation",
  "commit",
] as const;
export const failureStageSchema = z.enum(FAILURE_STAGES);
export type FailureStage = z.infer<typeof failureStageSchema>;

const GATE_RUNG_NAMES = [
  "structural",
  "smoke",
  "behavioral",
  "design-lint",
] as const satisfies readonly GateRungName[];

type ListedRungName = (typeof GATE_RUNG_NAMES)[number];
const assertAllRungNames: (name: GateRungName) => ListedRungName = (name) => name;
void assertAllRungNames;

const GATE_RUNG_STATUSES = [
  "passed",
  "failed",
  "skipped",
] as const satisfies readonly GateRungStatus[];
const gateRungNameSchema = z.enum(GATE_RUNG_NAMES);
const gateRungStatusSchema = z.enum(GATE_RUNG_STATUSES);

export const gateRungOutcomeSchema = z.strictObject({
  rung: gateRungNameSchema,
  status: gateRungStatusSchema,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  reason: z.string().optional(),
});

export const tokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export const unitAttemptSummarySchema = z.strictObject({
  kind: z.enum(["handler", "item-renderer"]),
  name: z.string().min(1),
  attempts: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  usage: tokenUsageSchema,
});
export type UnitAttemptSummary = z.infer<typeof unitAttemptSummarySchema>;

export const generationFailureSchema = z.strictObject({
  stage: failureStageSchema,
  rung: gateRungNameSchema.optional(),
  message: z.string().optional(),
});
export type GenerationFailure = z.infer<typeof generationFailureSchema>;
