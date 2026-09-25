// The views a question's worker reads the catalog through (Module 7 PLAN decision 37; ADR-0008,
// amended 2026-09-25). Written here, on the main thread, and handed to the worker as SQL it runs
// at open: the worker imports nothing, so what the platform's tables, fields and words are is
// decided here and only executed there.
//
// A view lists the columns the table bound admits — `id`, `created_at` and the active fields — so
// a column it refuses is not there to read either. A file column comes as its kind, type, size and
// name, never its key. The values a person or a Handler can write freely — a `string`, a
// `string[]` and a file's name — show the withheld phrase where they may hold a file's address.

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { sqlIdentifier } from "../../platform/persistence/sql-identifier.ts";
import { FILE_LEDGER_TABLE } from "../../platform/persistence/table-names.ts";
import {
  type ActiveRegistryCatalog,
  activeSpecFields,
  capabilitySpecFromRow,
  type FieldType,
  PLATFORM_COLUMNS,
} from "../../registry/index.ts";
import { capabilityTableName } from "../data/schema/ddl.ts";
import type { CapabilityFileProjection } from "../data/schema/file-values.ts";
import type { QueryShadow } from "./query-worker.ts";
import { QUESTION_FILE_WITHHELD } from "./question-file-scrub.ts";

/** Where the worker attaches the file. No read can name it: the table bound prepares every read
 * on the platform's connection, where no schema is called this. */
export const QUESTION_DESK_SCHEMA = "question_desk";

/** How a column reaches a statement: as stored, as a file without its key, or withholdable. */
export type QuestionColumnReading = "value" | "file" | "text" | "list";

export interface QuestionViewColumn {
  readonly name: string;
  readonly reading: QuestionColumnReading;
}

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const globbed = (text: string) => text.replace(/[*?[]/g, "[$&]");
const HEX = "[0-9a-fA-F]";
const HEX_RUN = `'*${"[0-9a-f]".repeat(32)}*'`;
/** What a copied key is most often written with between its digits, dropped before matching. */
const SEPARATORS = [..."-_:./\\,;|+=#&?!'\"`()[]{}<>", " ", "\t", "\n", "\r", "\u00a0"];
/** A window's text is cut into chunks this long, overlapping by 31, so no substr walks far. */
const CHUNK = 1024;
const WITHHELD = literal(QUESTION_FILE_WITHHELD);
/** What of a stored file the platform wrote from the ledger; only its `name` came from a person. */
const PLATFORM_WRITTEN: readonly (keyof CapabilityFileProjection)[] = ["kind", "mime", "size"];
const LEDGER = `${QUESTION_DESK_SCHEMA}.${sqlIdentifier(FILE_LEDGER_TABLE)}`;

/** SQL for a key's 32 digits in a row read as the ledger's hyphenated key. */
function dashed(digits: string): string {
  const part = (from: number, length: number) => `substr(${digits}, ${from}, ${length})`;
  return [part(1, 8), part(9, 4), part(13, 4), part(17, 4), part(21, 12)].join(" || '-' || ");
}

/**
 * Whether `text` may hold a file's address: a NUL, past which SQLite's text functions read
 * nothing; a `/files/` path; or, the listed separators dropped, a ledger key, looked up through
 * the ledger's index at each 32-digit window of the chunks holding a run of hex digits.
 */
function mayHoldAnAddress(text: string): string {
  const digits = `lower(${SEPARATORS.reduce((inner, separator) => `replace(${inner}, ${literal(separator)}, '')`, text)})`;
  const span = CHUNK + 31;
  const chunks = `chunk(c, rest) AS (SELECT substr(${digits}, 1, ${span}), substr(${digits}, ${CHUNK + 1}) UNION ALL SELECT substr(rest, 1, ${span}), substr(rest, ${CHUNK + 1}) FROM chunk WHERE length(rest) > 31)`;
  const windows = `at(p, c) AS (SELECT 1, c FROM chunk WHERE c GLOB ${HEX_RUN} UNION ALL SELECT p + 1, c FROM at WHERE p + 32 <= length(c))`;
  const inLedger = `EXISTS (WITH RECURSIVE ${chunks}, ${windows} SELECT 1 FROM at JOIN ${LEDGER} AS ledger ON ledger."key" = ${dashed("substr(at.c, at.p, 32)")})`;
  return [
    `instr(CAST(${text} AS BLOB), x'00') > 0`,
    `${text} GLOB ${literal(`*${globbed(FILE_URL_PREFIX)}${HEX.repeat(8)}*`)}`,
    `(EXISTS (SELECT 1 FROM ${LEDGER}) AND ${digits} GLOB ${HEX_RUN} AND ${inLedger})`,
  ].join(" OR ");
}

/**
 * A view column. Every name is qualified, since SQLite reads a double-quoted name no column has as
 * a string instead, and text is cast back to TEXT, since a CASE has no affinity and a number bound
 * against it would match nothing.
 */
function columnAs({ name, reading }: QuestionViewColumn): string {
  const column = `source.${sqlIdentifier(name)}`;
  const as = `AS ${sqlIdentifier(name)}`;
  if (reading === "value") return `${column} ${as}`;
  if (reading === "file") {
    const field = (key: keyof CapabilityFileProjection) => `json_extract(${column}, '$.${key}')`;
    const fileName = field("name");
    const fields = [
      ...PLATFORM_WRITTEN.map((key) => `'${key}', ${field(key)}`),
      `'name', CASE WHEN ${mayHoldAnAddress(fileName)} THEN ${WITHHELD} ELSE ${fileName} END`,
    ];
    const whole = `json_valid(${column}) AND json_type(${column}) = 'object' AND json_type(json_remove(${column}, '$.key'), '$.key') IS NULL`;
    return `CASE WHEN ${whole} THEN json_object(${fields.join(", ")}) END ${as}`;
  }
  const hidden = reading === "list" ? `json_array(${WITHHELD})` : WITHHELD;
  return `CAST(CASE WHEN ${mayHoldAnAddress(column)} THEN ${hidden} ELSE ${column} END AS TEXT) ${as}`;
}

/** The view that shows `table` to a question as `columns`, under the table's own name. */
export function questionView(table: string, columns: readonly QuestionViewColumn[]): string {
  const name = sqlIdentifier(table);
  return `CREATE TEMP VIEW ${name} AS SELECT ${columns.map(columnAs).join(", ")} FROM ${QUESTION_DESK_SCHEMA}.${name} AS source`;
}

/**
 * How each type in the pantry reaches a question. Total over it, so a new type states whether a
 * person can write an address into it rather than being read as stored.
 */
const READING_BY_FIELD_TYPE = {
  string: "text",
  number: "value",
  boolean: "value",
  datetime: "value",
  date: "value",
  choice: "value",
  "string[]": "list",
  file: "file",
} as const satisfies Record<FieldType, QuestionColumnReading>;

/** What the worker is told at birth: a view for every capability the catalog snapshot holds. */
export function questionViews(catalog: ActiveRegistryCatalog): QueryShadow {
  const [id, createdAt] = PLATFORM_COLUMNS;
  const views = catalog.capabilities.map((row) => {
    const spec = capabilitySpecFromRow(row);
    return questionView(capabilityTableName(spec.id), [
      { name: id, reading: "value" },
      { name: createdAt, reading: "value" },
      ...activeSpecFields(spec.schema.fields).map(({ name, type }) => ({
        name,
        reading: READING_BY_FIELD_TYPE[type],
      })),
    ]);
  });
  return { schema: QUESTION_DESK_SCHEMA, views };
}
