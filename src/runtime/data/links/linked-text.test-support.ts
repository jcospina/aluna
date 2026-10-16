// The link-control desk as the ports see it: Authors, Books and Memos with data tables and two seeded
// authors, Books' author linked to Authors' name and Memos' subject to Books' author unless a test
// says otherwise. Not a test file.

import { writeLinkRow } from "../../../platform/links/link-table.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { type CapabilityRow, type Relation, relationsReaching } from "../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  type DeskCapability,
  deskRow,
  MEMOS,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { rowSpec } from "../../router/dispatch/router.test-support.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityUpdateMutationPort,
  fileClaimScope,
  type LinkBinding,
  materializeCapabilityActionRecord,
  NO_LINKS,
  type RefreshReach,
} from "../index.ts";

export const BOOK_AUTHOR: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};
export const BOOK_TITLE: Relation = {
  field: "title",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "pen_name" },
};
export const MEMO_SUBJECT: Relation = {
  field: "subject",
  to: { capability: "books", incarnation: BOOKS_INCARNATION, field: "author" },
};

export const LE_GUIN = "author-le-guin";
export const BUTLER = "author-butler";

let env: ScratchDbEnv | undefined;

export function db() {
  if (env === undefined) throw new Error("The desk is not open");
  return env.conns.readwrite;
}

/** Open the desk on a scratch database: each capability's table, and the two authors. */
export function openDesk(capabilities: readonly DeskCapability[] = [AUTHORS, BOOKS, MEMOS]): void {
  env = createScratchDbEnv("omni-crud-linked-text-");
  for (const capability of capabilities) applyCapabilityTableDdl(spec(capability), db());
  db().run('INSERT INTO "cap_authors" ("id", "name", "pen_name") VALUES (?, ?, ?)', [
    LE_GUIN,
    "Ursula K. Le Guin",
    "Le Guin",
  ]);
  db().run('INSERT INTO "cap_authors" ("id", "name", "pen_name") VALUES (?, ?, ?)', [
    BUTLER,
    "Octavia E. Butler",
    "Butler",
  ]);
}

export function closeDesk(): void {
  if (env !== undefined) teardownScratchDbEnv(env);
  env = undefined;
}

export function spec(capability: DeskCapability) {
  return rowSpec(deskRow(capability));
}

/** A record of `capability` holding `text` in `field`, linked to `target` when one is named. */
export function linked(
  capability: DeskCapability,
  field: string,
  id: string,
  text: string,
  target?: { readonly capability: string; readonly incarnation: string; readonly record: string },
): void {
  db().run(`INSERT INTO "cap_${capability.id}" ("id", "${field}") VALUES (?, ?)`, [id, text]);
  if (target) writeLinkRow(db(), { capability: capability.id, record: id, field }, target);
}

export const toAuthor = (record: string) => ({
  capability: "authors",
  incarnation: AUTHORS_INCARNATION,
  record,
});

export const toBook = (record: string) => ({
  capability: "books",
  incarnation: BOOKS_INCARNATION,
  record,
});

/** Each record's text in one field, by id. */
export function texts(table: string, field: string): Record<string, unknown> {
  const rows = db().query(`SELECT "id", "${field}" AS "text" FROM "${table}"`).all() as {
    id: string;
    text: unknown;
  }[];
  return Object.fromEntries(rows.map(({ id, text }) => [id, text]));
}

/** The desk's registry rows, each capability holding the relations `relations` gives it. */
export function desk(
  relations: Readonly<Record<string, readonly Relation[]>> = {
    books: [BOOK_AUTHOR],
    memos: [MEMO_SUBJECT],
  },
): CapabilityRow[] {
  return [AUTHORS, BOOKS, MEMOS].map((capability) => ({
    ...deskRow(capability),
    relations: [...(relations[capability.id] ?? [])],
  }));
}

/** `catalog` with one capability's field hidden, which makes its relations dormant. */
export function hidden(catalog: readonly CapabilityRow[], capability: string, name: string) {
  return catalog.map((row) => {
    if (row.id !== capability) return row;
    const fields = row.schema.fields.map((field) =>
      field.name === name ? { ...field, lifecycle: "inactive" as const } : field,
    );
    return { ...row, schema: { fields } };
  });
}

/** What an edit of `capability` reaches on `catalog`, every capability writable but `closed`. */
export function reachOn(
  catalog: readonly CapabilityRow[],
  closed: readonly string[] = [],
  capability = "authors",
): RefreshReach {
  const row = catalog.find((each) => each.id === capability);
  if (!row) throw new Error(`${capability} is not on the desk`);
  return {
    relations: relationsReaching(row, catalog),
    writable: (source) => !closed.includes(source.capability),
  };
}

/** An update port on one record, its form submitting `submitted`. */
export function updatePort(
  capability: DeskCapability,
  id: string,
  submitted: readonly string[],
  links: LinkBinding,
) {
  const scope = fileClaimScope(db(), spec(capability), capability.incarnation);
  return createCapabilityUpdateMutationPort(
    spec(capability),
    id,
    new Set(submitted),
    { scope, submitted: new Map() },
    undefined,
    links,
  );
}

/** An edit of one author, submitting the fields `values` names, refreshing what `reach` reaches. */
export function editAuthor(id: string, values: Record<string, unknown>, reach: RefreshReach) {
  const port = updatePort(AUTHORS, id, Object.keys(values), { ...NO_LINKS, reach });
  return materializeCapabilityActionRecord(port.update(values));
}

/** A Books save picking `author` for its author. */
export function picking(author: string): LinkBinding {
  return { ...NO_LINKS, relations: [BOOK_AUTHOR], picks: new Map([["author", author]]) };
}
