// The demo desk a search through links is tested on: Books by Authors, a Reading Log whose title
// picks a book, Loans of books, and a looped pair, Memos and Topics, each linking to the other.
// Searched through the real router, by a stand-in for a generated search Handler. Not a test file.

import { spyOn } from "bun:test";
import { CARD_RECORD_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { splitCollectionCount } from "#shell/records/collection-count.js";
import { writeLinkRow } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  FIFTH_INCARNATION_ID,
  SIXTH_INCARNATION_ID,
} from "../../../../registry/incarnations.test-support.ts";
import { type Relation, readActiveRegistryCatalog } from "../../../../registry/index.ts";
import {
  AUTHORS,
  BOOKS,
  type DeskCapability,
  deskRow,
  installDesk,
  MEMOS,
  READING_LOG,
  storeRelations,
  textField,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  capabilityIncarnation,
  createReadGateCoordinator,
  type ReadGateCoordinator,
} from "../../../concurrency/read-gates.ts";
import { type CapabilityActionRecord, normalizeSearchText } from "../../../data/index.ts";
import type { CapabilityContext } from "../../contract.ts";
import type { HandlerLoader, ItemRendererLoader } from "../generated-code.ts";
import {
  BOOK_AUTHOR,
  BUTLER,
  LE_GUIN,
  routerApp,
  SANDERSON,
} from "../links/router.links.test-support.ts";
import { install } from "../router.test-support.ts";
import type { CapabilityRouterDeps } from "../router.ts";

export { BOOK_AUTHOR, BUTLER, LE_GUIN, SANDERSON };

/** Who borrowed which book: its book picks one by title. */
export const LOANS: DeskCapability = {
  id: "loans",
  label: "Loans",
  noun: "loan",
  plural: "loans",
  incarnation: SIXTH_INCARNATION_ID,
  fields: [textField("book", "Book"), textField("borrower", "Borrower")],
};

/** Topics, whose memo picks a memo by subject while a memo's subject picks a topic by name. */
export const TOPICS: DeskCapability = {
  id: "topics",
  label: "Topics",
  noun: "topic",
  plural: "topics",
  incarnation: FIFTH_INCARNATION_ID,
  fields: [
    textField("name", "Name"),
    textField("memo", "Memo"),
    { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
  ],
};

export const LOG_TITLE = relation("title", BOOKS, "title");
export const LOAN_BOOK = relation("book", BOOKS, "title");
export const LOAN_BORROWER = relation("borrower", AUTHORS, "name");
export const MEMO_SUBJECT = relation("subject", TOPICS, "name");
export const TOPIC_MEMO = relation("memo", MEMOS, "subject");

function relation(field: string, to: DeskCapability, toField: string): Relation {
  return { field, to: { capability: to.id, incarnation: to.incarnation, field: toField } };
}

/** The desk, with Loans and Topics beside it and the relations each test names. */
export function installSearchDesk(
  conns: PlatformDatabase,
  relations: Readonly<Record<string, readonly Relation[]>>,
): void {
  installDesk(conns);
  install(conns, deskRow(LOANS));
  install(conns, deskRow(TOPICS));
  conns.readwrite.run('DELETE FROM "cap_reading_log"');
  for (const [capability, held] of Object.entries(relations)) {
    storeRelations(conns, capability, held);
  }
}

/** The day a record was written on, so its age is its order. */
function day(n: number): string {
  return `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`;
}

/**
 * Write a record of `capability` on day `on`, and the link each picked field makes: `picks` maps a
 * field to the record it picked in the capability its relation points at.
 */
export function seed(
  conns: PlatformDatabase,
  capability: DeskCapability,
  id: string,
  on: number,
  values: Readonly<Record<string, string>>,
  picks: Readonly<Record<string, readonly [DeskCapability, string]>> = {},
): void {
  const columns = ["id", "created_at", ...Object.keys(values)];
  conns.readwrite.run(
    `INSERT INTO "cap_${capability.id}" (${columns.map((c) => `"${c}"`).join(", ")})` +
      ` VALUES (${columns.map(() => "?").join(", ")})`,
    [id, day(on), ...Object.values(values)],
  );
  for (const [field, [target, picked]] of Object.entries(picks)) {
    writeLinkRow(
      conns.readwrite,
      { capability: capability.id, record: id, field },
      { capability: target.id, incarnation: target.incarnation, record: picked },
    );
  }
}

/** Fill in fields of an author already seeded. */
export function describeAuthor(
  conns: PlatformDatabase,
  author: string,
  values: { readonly pen_name?: string; readonly bio?: string },
): void {
  for (const [field, value] of Object.entries(values)) {
    conns.readwrite.run(`UPDATE "cap_authors" SET "${field}" = ? WHERE "id" = ?`, [value, author]);
  }
}

/** How a stand-in search Handler draws, orders and answers with what it finds. */
interface SearchHandlerOptions {
  /** Oldest first, against the default order, to show the answer's own order is kept. */
  readonly oldestFirst?: boolean;
  /** Draw every record through `present`, then answer with the matches alone. */
  readonly drawsEveryRecord?: boolean;
  /** What the Handler makes of its cards before it answers. */
  readonly answers?: (cards: string) => string;
  /** Run as it searches, as a slow Handler or one that ends its read would. */
  readonly meanwhile?: () => void;
}

/**
 * A stand-in for a generated search Handler: every term in some text of the record's own fields,
 * read in JavaScript so it shares nothing with the platform's walk. Blank shows every record.
 */
function searchHandler(table: string, options: SearchHandlerOptions = {}) {
  return async ({ input, query, present }: CapabilityContext): Promise<string> => {
    options.meanwhile?.();
    const q = typeof input.values.q === "string" ? input.values.q : "";
    const terms = q.split(/\s+/u).filter(Boolean).map(normalizeSearchText);
    const order = options.oldestFirst ? "ASC" : "DESC";
    const rows = query.records({
      sql: `SELECT "id" AS "target_id" FROM "${table}" ORDER BY "created_at" ${order}, "id" ${order}`,
    });
    const matches = (record: CapabilityActionRecord) =>
      terms.every((term) => textOf(record).some((text) => text.includes(term)));
    const cards = rows.map(({ record }) => ({
      matches: matches(record),
      card: options.drawsEveryRecord || matches(record) ? present(record) : "",
    }));
    const answer = cards
      .filter((each) => each.matches)
      .map((each) => each.card)
      .join("");
    return options.answers ? options.answers(answer) : answer;
  };
}

function textOf(record: CapabilityActionRecord): string[] {
  return Object.values(record.fields)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSearchText);
}

const DESK = [BOOKS, AUTHORS, READING_LOG, MEMOS, LOANS, TOPICS];

/** Each desk capability's search Handler, as `options` says, and its card: its first field, bold. */
export function deskCode(options: Readonly<Record<string, SearchHandlerOptions>> = {}) {
  const byPath = new Map<string, DeskCapability>(
    DESK.map((capability) => [deskRow(capability).artifacts_path, capability]),
  );
  const capabilityAt = (path: string) => {
    const capability = byPath.get(path);
    if (capability === undefined) throw new Error(`no capability at ${path}`);
    return capability;
  };
  const loadHandler: HandlerLoader = async (path) => {
    const { id } = capabilityAt(path);
    return searchHandler(`cap_${id}`, options[id]);
  };
  const loadItemRenderer: ItemRendererLoader = async (path) => {
    const first = capabilityAt(path).fields[0]?.name ?? "";
    return (record) => `<b>${String(record[first] ?? "")}</b>`;
  };
  return { loadHandler, loadItemRenderer };
}

/** A read-gate coordinator that has seen the whole desk. */
export function gates(conns: PlatformDatabase): ReadGateCoordinator {
  const readGates = createReadGateCoordinator();
  readGates.synchronizeCatalog(
    readActiveRegistryCatalog(conns.readonly).capabilities.map(capabilityIncarnation),
  );
  return readGates;
}

/** The incarnation a desk capability's read gate is keyed by. */
export function gateOf(capability: DeskCapability) {
  return capabilityIncarnation({ id: capability.id, incarnation_id: capability.incarnation });
}

/** What one search answered: its status, the records it listed, in order, and its count. */
export async function searched(
  conns: PlatformDatabase,
  capability: string,
  query: string | undefined,
  deps: CapabilityRouterDeps = {},
) {
  const app = routerApp(conns, { ...deskCode(), ...deps });
  const address = `/capability/${capability}/search${query === undefined ? "" : `?q=${encodeURIComponent(query)}`}`;
  const response = await app.request(address, { headers: { "HX-Request": "true" } });
  const { sentence, records } = splitCollectionCount(await response.text());
  const card = new RegExp(`${CARD_RECORD_ATTRIBUTE}="([^"]*)"`, "g");
  const listed = [...String(records).matchAll(card)].map((m) => m[1]);
  return { status: response.status, listed, sentence, records: String(records) };
}

/** What an answer holds besides its cards: the Handler's own markup, or anything else sent. */
export function outsideCards(records: string): string {
  return records.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, "");
}

/** Every read token asked for, by the capabilities each one names, as `taken()` reads them. */
export function watchTokens(readGates: ReadGateCoordinator) {
  const acquire = spyOn(readGates, "tryAcquire");
  return () => acquire.mock.calls.map(([input]) => input.incarnations.map((i) => i.capabilityId));
}

/** The capabilities someone still reads. */
export const readers = (readGates: ReadGateCoordinator) =>
  readGates.snapshot().filter((entry) => entry.readerCount > 0);

/** A clock the platform reads time from, moved on by hand: a Handler time limit with no waiting. */
export function handClock() {
  const real = performance.now.bind(performance);
  let ahead = 0;
  const now = spyOn(performance, "now").mockImplementation(() => real() + ahead);
  return {
    advance: (ms: number) => {
      ahead += ms;
    },
    restore: () => now.mockRestore(),
  };
}

/** Run `body` with `console.error` held, and say what it was told. */
export async function quietly(body: () => Promise<void>): Promise<unknown[][]> {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    await body();
    return errors.mock.calls;
  } finally {
    errors.mockRestore();
  }
}
