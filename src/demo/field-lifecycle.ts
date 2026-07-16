import type { Database } from "bun:sqlite";
import {
  commitCapability,
  createCapabilityIncarnationId,
  DEFAULT_ARTIFACTS_ROOT,
  type GeneratedUnit,
  runCapabilityGate,
} from "../builder/index.ts";
import {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  deriveCapabilityTableDdl,
} from "../capability-data/index.ts";
import { withWriteTransaction } from "../db.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  REGISTRY_TABLE,
} from "../registry/index.ts";
import { installReadDependencyDemo, removeReadDependencyDemo } from "./read-dependency.ts";

export const FIELD_LIFECYCLE_DEMO_ID = "field_lifecycle_demo";
export const FIELD_LIFECYCLE_MERGE_TARGET_ID = "merge-target";
export const FIELD_LIFECYCLE_DELETE_TARGET_ID = "delete-target";
export const FIELD_LIFECYCLE_HISTORICAL_TARGET_ID = "historical-null";

// Development-only 4.2–4.3 reference fixture. Epic 4.4 removes this hand-written
// capability when prompt builds switch to the final generated five-Action shape.
export const FIELD_LIFECYCLE_DEMO_SPEC: CapabilitySpec = {
  id: FIELD_LIFECYCLE_DEMO_ID,
  label: "Journal entry",
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
    {
      action: "update",
      trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["entry", "tags"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
  ],
  tools: ["create", "read", "update", "delete", "search"],
  read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
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

const CREATE_HANDLER = `export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {
  const reflection = input.values.reflection;
  const tags = input.values.tags;
  const aliases = input.values.aliases;
  const row = mutation.create({
    entry: input.values.entry,
    reflection: reflection === "" || reflection === undefined ? null : reflection,
    tags: Array.isArray(tags) ? [...tags] : tags,
    aliases: Array.isArray(aliases) ? [...aliases] : aliases,
  });
  return present(row);
}
`;

const READ_HANDLER = `export default async function read({ query, present }: CapabilityContext): Promise<string> {
  return query.records({
    sql: 'SELECT "id" AS "target_id" FROM "cap_field_lifecycle_demo" ORDER BY "created_at" DESC, "id" DESC',
  }).map(({ record }) => present(record)).join("");
}
`;

const UPDATE_HANDLER = `export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {
  const patch: Record<string, unknown> = {};
  if ("entry" in input.values) patch.entry = input.values.entry;
  if ("reflection" in input.values) patch.reflection = input.values.reflection;
  if ("tags" in input.values) {
    const tags = input.values.tags;
    patch.tags = Array.isArray(tags) ? [...tags] : tags;
  }
  if ("aliases" in input.values) {
    const aliases = input.values.aliases;
    patch.aliases = Array.isArray(aliases) ? [...aliases] : aliases;
  }
  return present(mutation.update(patch));
}
`;

const DELETE_HANDLER = `export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string> {
  mutation.delete();
  return '<p class="notice" data-demo-result="deleted">That entry is gone.</p>';
}
`;

const SEARCH_HANDLER = `export default async function search({ input, query, present }: CapabilityContext): Promise<string> {
  const raw = input.values.q;
  const q = typeof raw === "string" ? raw : "";
  const terms = q.trim().split(/\\s+/u).filter(Boolean);
  return query.records({
    sql: 'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT "target"."id" AS "target_id" FROM "cap_field_lifecycle_demo" AS "target" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE NOT (platform_search_normalize("target"."entry") LIKE char(37) || platform_search_normalize("search_term"."term") || char(37) OR platform_search_normalize("target"."reflection") LIKE char(37) || platform_search_normalize("search_term"."term") || char(37) OR EXISTS (SELECT 1 FROM json_each("target"."tags") AS "tag" WHERE platform_search_normalize("tag"."value") LIKE char(37) || platform_search_normalize("search_term"."term") || char(37)) OR EXISTS (SELECT 1 FROM json_each("target"."aliases") AS "alias" WHERE platform_search_normalize("alias"."value") LIKE char(37) || platform_search_normalize("search_term"."term") || char(37)))) ORDER BY "target"."created_at" DESC, "target"."id" DESC',
    parameters: [JSON.stringify(terms)],
  }).map(({ record }) => present(record)).join("");
}
`;

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;

export const FIELD_LIFECYCLE_DEMO_UNITS: readonly GeneratedUnit[] = [
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
  {
    kind: "handler",
    name: "update",
    filename: "update.ts",
    content: UPDATE_HANDLER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
  {
    kind: "handler",
    name: "delete",
    filename: "delete.ts",
    content: DELETE_HANDLER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
  {
    kind: "handler",
    name: "search",
    filename: "search.ts",
    content: SEARCH_HANDLER,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  },
];

export interface InstallFieldLifecycleDemoOptions {
  readonly database: Database;
  readonly artifactsRoot?: string;
  readonly mutationCoordinator: MutationCoordinator;
}

export async function installFieldLifecycleDemo(options: InstallFieldLifecycleDemoOptions) {
  const artifactsRoot = options.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  const database = options.database;
  const tableName = `${CAPABILITY_TABLE_PREFIX}${FIELD_LIFECYCLE_DEMO_ID}`;
  const ddl = deriveCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC);
  const handlers = Object.fromEntries(
    FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
      unit.name,
      unit.content,
    ]),
  );
  const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
    (unit) => unit.kind === "item-renderer",
  )?.content;
  if (!itemRenderer) throw new Error("The five-Action reference item renderer is missing.");

  const reservation = options.mutationCoordinator.reserveBuild();
  try {
    return await options.mutationCoordinator.withBuildLease(reservation, async () => {
      const gate = await runCapabilityGate({
        spec: FIELD_LIFECYCLE_DEMO_SPEC,
        ddl,
        handlers,
        itemRenderer,
        behavioralTier: { enabled: false },
        realDatabase: database,
      });
      const commit = await withWriteTransaction(database, () => {
        removeReadDependencyDemo(database);
        database.run(`DELETE FROM "${REGISTRY_TABLE}" WHERE "id" = ?`, [FIELD_LIFECYCLE_DEMO_ID]);
        database.run(`DROP TABLE IF EXISTS "${tableName}"`);
        applyCapabilityTableDdl(FIELD_LIFECYCLE_DEMO_SPEC, database);
        const committed = commitCapability({
          spec: FIELD_LIFECYCLE_DEMO_SPEC,
          incarnationId: createCapabilityIncarnationId(),
          units: FIELD_LIFECYCLE_DEMO_UNITS,
          database,
          artifactsRoot,
        });
        const seed = database.query(
          `INSERT INTO "${tableName}" ("id", "entry", "reflection", "tags", "aliases", "retired_note", "extra") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        seed.run(
          FIELD_LIFECYCLE_HISTORICAL_TARGET_ID,
          null,
          "This row predates logical requiredness.",
          null,
          null,
          "still stored",
          '{"source":"historical"}',
        );
        seed.run(
          FIELD_LIFECYCLE_MERGE_TARGET_ID,
          "A quiet beginning",
          "Keep this reflection",
          '["kept","before"]',
          '["Preserved alias"]',
          "hidden survives update",
          '{"source":"merge-demo"}',
        );
        seed.run(
          FIELD_LIFECYCLE_DELETE_TARGET_ID,
          "Ready to remove — CAFÉ ÅNGSTRÖM",
          "This one is only for the delete tracer.",
          '["delete-demo"]',
          "[]",
          "delete target hidden value",
          '{"source":"delete-demo"}',
        );
        return committed;
      });
      const readDependency = await installReadDependencyDemo(
        database,
        artifactsRoot,
        commit.row,
        FIELD_LIFECYCLE_MERGE_TARGET_ID,
      );
      return { ...commit, gate, readDependency };
    });
  } catch (error) {
    options.mutationCoordinator.cancelBuild(reservation);
    throw error;
  }
}
