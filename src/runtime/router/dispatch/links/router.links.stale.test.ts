// What the linked-text refresh meets around a save: a link made, or an evolution
// committed, after the save read the desk and before its transaction, and an Edit form drawn
// before its field was linked, whose text the refresh may since have moved.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { matchTypedNames } from "../../../../lifecycle/link/matching/matching-scan.ts";
import { LINK_TABLE } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../../platform/persistence/table-names.ts";
import {
  type ActiveCatalogReader,
  addCapabilityRelation,
  FORM_CHANGED_ERROR_CODE,
  getCapability,
  readActiveRegistryCatalog,
} from "../../../../registry/index.ts";
import {
  noticeCode,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { teardownRouterTest } from "../router.test-support.ts";
import { authorsDesk, BOOK_AUTHOR, NOTE_LE_GUIN } from "./router.links.refresh.test-support.ts";
import {
  LE_GUIN,
  linkRows,
  noteLink,
  notes,
  routerApp,
  saveBody,
} from "./router.links.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let desk: ReturnType<typeof authorsDesk>["desk"];

beforeEach(() => {
  ({ dir, conns, desk } = authorsDesk());
});

afterEach(() => teardownRouterTest(dir, conns));

/** A catalog reader that reads the desk, then commits `change` once, after the read. */
function changingAfterRead(change: () => void): ActiveCatalogReader {
  let changed = false;
  return (database) => {
    const read = readActiveRegistryCatalog(database);
    if (!changed) {
      changed = true;
      change();
    }
    return read;
  };
}

describe("a rename that read the desk before", () => {
  test("a link made since still takes the new name", async () => {
    storeRelations(conns, "books", []);
    conns.readwrite.run(`DELETE FROM ${LINK_TABLE} WHERE source_capability = 'books'`);
    const link = () => {
      const books = getCapability("books", conns.readwrite);
      const authors = getCapability("authors", conns.readwrite);
      if (!books || !authors) throw new Error("the desk is missing a capability");
      const expectation = {
        capabilityId: books.id,
        incarnationId: books.incarnation_id,
        version: books.version,
        relations: books.relations,
      };
      conns.readwrite.transaction(() => {
        const row = addCapabilityRelation(expectation, BOOK_AUTHOR, conns.readwrite);
        if (!row) throw new Error("the link was refused");
        matchTypedNames(conns.readwrite, row, authors, BOOK_AUTHOR);
      })();
    };
    const deps = { readActiveCatalog: changingAfterRead(link) };
    expect((await desk.rename(LE_GUIN, "Ursula Le Guin", deps)).status).toBe(200);
    expect(desk.linkedTexts().books["book-1"]).toBe("Ursula Le Guin");
    expect(desk.linkedTexts().memos["memo-1"]).toBe("Ursula Le Guin");
  });

  test("an evolution since that put a link to sleep writes nothing past its field's limit", async () => {
    const limited = 80;
    const evolve = () => {
      const books = getCapability("books", conns.readwrite);
      if (!books) throw new Error("Books is not on the desk");
      const fields = books.schema.fields.map((field) =>
        field.name === "author" ? { ...field, max_length: limited } : field,
      );
      conns.readwrite
        .query(`UPDATE ${REGISTRY_TABLE} SET schema = ?, version = version + 1 WHERE id = 'books'`)
        .run(JSON.stringify({ ...books.schema, fields }));
    };
    const longer = `Ursula Kroeber Le Guin ${"x".repeat(limited)}`;
    const deps = { readActiveCatalog: changingAfterRead(evolve) };
    expect((await desk.rename(LE_GUIN, longer, deps)).status).toBe(200);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBe(longer);
    expect(desk.linkedTexts().books["book-1"]).toBe("Ursula K. Le Guin");
  });
});

describe("an Edit form", () => {
  /** The note's edit as a form posts it, with the pick or the marker its form drew, if any. */
  const editNote = (text: string, picks: Readonly<Record<string, string>> = {}) =>
    routerApp(conns).request(
      capabilityActionUrl("notes", "update"),
      saveBody({ [RECORD_ID_FIELD]: NOTE_LE_GUIN, text }, picks, ["text"]),
    );
  const noteText = () => notes(conns).find(({ id }) => id === NOTE_LE_GUIN)?.text;
  const noteLinked = () => linkRows(conns).some((row) => row.source_record === NOTE_LE_GUIN);

  beforeEach(async () => {
    expect((await desk.rename(LE_GUIN, "Ursula Le Guin")).status).toBe(200);
    expect(noteText()).toBe("Ursula Le Guin");
  });

  test("drawn before its field was linked cannot write the old name back", async () => {
    const response = await editNote("Ursula K. Le Guin");
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe(FORM_CHANGED_ERROR_CODE);
    expect(noteText()).toBe("Ursula Le Guin");
    expect(linkRows(conns)).toContainEqual(noteLink(NOTE_LE_GUIN, LE_GUIN));
  });

  test("drawn before its field was linked cannot write back a name that differs only in case", async () => {
    const response = await editNote("ursula le guin");
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe(FORM_CHANGED_ERROR_CODE);
    expect(noteText()).toBe("Ursula Le Guin");
    expect(noteLinked()).toBe(true);
  });

  test("drawn before its field was linked saves when the field holds what the record does", async () => {
    expect((await editNote("Ursula Le Guin")).status).toBe(200);
    expect(noteLinked()).toBe(true);
  });

  test("that drew its field linked and picks nothing saves other text as plain text", async () => {
    expect((await editNote("Someone else", { text: "" })).status).toBe(200);
    expect(noteText()).toBe("Someone else");
    expect(noteLinked()).toBe(false);
  });
});
