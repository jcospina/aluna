import { z } from "zod";

import { RECORD_NOT_FOUND_ERROR_CODE } from "../../../capability-data/index.ts";
import { capabilityToolSchema, MAX_BEHAVIORAL_ERRORS } from "../../../registry/index.ts";
import {
  behavioralExpectedErrorBaseSchema,
  behavioralInputValueSchema,
  behavioralRowSchema,
  nonEmptyStringSchema,
} from "./gate-behavioral-shared.ts";

/**
 * An admissible spec may own all eight authored behavioral errors on one Action. Update
 * and delete also require one normal and one platform record_not_found case, so ten is the
 * smallest cap that preserves the registry's full admitted spec space.
 */
export const MAX_BEHAVIORAL_CASES_PER_ACTION = MAX_BEHAVIORAL_ERRORS + 2;

const platformRecordNotFoundSchema = z.strictObject({
  action: z.enum(["update", "delete"]),
  code: z.literal(RECORD_NOT_FOUND_ERROR_CODE),
});

const fullBehavioralTestCaseSchema = z.strictObject({
  action: capabilityToolSchema,
  name: nonEmptyStringSchema,
  setupRows: z.array(behavioralRowSchema),
  target: z.enum(["first_setup_row", "missing_record"]).nullable(),
  input: z.array(behavioralInputValueSchema),
  expectedRows: z.array(behavioralRowSchema),
  expectedRowCount: z.number().int().nonnegative(),
  expectFragmentIncludes: z.array(nonEmptyStringSchema),
  expectFragmentExcludes: z.array(nonEmptyStringSchema),
  expectFragmentIncludesInOrder: z.array(nonEmptyStringSchema),
  expectedError: behavioralExpectedErrorBaseSchema.nullable(),
  expectedPlatformError: platformRecordNotFoundSchema.nullable(),
});

/**
 * One Action's generated cases. Decision 23 generates each Action independently, so the
 * model is asked for — and bounded to — a single Action's suite per call: a normal case,
 * that Action's authored error cases, and its platform record_not_found case when it owns
 * one. The cap is per Action rather than per capability, which is why it is far below the
 * old whole-capability ceiling.
 */
export const actionBehavioralTestSuiteSchema = z.strictObject({
  cases: z.array(fullBehavioralTestCaseSchema).min(1).max(MAX_BEHAVIORAL_CASES_PER_ACTION),
});

/**
 * One Action's frozen tests, content-addressed to the exact closed inputs they were
 * generated from (4.7/01). The digest is what later builds compare: equal digests mean
 * the Action's total inputs did not change, so its frozen cases carry forward untouched.
 */
export const frozenActionTestsSchema = z.strictObject({
  action: capabilityToolSchema,
  input_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  cases: z.array(fullBehavioralTestCaseSchema).min(1).max(MAX_BEHAVIORAL_CASES_PER_ACTION),
});

/**
 * The frozen behavioral intent for one capability version — the artifact published at
 * `tests/behavioral.json` and digested into `snapshot.json`. Frozen before any Handler
 * generation or repair begins, so no Handler byte can ever have informed it (ADR-0006).
 */
export const frozenBehavioralTestsSchema = z.strictObject({
  actions: z.array(frozenActionTestsSchema).min(1).max(5),
});

export type FullBehavioralTestCase = z.infer<typeof fullBehavioralTestCaseSchema>;
export type ActionBehavioralTestSuite = z.infer<typeof actionBehavioralTestSuiteSchema>;
export type FrozenActionTests = z.infer<typeof frozenActionTestsSchema>;
export type FrozenBehavioralTests = z.infer<typeof frozenBehavioralTestsSchema>;

/** The frozen suite as one executable case list, in canonical Action order. */
export function frozenBehavioralTestCases(
  frozen: FrozenBehavioralTests,
): readonly FullBehavioralTestCase[] {
  return frozen.actions.flatMap((entry) => entry.cases);
}
