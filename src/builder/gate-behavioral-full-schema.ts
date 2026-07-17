import { z } from "zod";

import { RECORD_NOT_FOUND_ERROR_CODE } from "../capability-data/index.ts";
import { capabilityToolSchema } from "../registry/index.ts";
import {
  behavioralExpectedErrorBaseSchema,
  behavioralInputValueSchema,
  behavioralRowSchema,
  nonEmptyStringSchema,
} from "./gate-behavioral-shared.ts";

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

export const fullBehavioralTestSuiteSchema = z.strictObject({
  cases: z.array(fullBehavioralTestCaseSchema).min(1).max(16),
});

export type FullBehavioralTestCase = z.infer<typeof fullBehavioralTestCaseSchema>;
export type FullBehavioralTestSuite = z.infer<typeof fullBehavioralTestSuiteSchema>;
