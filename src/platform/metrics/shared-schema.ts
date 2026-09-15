// Shared generation-measurement vocabulary. Both the historical terminal metrics
// store and the durable admitted-build lifecycle use these exact validated shapes;
// keeping them here prevents either persistence adapter from redefining the contract.

import { z } from "zod";

import { GATE_RUNG_ORDER, GATE_RUNG_STATUSES } from "../gate-rungs.ts";

export const FAILURE_STAGES = [
  "spec_gen",
  "migration",
  "unit_generation",
  "behavioral_test_generation",
  "gate",
  "publication",
  "activation",
  "commit",
] as const;
export const failureStageSchema = z.enum(FAILURE_STAGES);
export type FailureStage = z.infer<typeof failureStageSchema>;

const gateRungNameSchema = z.enum(GATE_RUNG_ORDER);
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
