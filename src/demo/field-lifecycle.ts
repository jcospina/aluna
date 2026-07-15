import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  commitCapability,
  createCapabilityIncarnationId,
  DEFAULT_ARTIFACTS_ROOT,
  type GeneratedUnit,
} from "../builder/index.ts";
import { applyCapabilityTableDdl, CAPABILITY_TABLE_PREFIX } from "../capability-data/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  REGISTRY_TABLE,
} from "../registry/index.ts";

export const FIELD_LIFECYCLE_DEMO_ID = "field_lifecycle_demo";

export const FIELD_LIFECYCLE_DEMO_SPEC: CapabilitySpec = {
  id: FIELD_LIFECYCLE_DEMO_ID,
  label: "Field lifecycle",
  schema: {
    fields: [
      {
        name: "entry",
        label: "What happened?",
        type: "string",
        required: true,
        lifecycle: "active",
      },
      {
        name: "reflection",
        label: "A small reflection",
        type: "string",
        required: false,
        lifecycle: "active",
      },
      {
        name: "tags",
        label: "Tags",
        type: "string[]",
        required: true,
        lifecycle: "active",
      },
      {
        name: "aliases",
        label: "Other names",
        type: "string[]",
        required: false,
        lifecycle: "active",
      },
      {
        name: "retired_note",
        label: "Retired note",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
    ],
  },
  ui_intent: {
    form: {
      list_inputs: [
        { field: "tags", mode: "comma_separated" },
        { field: "aliases", mode: "repeatable" },
      ],
    },
    item: {
      direction: "A calm journal entry that pairs the entry with when it was created.",
      shows: ["entry", "tags", "created_at"],
    },
    collection: { layout: "feed" },
    detail: { shows: ["entry", "tags", "aliases", "reflection", "created_at"] },
  },
  behavior: "An entry and at least one tag are required. Newest reflections appear first.",
  behavioral_errors: [
    {
      action: "create",
      trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["entry", "tags"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
  ],
  tools: ["create", "read"],
  read_dependencies: { create: [], read: [] },
  prompt_context:
    "Stores tagged reflections while preserving submitted tag order and one retired field invisibly.",
};

const ITEM_RENDERER = `export default function renderItem(record: Record<string, unknown>): string {
  const entry = record.entry == null || record.entry === "" ? "—" : String(record.entry);
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((value): value is string => typeof value === "string")
    : [];
  const created = record.created_at == null ? "" : String(record.created_at).slice(0, 10);
  return '<div class="stack"><span class="text-lg">' + escapeHtml(entry) +
    '</span><div class="cluster">' + tags.map((tag) =>
      '<span class="text-sm">' + escapeHtml(tag) + '</span>').join("") +
    '</div><span class="text-sm text-muted">' + escapeHtml(created) + '</span></div>';
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
`;

const CREATE_HANDLER = `export default async function create({ input, data, present }: CapabilityContext): Promise<string> {
  const reflection = input.values.reflection;
  const tags = input.values.tags;
  const aliases = input.values.aliases;
  const row = data.insert({
    entry: input.values.entry,
    reflection: reflection === "" || reflection === undefined ? null : reflection,
    tags: Array.isArray(tags) ? [...tags] : tags,
    aliases: Array.isArray(aliases) ? [...aliases] : aliases,
  });
  return present(row);
}
`;

const READ_HANDLER = `export default async function read({ data, present }: CapabilityContext): Promise<string> {
  return data.select().map((row) => present(row)).join("");
}
`;

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;

const FIELD_LIFECYCLE_DEMO_UNITS: readonly GeneratedUnit[] = [
  {
    kind: "item-renderer",
    name: "item",
    filename: "item.ts",
    content: ITEM_RENDERER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
  {
    kind: "handler",
    name: "create",
    filename: "create.ts",
    content: CREATE_HANDLER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
  {
    kind: "handler",
    name: "read",
    filename: "read.ts",
    content: READ_HANDLER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
];

export interface InstallFieldLifecycleDemoOptions {
  readonly database: Database;
  readonly artifactsRoot?: string;
}

export function installFieldLifecycleDemo(options: InstallFieldLifecycleDemoOptions) {
  const artifactsRoot = options.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  const database = options.database;
  const tableName = `${CAPABILITY_TABLE_PREFIX}${FIELD_LIFECYCLE_DEMO_ID}`;
  rmSync(resolve(process.cwd(), artifactsRoot, FIELD_LIFECYCLE_DEMO_ID), {
    force: true,
    recursive: true,
  });

  database.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    database.run(`DELETE FROM "${REGISTRY_TABLE}" WHERE "id" = ?`, [FIELD_LIFECYCLE_DEMO_ID]);
    database.run(`DROP TABLE IF EXISTS "${tableName}"`);
    applyCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC, database);
    const commit = commitCapability({
      spec: FIELD_LIFECYCLE_DEMO_SPEC,
      incarnationId: createCapabilityIncarnationId(),
      units: FIELD_LIFECYCLE_DEMO_UNITS,
      database,
      artifactsRoot,
    });
    database.run(
      `INSERT INTO "${tableName}" ("id", "entry", "reflection", "tags", "aliases", "retired_note") VALUES (?, NULL, ?, NULL, NULL, ?)`,
      ["historical-null", "This row predates logical requiredness.", "still stored"],
    );
    database.exec("COMMIT;");
    return commit;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
