import type { Database } from "bun:sqlite";

import {
  commitCapability,
  createCapabilityIncarnationId,
  type GeneratedUnit,
  runCapabilityGate,
} from "../builder/index.ts";
import {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  deriveCapabilityTableDdl,
} from "../capability-data/index.ts";
import { withWriteTransaction } from "../db.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  REGISTRY_TABLE,
} from "../registry/index.ts";
export const READ_DEPENDENCY_DEMO_ID = "journal_links_demo";
export const READ_DEPENDENCY_DEMO_TARGET_ID = "joined-target";

export function readDependencyDemoSpec(reference: CapabilityRow): CapabilitySpec {
  return {
    id: READ_DEPENDENCY_DEMO_ID,
    label: "Journal links",
    schema: {
      fields: [
        {
          name: "journal_entry_id",
          label: "Journal entry",
          type: "string",
          required: true,
          lifecycle: "active",
        },
        { name: "note", label: "Note", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A compact note linked to a journal entry.", shows: ["note"] },
      collection: { layout: "feed" },
      detail: { shows: ["note", "journal_entry_id", "created_at"] },
    },
    behavior: "Each note can show the journal entry it references.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["journal_entry_id", "note"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["journal_entry_id", "note"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: {
      create: [],
      read: [{ capability_id: reference.id, incarnation_id: reference.incarnation_id }],
      update: [],
      delete: [],
      search: [{ capability_id: reference.id, incarnation_id: reference.incarnation_id }],
    },
    prompt_context: "Stores notes that read a declared Journal entry dependency.",
  };
}

const ITEM_RENDERER = `export default function renderItem(record: Record<string, unknown>): string {
  return '<div class="stack"><span class="text-lg">' + escapeHtml(String(record.note ?? "—")) + '</span></div>';
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
`;

const CREATE_HANDLER = `export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {
  return present(mutation.create({
    journal_entry_id: input.values.journal_entry_id,
    note: input.values.note,
  }));
}
`;

const READ_HANDLER = `export default async function read({ query, present }: CapabilityContext): Promise<string> {
  return query.records({
    sql: 'SELECT links."id" AS "target_id", coalesce(journal."entry", "") AS "journal_entry" FROM "cap_journal_links_demo" links LEFT JOIN "cap_field_lifecycle_demo" journal ON journal."id" = links."journal_entry_id" ORDER BY links."created_at" DESC, links."id" DESC',
    result: [{ alias: "journal_entry", type: "string" }],
  }).map(({ record, values }) => '<p class="text-sm text-muted" data-joined-journal-entry>' +
    escapeHtml(String(values.journal_entry ?? "")) + '</p>' + present(record)).join("");
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
`;

const UPDATE_HANDLER = `export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {
  const patch: Record<string, unknown> = {};
  if ("journal_entry_id" in input.values) patch.journal_entry_id = input.values.journal_entry_id;
  if ("note" in input.values) patch.note = input.values.note;
  return present(mutation.update(patch));
}
`;

const DELETE_HANDLER = `export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string> {
  mutation.delete();
  return '<p class="notice">That link is gone.</p>';
}
`;

const SEARCH_HANDLER = `export default async function search({ input, query, present }: CapabilityContext): Promise<string> {
  const raw = input.values.q;
  const term = typeof raw === "string" ? raw : "";
  const terms = term.trim().split(/\\s+/u).filter(Boolean);
  if (terms.length === 0) {
    return query.records({
      sql: 'SELECT links."id" AS "target_id", coalesce(journal."entry", "") AS "journal_entry" FROM "cap_journal_links_demo" links LEFT JOIN "cap_field_lifecycle_demo" journal ON journal."id" = links."journal_entry_id" ORDER BY links."created_at" DESC, links."id" DESC',
      result: [{ alias: "journal_entry", type: "string" }],
    }).map(({ record, values }) => '<p class="text-sm text-muted" data-joined-journal-entry>' +
      escapeHtml(String(values.journal_entry ?? "")) + '</p>' + present(record)).join("");
  }
  return query.records({
    sql: 'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT links."id" AS "target_id", coalesce(journal."entry", "") AS "journal_entry" FROM "cap_journal_links_demo" links LEFT JOIN "cap_field_lifecycle_demo" journal ON journal."id" = links."journal_entry_id" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE NOT (coalesce(instr(platform_search_normalize(links."journal_entry_id"), platform_search_normalize("search_term"."term")), 0) > 0 OR coalesce(instr(platform_search_normalize(links."note"), platform_search_normalize("search_term"."term")), 0) > 0 OR coalesce(instr(platform_search_normalize(coalesce(journal."entry", "")), platform_search_normalize("search_term"."term")), 0) > 0)) ORDER BY links."created_at" DESC, links."id" DESC',
    parameters: [JSON.stringify(terms)],
    result: [{ alias: "journal_entry", type: "string" }],
  }).map(({ record, values }) => '<p class="text-sm text-muted" data-joined-journal-entry>' +
    escapeHtml(String(values.journal_entry ?? "")) + '</p>' + present(record)).join("");
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
`;

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;

function units(): readonly GeneratedUnit[] {
  return [
    ["item-renderer", "item", "item.ts", ITEM_RENDERER],
    ["handler", "create", "create.ts", CREATE_HANDLER],
    ["handler", "read", "read.ts", READ_HANDLER],
    ["handler", "update", "update.ts", UPDATE_HANDLER],
    ["handler", "delete", "delete.ts", DELETE_HANDLER],
    ["handler", "search", "search.ts", SEARCH_HANDLER],
  ].map(([kind, name, filename, content]) => ({
    kind,
    name,
    filename,
    content,
    attempts: [],
    durationMs: 0,
    usage: EMPTY_USAGE,
  })) as readonly GeneratedUnit[];
}

export async function installReadDependencyDemo(
  database: Database,
  artifactsRoot: string,
  reference: CapabilityRow,
  referenceRecordId: string,
) {
  const spec = readDependencyDemoSpec(reference);
  const referenceSpec = capabilitySpecFromRow(reference);
  const ddl = deriveCapabilityTableDdl(spec);
  const generatedUnits = units();
  const handlers = Object.fromEntries(
    generatedUnits
      .filter((unit) => unit.kind === "handler")
      .map((unit) => [unit.name, unit.content]),
  );
  const gate = await runCapabilityGate({
    spec,
    ddl,
    handlers,
    itemRenderer: ITEM_RENDERER,
    behavioralTier: { enabled: false },
    realDatabase: database,
    scratchCatalog: [
      {
        spec: referenceSpec,
        incarnationId: reference.incarnation_id,
        rows: [
          {
            entry: "A quiet beginning",
            reflection: "Keep this reflection",
            tags: ["kept", "before"],
            aliases: ["Preserved alias"],
            retired_note: "copied reader compatibility",
          },
        ],
      },
    ],
  });
  const tableName = `${CAPABILITY_TABLE_PREFIX}${READ_DEPENDENCY_DEMO_ID}`;
  const commit = await withWriteTransaction(database, () => {
    database.run(`DELETE FROM "${REGISTRY_TABLE}" WHERE "id" = ?`, [READ_DEPENDENCY_DEMO_ID]);
    database.run(`DROP TABLE IF EXISTS "${tableName}"`);
    applyCapabilityTableDdl(spec, database);
    const committed = commitCapability({
      spec,
      incarnationId: createCapabilityIncarnationId(),
      units: generatedUnits,
      database,
      artifactsRoot,
    });
    database.run(`INSERT INTO "${tableName}" ("id", "journal_entry_id", "note") VALUES (?, ?, ?)`, [
      READ_DEPENDENCY_DEMO_TARGET_ID,
      referenceRecordId,
      "Seen through a declared dependency",
    ]);
    return committed;
  });
  return { ...commit, gate };
}

export function removeReadDependencyDemo(database: Database): void {
  database.run(`DELETE FROM "${REGISTRY_TABLE}" WHERE "id" = ?`, [READ_DEPENDENCY_DEMO_ID]);
  database.run(`DROP TABLE IF EXISTS "${CAPABILITY_TABLE_PREFIX}${READ_DEPENDENCY_DEMO_ID}"`);
}
