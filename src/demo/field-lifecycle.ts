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

export const FIELD_LIFECYCLE_DEMO_ID = "field_lifecycle_demo";

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
  return query.all({
    sql: 'SELECT * FROM "cap_field_lifecycle_demo" ORDER BY "created_at" DESC, "id" DESC',
    result: [
      { alias: "id", type: "string" },
      { alias: "created_at", type: "datetime" },
      { alias: "entry", type: "string" },
      { alias: "reflection", type: "string" },
      { alias: "tags", type: "string[]" },
      { alias: "aliases", type: "string[]" },
    ],
  }).map((row) => present(row)).join("");
}
`;

// Issue 4.2/05 replaces these two routable reference seams with target-bound
// merge/delete behavior. They are intentionally real Handler files now so no
// registry row advertises an absent Action during the 4.2 transition.
const UPDATE_HANDLER = `export default async function update(_context: CapabilityContext): Promise<string> {
  return '<p class="notice" data-demo-result="unavailable">I can’t save that change just yet. Please try again soon.</p>';
}
`;

const DELETE_HANDLER = `export default async function remove(_context: CapabilityContext): Promise<string> {
  return '<p class="notice" data-demo-result="unavailable">I can’t remove that entry just yet. Please try again soon.</p>';
}
`;

const SEARCH_HANDLER = `export default async function search({ input, query, present }: CapabilityContext): Promise<string> {
  const raw = input.values.q;
  const q = typeof raw === "string" ? raw : "";
  return query.all({
    sql: 'SELECT * FROM "cap_field_lifecycle_demo" WHERE length(?) = 0 OR "entry" LIKE char(37) || ? || char(37) ORDER BY "created_at" DESC, "id" DESC',
    parameters: [q, q],
    result: [
      { alias: "id", type: "string" },
      { alias: "created_at", type: "datetime" },
      { alias: "entry", type: "string" },
      { alias: "reflection", type: "string" },
      { alias: "tags", type: "string[]" },
      { alias: "aliases", type: "string[]" },
    ],
  }).map((row) => present(row)).join("");
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
        database.run(
          `INSERT INTO "${tableName}" ("id", "entry", "reflection", "tags", "aliases", "retired_note") VALUES (?, NULL, ?, NULL, NULL, ?)`,
          ["historical-null", "This row predates logical requiredness.", "still stored"],
        );
        return committed;
      });
      return { ...commit, gate };
    });
  } catch (error) {
    options.mutationCoordinator.cancelBuild(reservation);
    throw error;
  }
}
