import { z } from "zod";
import { capabilityToolSchema, MAX_BEHAVIORAL_ERRORS } from "../../../../../registry/index.ts";
import { RECORD_NOT_FOUND_ERROR_CODE } from "../../../../../runtime/data/index.ts";
import {
  behavioralExpectedErrorBaseSchema,
  behavioralInputValueSchema,
  behavioralRowSchema,
  nonEmptyStringSchema,
} from "../gate-behavioral-shared.ts";

/**
 * An admissible spec may own all eight authored behavioral errors on one Action, and update and
 * delete also require a normal and a record_not_found case, so ten is the smallest cap.
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
 * One Action's generated cases: decision 23 asks for a single Action's suite per call. The cap
 * is per Action rather than per capability, so it sits far below the whole-capability ceiling.
 */
export const actionBehavioralTestSuiteSchema = z.strictObject({
  cases: z.array(fullBehavioralTestCaseSchema).min(1).max(MAX_BEHAVIORAL_CASES_PER_ACTION),
});

/**
 * One Action's frozen tests, content-addressed to the closed inputs they were generated from.
 * Equal digests mean the total inputs did not change, so the cases carry forward untouched.
 */
export const frozenActionTestsSchema = z.strictObject({
  action: capabilityToolSchema,
  input_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  cases: z.array(fullBehavioralTestCaseSchema).min(1).max(MAX_BEHAVIORAL_CASES_PER_ACTION),
});

/**
 * The frozen behavioral intent for one capability version, published at `tests/behavioral.json`.
 * Frozen before any Handler generation or repair, so no Handler byte can have informed it.
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
