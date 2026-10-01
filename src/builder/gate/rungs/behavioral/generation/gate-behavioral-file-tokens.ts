// What a behavioral case may say of a file field (Module 7 PLAN decision 39): a closed family token
// rather than a file, since the model cannot mint a pending reference. A `file` takes one token or
// `null`; a `file[]` takes one input entry per file, in order, or a lone `null`, and a row gives it
// an array of families. The harness turns each token into a scratch file of that family.

import { DEFAULT_MAX_LIST_FILES } from "../../../../../platform/files/file-cap.ts";
import {
  activeFileFields,
  type CapabilitySpec,
  isFileListFieldType,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  type SpecField,
} from "../../../../../registry/index.ts";
import type { FullBehavioralTestCase } from "./gate-behavioral-full-schema.ts";

/** Whether a row's token for a file field says it holds nothing: absent, `null` or `[]`. */
export function holdsNoFile(value: unknown): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

/**
 * A save never leaves a required file field empty unless its case expects the missing_required
 * refusal: the platform refuses that save whatever the Handler does, before any other verdict.
 */
export function assertSavedCaseHoldsRequiredFiles(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
): void {
  const saves = testCase.action === "create" || testCase.action === "update";
  const missingRequired = testCase.expectedError?.code === MISSING_REQUIRED_FIELDS_ERROR_CODE;
  if (!saves || missingRequired || testCase.expectedPlatformError) return;
  const required = activeFileFields(spec.schema.fields).filter((field) => field.required);
  for (const field of required) {
    const entries = testCase.input.filter((value) => value.field === field.name);
    const kept = entries.length === 0 && testCase.action === "update";
    if (kept || (entries.length > 0 && entries.every((entry) => entry.value !== null))) continue;
    throw new Error(
      `Behavioral test "${testCase.name}" leaves required file field "${field.name}" empty in a save it expects to go through; give it a family token.`,
    );
  }
}

export function withoutFileTokens(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
): FullBehavioralTestCase {
  const files = new Set(activeFileFields(spec.schema.fields).map((field) => field.name));
  const textualRow = (row: FullBehavioralTestCase["setupRows"][number]) => ({
    values: row.values.filter((entry) => !files.has(entry.field)),
  });
  return {
    ...testCase,
    input: testCase.input.filter((entry) => !files.has(entry.field)),
    setupRows: testCase.setupRows.map(textualRow),
    expectedRows: testCase.expectedRows.map(textualRow),
  };
}

/**
 * A file field takes a closed token (PLAN decision 39): a family its field accepts, or `null` for
 * none. A `file[]` takes one input entry per file, or a lone `null`, and a row gives it an array of
 * families. Every other input is a string, since only a file field has a token for none.
 */
export function assertFileTokens(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  const files = new Map(activeFileFields(spec.schema.fields).map((field) => [field.name, field]));
  for (const entry of testCase.input) {
    const field = files.get(entry.field);
    if (field) {
      assertFileToken(testCase.name, "input", field, entry.value);
      assertLoneNone(testCase.name, "input", testCase.input, field);
    } else if (entry.value === null) {
      throw new Error(
        `Behavioral test "${testCase.name}" input "${entry.field}" is null; only a file field takes null.`,
      );
    }
  }
  assertRowFileTokens(testCase.name, "setupRows", testCase.setupRows, files);
  assertRowFileTokens(testCase.name, "expectedRows", testCase.expectedRows, files);
  assertMissingRecordPostsNoFile(testCase, files);
}

/**
 * The platform checks a file against the record it edits before any Handler runs, so a
 * missing-record case that posts one proves the platform's not-found and never the Handler's.
 */
function assertMissingRecordPostsNoFile(
  testCase: FullBehavioralTestCase,
  files: ReadonlyMap<string, SpecField>,
): void {
  if (testCase.target !== "missing_record") return;
  const posted = testCase.input.find((entry) => files.has(entry.field));
  if (posted) {
    throw new Error(
      `Behavioral test "${testCase.name}" posts file field "${posted.field}" to a missing record; leave file fields out of a missing-record case.`,
    );
  }
}

function assertRowFileTokens(
  testName: string,
  label: string,
  rows: FullBehavioralTestCase["setupRows"],
  files: ReadonlyMap<string, SpecField>,
): void {
  for (const [index, row] of rows.entries()) {
    for (const entry of row.values) {
      const field = files.get(entry.field);
      if (!field) continue;
      assertFileToken(testName, `${label}[${index}]`, field, entry.value);
      assertLoneNone(testName, `${label}[${index}]`, row.values, field);
    }
  }
}

function assertFileToken(testName: string, label: string, field: SpecField, token: unknown): void {
  const families: readonly unknown[] = field.accepts ?? [];
  const list = isFileListFieldType(field.type);
  const tokens = list && Array.isArray(token) ? token : [token];
  if (token === null || tokens.every((each) => families.includes(each))) return;
  const takes = list
    ? `a file list takes ${JSON.stringify(families)} families, an array of them in a row, or null`
    : `a file field takes one of ${JSON.stringify(families)} or null`;
  throw new Error(
    `Behavioral test "${testName}" ${label} gives file field "${field.name}" ${JSON.stringify(token)}; ${takes}.`,
  );
}

/**
 * A `file[]` holds no more files than the Gate's count, and its `null` says it holds none, so it
 * stands alone among the field's entries, in an input and in a row alike. A `file` is held to
 * nothing new here, so a frozen suite still passes.
 */
function assertLoneNone(
  testName: string,
  label: string,
  values: readonly { readonly field: string; readonly value: unknown }[],
  field: SpecField,
): void {
  if (!isFileListFieldType(field.type)) return;
  const entries = values.filter((entry) => entry.field === field.name);
  const tokens = entries.flatMap((entry) => (Array.isArray(entry.value) ? entry.value : [entry]));
  if (tokens.length > DEFAULT_MAX_LIST_FILES) {
    throw new Error(
      `Behavioral test "${testName}" ${label} gives file field "${field.name}" ${tokens.length} files; a list holds at most ${DEFAULT_MAX_LIST_FILES}.`,
    );
  }
  if (entries.length < 2 || entries.every((entry) => entry.value !== null)) return;
  throw new Error(
    `Behavioral test "${testName}" ${label} gives file field "${field.name}" null beside a file; null alone says it holds none.`,
  );
}
