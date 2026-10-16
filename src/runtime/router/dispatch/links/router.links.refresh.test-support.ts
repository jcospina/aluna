// The link-control desk with Authors as a target the router can save: Notes' text and Books'
// author linked to Authors' name, Memos' subject to Books' author, and Authors' own Handlers beside
// the notes fixture's. Not a test file.

import { capabilityActionUrl } from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { writeLinkRow } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { type Relation, readActiveRegistryCatalog } from "../../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS_INCARNATION,
  deskRow,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  capabilityIncarnation,
  createReadGateCoordinator,
  type ReadGateCoordinator,
  type ReadGateSnapshotEntry,
} from "../../../concurrency/read-gates.ts";
import type { CapabilityHandler, CapabilityInput } from "../../contract.ts";
import {
  defaultLoadHandler,
  defaultLoadItemRenderer,
  type HandlerLoader,
  type ItemRendererLoader,
} from "../generated-code.ts";
import type { CapabilityRouterDeps } from "../router.ts";
import {
  BOOK_AUTHOR,
  BUTLER,
  LE_GUIN,
  linkedNotesDesk,
  notes,
  routerApp,
  saveBody,
  seedNote,
} from "./router.links.test-support.ts";

export { BOOK_AUTHOR };
export const MEMO_SUBJECT: Relation = {
  field: "subject",
  to: { capability: "books", incarnation: BOOKS_INCARNATION, field: "author" },
};
export const BOOKS_GATE = { capabilityId: "books", incarnationId: BOOKS_INCARNATION };
const AUTHORS_PATH = deskRow(AUTHORS).artifacts_path;

export const NOTE_LE_GUIN = "0a0a0a0a-0000-4000-8000-000000000001";
export const NOTE_BUTLER = "0a0a0a0a-0000-4000-8000-000000000002";
export const NOTE_TYPED = "0a0a0a0a-0000-4000-8000-000000000003";

/** Every linked field's text as the desk is seeded, by table and record. */
export const BEFORE = () => ({
  notes: {
    [NOTE_LE_GUIN]: "Ursula K. Le Guin",
    [NOTE_BUTLER]: "Octavia E. Butler",
    [NOTE_TYPED]: "Ursula K. Le Guin",
  },
  books: { "book-1": "Ursula K. Le Guin", "book-2": "Octavia E. Butler" },
  memos: { "memo-1": "Ursula K. Le Guin" },
});

/** The desk, linked and seeded: a note typed and two linked, two linked books, a linked memo. */
export function authorsDesk() {
  const env = linkedNotesDesk();
  const { conns } = env;
  storeRelations(conns, "books", [BOOK_AUTHOR]);
  storeRelations(conns, "memos", [MEMO_SUBJECT]);
  seedNote(conns, NOTE_LE_GUIN, "Ursula K. Le Guin", LE_GUIN);
  seedNote(conns, NOTE_BUTLER, "Octavia E. Butler", BUTLER);
  seedNote(conns, NOTE_TYPED, "Ursula K. Le Guin");
  seed(conns, "books", "author", "book-1", "Ursula K. Le Guin", {
    capability: "authors",
    record: LE_GUIN,
  });
  seed(conns, "books", "author", "book-2", "Octavia E. Butler", {
    capability: "authors",
    record: BUTLER,
  });
  seed(conns, "memos", "subject", "memo-1", "Ursula K. Le Guin", {
    capability: "books",
    record: "book-1",
  });
  return { ...env, desk: deskOver(conns) };
}

function seed(
  conns: PlatformDatabase,
  capability: string,
  field: string,
  id: string,
  text: string,
  target: { readonly capability: string; readonly record: string },
): void {
  conns.readwrite.run(`INSERT INTO "cap_${capability}" ("id", "${field}") VALUES (?, ?)`, [
    id,
    text,
  ]);
  const incarnation = target.capability === "books" ? BOOKS_INCARNATION : AUTHORS_INCARNATION;
  writeLinkRow(conns.readwrite, { capability, record: id, field }, { ...target, incarnation });
}

/** Authors' Handlers as a build writes them, each doing `during` before it writes. */
export function authorHandlers(during: () => void = () => {}): Record<string, CapabilityHandler> {
  const update = async (context: {
    input: CapabilityInput;
    mutation: { update(values: Record<string, unknown>): unknown };
    present(record: unknown): string;
  }) => {
    during();
    const { input } = context;
    const values = Object.fromEntries(
      [...input.submittedFields].map((field) => [field, input.values[field] ?? null]),
    );
    return context.present(context.mutation.update(values));
  };
  const remove = async (context: { mutation: { delete(): void } }) => {
    during();
    context.mutation.delete();
    return "<p>That author is gone.</p>";
  };
  return {
    update: update as unknown as CapabilityHandler,
    delete: remove as unknown as CapabilityHandler,
  };
}

/** Authors' Handlers, the one for `action` failing once its work is done. */
export function failingAfterWork(action: "update" | "delete"): Record<string, CapabilityHandler> {
  const handlers = authorHandlers();
  const work = handlers[action] as unknown as (context: unknown) => Promise<string>;
  const failing = async (context: unknown) => {
    await work(context);
    throw new Error("the Handler broke after its work");
  };
  return { ...handlers, [action]: failing as unknown as CapabilityHandler };
}

function readers(snapshot: readonly ReadGateSnapshotEntry[]): Record<string, number> {
  return Object.fromEntries(snapshot.map((entry) => [entry.capabilityId, entry.readerCount]));
}

/** What a test does on the desk over `conns`. */
function deskOver(conns: PlatformDatabase) {
  const texts = (table: string, field: string): Record<string, unknown> => {
    const rows = conns.readonly
      .query(`SELECT "id", "${field}" AS "text" FROM "${table}"`)
      .all() as {
      id: string;
      text: unknown;
    }[];
    return Object.fromEntries(rows.map(({ id, text }) => [id, text]));
  };
  /** The router with Authors' Handlers beside the notes fixture's own. */
  const app = (deps: CapabilityRouterDeps = {}, handlers = authorHandlers()) => {
    const loadHandler: HandlerLoader = async (path, action) => {
      if (path !== AUTHORS_PATH) return defaultLoadHandler(path, action);
      const handler = handlers[action];
      if (!handler) throw new Error(`Authors has no ${action} Handler here`);
      return handler;
    };
    const loadItemRenderer: ItemRendererLoader = async (path) =>
      path === AUTHORS_PATH
        ? (record) => `<span>${String(record.name)}</span>`
        : defaultLoadItemRenderer(path);
    return routerApp(conns, { loadHandler, loadItemRenderer, ...deps });
  };
  /** An edit of one author's fields, as its form posts it. */
  const editAuthor = (
    author: string,
    values: Readonly<Record<string, string>>,
    deps?: CapabilityRouterDeps,
    handlers?: Record<string, CapabilityHandler>,
  ) =>
    app(deps, handlers).request(
      capabilityActionUrl("authors", "update"),
      saveBody({ [RECORD_ID_FIELD]: author, ...values }, {}, Object.keys(values)),
    );
  return {
    texts,
    app,
    editAuthor,
    /** Every linked field's text on the desk, by table and record. */
    linkedTexts: () => ({
      notes: Object.fromEntries(notes(conns).map(({ id, text }) => [id, text])),
      books: texts("cap_books", "author"),
      memos: texts("cap_memos", "subject"),
    }),
    rename: (
      author: string,
      name: string,
      deps?: CapabilityRouterDeps,
      handlers?: Record<string, CapabilityHandler>,
    ) => editAuthor(author, { name }, deps, handlers),
    deleteAuthor: (
      author: string,
      deps?: CapabilityRouterDeps,
      handlers?: Record<string, CapabilityHandler>,
    ) =>
      app(deps, handlers).request(
        capabilityActionUrl("authors", "delete"),
        saveBody({ [RECORD_ID_FIELD]: author }, {}, []),
      ),
    /** A read-gate coordinator that has seen the whole desk. */
    gates: (): ReadGateCoordinator => {
      const readGates = createReadGateCoordinator();
      readGates.synchronizeCatalog(
        readActiveRegistryCatalog(conns.readonly).capabilities.map(capabilityIncarnation),
      );
      return readGates;
    },
    /** Each capability's reader count on `readGates`, by id. */
    readers: (readGates: ReadGateCoordinator) => readers(readGates.snapshot()),
  };
}
