// Shared fixtures and harness for the capability-scoped data tool tests. The
// spec builders and the file/in-memory database helpers are used by more than
// one split test file, so they live here rather than being duplicated. This
// module is not run as a test by bun.

import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "./index.ts";

export function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const mutation = createCapabilityMutationPort(spec, databases.readwrite);
  const query = createCapabilityQueryPort(databases.readonly, { target: spec });
  return {
    insert: (values: Record<string, unknown>) =>
      materializeCapabilityActionRecord(mutation.create(values)),
    select: () => selectCapabilityRows(spec, query),
  };
}

export function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

export function recipesSpec(): CapabilitySpec {
  return notesSpec({
    id: "recipes",
    label: "Recipes",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: {
        direction: "A text-forward card that emphasizes the recipe title.",
        shows: ["title"],
      },
      collection: { layout: "feed" },
      detail: { shows: ["title"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
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
  return notesSpec({
    schema: { fields },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "Show the entry and its count.", shows: ["title", "count"] },
      collection: { layout: "feed" },
      detail: { shows: ["title", "count", "enabled", "due_on", "happens_at", "note"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: required,
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
  });
}

export function stringListSpec(): CapabilitySpec {
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
      },
      item: { direction: "Show tags in their submitted order.", shows: ["tags"] },
      collection: { layout: "feed" },
      detail: { shows: ["tags", "aliases"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["tags"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
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
