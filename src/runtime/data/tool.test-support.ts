// Shared fixtures and harness for the capability-scoped data tool tests. The
// spec builders and the file/in-memory database helpers are used by more than
// one split test file, so they live here rather than being duplicated. This
// module is not run as a test by bun.

import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../../platform/persistence/db.ts";
import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../registry/index.ts";
import { notesSpec } from "../../registry/spec/spec.test-support.ts";
import {
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  type FileClaimScope,
  type FileSubmissionBinding,
  fileClaimScope,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "./index.ts";

export { notesSpec };

/** Where a test port's files are kept: `spec`'s first incarnation, in `database`. */
export function testFileScope(spec: CapabilitySpec, database: Database): FileClaimScope {
  return fileClaimScope(database, spec, FIRST_INCARNATION_ID);
}

/** A save that submitted no file field, as every save of a capability without one does. */
export function noFiles(spec: CapabilitySpec, database: Database): FileSubmissionBinding {
  return { scope: testFileScope(spec, database), submitted: new Map() };
}

export function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const mutation = createCapabilityMutationPort(spec, noFiles(spec, databases.readwrite));
  const query = createCapabilityQueryPort(databases.readonly, { target: spec });
  return {
    insert: (values: Record<string, unknown>) =>
      materializeCapabilityActionRecord(mutation.create(values)),
    select: () => selectCapabilityRows(spec, query),
  };
}

export function recipesSpec(): CapabilitySpec {
  const requiredError: Omit<CapabilitySpec["behavioral_errors"][number], "action"> = {
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields: ["title"],
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  };
  return notesSpec({
    id: "recipes",
    label: "Recipes",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: {
        direction: "A text-forward card that emphasizes the recipe title.",
        shows: ["title"],
      },
      collection: { layout: "feed" },
    },
    behavioral_errors: [
      { action: "create", ...requiredError },
      { action: "update", ...requiredError },
    ],
    prompt_context: "Stores the user's recipes.",
  });
}

export function requirednessSpec(): CapabilitySpec {
  const fields: CapabilitySpec["schema"]["fields"] = [
    { name: "title", label: "Entry", type: "string", required: true, lifecycle: "active" },
    { name: "count", label: "Count", type: "number", required: true, lifecycle: "active" },
    { name: "enabled", label: "Enabled", type: "boolean", required: true, lifecycle: "active" },
    { name: "due_on", label: "Due on", type: "date", required: true, lifecycle: "active" },
    {
      name: "happens_at",
      label: "Happens at",
      type: "datetime",
      required: true,
      lifecycle: "active",
    },
    { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
    {
      name: "retired_note",
      label: "Retired note",
      type: "string",
      required: true,
      lifecycle: "inactive",
    },
  ];
  const required = ["title", "count", "enabled", "due_on", "happens_at"];
  const requiredError: Omit<CapabilitySpec["behavioral_errors"][number], "action"> = {
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields: required,
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  };
  return notesSpec({
    schema: { fields },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "Show the entry and its count.", shows: ["title", "count"] },
      collection: { layout: "feed" },
    },
    behavioral_errors: [
      { action: "create", ...requiredError },
      { action: "update", ...requiredError },
    ],
  });
}

export function stringListSpec(): CapabilitySpec {
  const requiredError: Omit<CapabilitySpec["behavioral_errors"][number], "action"> = {
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields: ["tags"],
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  };
  return notesSpec({
    schema: {
      fields: [
        { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
        {
          name: "aliases",
          label: "Aliases",
          type: "string[]",
          required: false,
          lifecycle: "active",
        },
      ],
    },
    ui_intent: {
      form: {
        list_inputs: [
          { field: "tags", mode: "repeatable" },
          { field: "aliases", mode: "repeatable" },
        ],
        choice_inputs: [],
        long_text: [],
        guidance: [],
      },
      item: { direction: "Show tags in their submitted order.", shows: ["tags"] },
      collection: { layout: "feed" },
    },
    behavioral_errors: [
      { action: "create", ...requiredError },
      { action: "update", ...requiredError },
    ],
  });
}

export function withFileDatabase(run: (databases: PlatformDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "omni-crud-tool-"));
  const databases = openDatabase(join(dir, "test.db"));

  try {
    run(databases);
  } finally {
    closeQuietly(databases.readwrite);
    closeQuietly(databases.readonly);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function closeQuietly(database: Database): void {
  try {
    database.close();
  } catch {
    // Some tests deliberately close one side early to prove which connection a
    // tool method uses.
  }
}
