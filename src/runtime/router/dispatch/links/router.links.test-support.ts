// The notes fixture with its text linked to Authors · Name on the link-control desk, saved through
// the real router: what a linked field's form posts, and the link rows a save leaves. Not a test file.

import { linkFieldValue } from "#shell/core/shell-dom.js";
import { until } from "../../../../platform/async.test-support.ts";
import { LINK_TABLE, writeLinkRow } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import type { CapabilityRow, Relation } from "../../../../registry/index.ts";
import { createTestApp } from "../../../../server/isolated-app.test-support.ts";
import {
  AUTHORS_INCARNATION,
  installDesk,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import type { MutationCoordinator } from "../../../concurrency/mutation-coordinator.ts";
import type { CapabilityHandler, CapabilityInput } from "../../contract.ts";
import { ALUNA_LINK_MARKER, ALUNA_PRESENT_MARKER } from "../../wire/wire-protocol.ts";
import { defaultLoadHandler, type HandlerLoader } from "../generated-code.ts";
import { install, notesRow, setupRouterTest } from "../router.test-support.ts";
import type { CapabilityRouterDeps } from "../router.ts";

export const TEXT_TO_NAME: Relation = {
  field: "text",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

export const BOOK_AUTHOR: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

/** The seeded authors' ids, by name. */
export const LE_GUIN = "author-0";
export const BUTLER = "author-1";
export const SANDERSON = "author-2";

/** The desk, the notes fixture installed beside it, and its text linked unless told otherwise. */
export function linkedNotesDesk(
  relations: readonly Relation[] = [TEXT_TO_NAME],
  row: CapabilityRow = notesRow(),
) {
  const env = setupRouterTest();
  installDesk(env.conns);
  install(env.conns, row);
  storeRelations(env.conns, "notes", relations);
  return env;
}

/** The app over `conns`; a mutation coordinator in `deps` is the whole app's, as it is live. */
export function routerApp(conns: PlatformDatabase, deps: CapabilityRouterDeps = {}) {
  const { mutationCoordinator, ...router } = deps;
  return createTestApp({
    capabilityRouter: { databases: conns, ...router },
    ...(mutationCoordinator === undefined ? {} : { mutationCoordinator }),
  });
}

/** A save as a form posts it: each field's value, its presence marker, and each pick. */
export function saveBody(
  values: Readonly<Record<string, string>>,
  picks: Readonly<Record<string, string>> = {},
  present: readonly string[] = Object.keys(values),
): RequestInit {
  const body = new URLSearchParams(values);
  for (const field of present) body.append(ALUNA_PRESENT_MARKER, field);
  for (const [field, id] of Object.entries(picks)) {
    body.append(ALUNA_LINK_MARKER, linkFieldValue(field, id));
  }
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "HX-Request": "true" },
    body: body.toString(),
  };
}

export interface StoredLink {
  readonly source_capability: string;
  readonly source_record: string;
  readonly source_field: string;
  readonly target_capability: string;
  readonly target_incarnation: string;
  readonly target_record: string;
}

/** The link row of the one book `seedLinkedBook` seeds, which picked Le Guin. */
export const BOOK_LINK: StoredLink = {
  source_capability: "books",
  source_record: "book-1",
  source_field: "author",
  target_capability: "authors",
  target_incarnation: AUTHORS_INCARNATION,
  target_record: LE_GUIN,
};

/** Books' author linked to Authors · Name beside the notes, and one book that picked Le Guin. */
export function seedLinkedBook(conns: PlatformDatabase): void {
  storeRelations(conns, "books", [BOOK_AUTHOR]);
  conns.readwrite.run('INSERT INTO "cap_books" ("id", "author") VALUES (?, ?)', [
    BOOK_LINK.source_record,
    "Ursula K. Le Guin",
  ]);
  writeLinkRow(
    conns.readwrite,
    { capability: "books", record: BOOK_LINK.source_record, field: "author" },
    { capability: "authors", incarnation: AUTHORS_INCARNATION, record: LE_GUIN },
  );
}

/** Until a platform write waits its turn in the queue, behind whatever `coordinator` holds. */
export function queuedPlatformWrite(coordinator: MutationCoordinator): Promise<void> {
  return until(() => coordinator.snapshot().queuedTickets.some(({ kind }) => kind === "platform"));
}

/** Every link row, in a stable order. */
export function linkRows(conns: PlatformDatabase): StoredLink[] {
  return conns.readonly
    .query(`SELECT * FROM ${LINK_TABLE} ORDER BY source_record, source_field`)
    .all() as StoredLink[];
}

/** The link row a note's text holds when it picked `author`. */
export function noteLink(note: string, author: string): StoredLink {
  return {
    source_capability: "notes",
    source_record: note,
    source_field: "text",
    target_capability: "authors",
    target_incarnation: AUTHORS_INCARNATION,
    target_record: author,
  };
}

export function notes(conns: PlatformDatabase): { id: string; text: string | null }[] {
  return conns.readonly.query('SELECT "id", "text" FROM "cap_notes" ORDER BY "id"').all() as {
    id: string;
    text: string | null;
  }[];
}

/** A note stored as a create leaves one, picking `author` when it names one. */
export function seedNote(conns: PlatformDatabase, id: string, text: string, author?: string): void {
  conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text") VALUES (?, ?)', [id, text]);
  if (author === undefined) return;
  writeLinkRow(
    conns.readwrite,
    { capability: "notes", record: id, field: "text" },
    { capability: "authors", incarnation: AUTHORS_INCARNATION, record: author },
  );
}

/** The fixture's own Handlers, each doing its work and then `after` with what it was handed. */
function wrapped(after: (context: { input: CapabilityInput }) => void): HandlerLoader {
  return async (path, action) => {
    const handler = (await defaultLoadHandler(path, action)) as (
      context: unknown,
    ) => Promise<string>;
    const run = async (context: { input: CapabilityInput }) => {
      const fragment = await handler(context);
      after(context);
      return fragment;
    };
    return run as unknown as CapabilityHandler;
  };
}

/** The fixture's own Handlers, each failing once its work is done. */
export function failingAfterWork(): HandlerLoader {
  return wrapped(() => {
    throw new Error("the Handler broke after its work");
  });
}

/** The fixture's own Handlers, each keeping the input it was handed in `seen`. */
export function watchingInput(seen: CapabilityInput[]): HandlerLoader {
  return wrapped((context) => {
    seen.push(context.input);
  });
}
