// What the linked-text refresh meets around a save: a link made, or an evolution
// committed, after the save read the desk and before its transaction, and an Edit form drawn
// before its field was linked, whose text the refresh may since have moved. A save that read the
// desk before an activation woke or put to sleep its own relation settles on the
// desk its transaction finds.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LINK_MARK_CHAIN } from "#shell/controls/listbox-glyphs.js";
import { capabilityActionUrl, capabilityPickUrl } from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { LINK_TABLE } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../../platform/persistence/table-names.ts";
import {
  type ActiveCatalogReader,
  FORM_CHANGED_ERROR_CODE,
  getCapability,
  listCapabilities,
  readActiveRegistryCatalog,
} from "../../../../registry/index.ts";
import {
  noticeCode,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { applyRelationWork, relationDiff } from "../../../data/index.ts";
import { teardownRouterTest } from "../router.test-support.ts";
import { authorsDesk, BOOK_AUTHOR, NOTE_LE_GUIN } from "./router.links.refresh.test-support.ts";
import {
  BUTLER,
  LE_GUIN,
  linkRows,
  noteLink,
  notes,
  recordAddressView,
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
      const change = {
        kind: "link",
        source: books,
        target: authors,
        relation: BOOK_AUTHOR,
      } as const;
      if (!applyRelationWork(conns.readwrite, relationDiff(change))) {
        throw new Error("the link was refused");
      }
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

describe("a save that read the desk before an activation", () => {
  /** An activation of one capability drawing `longText` as long text, and the relation diff's work. */
  const activate = (capability: string, longText: readonly string[]) => () => {
    conns.readwrite.transaction(() => {
      const before = listCapabilities(conns.readwrite);
      conns.readwrite
        .query(
          `UPDATE ${REGISTRY_TABLE} SET version = version + 1,
             ui_intent = json_set(ui_intent, '$.form.long_text', json(?)) WHERE id = ?`,
        )
        .run(JSON.stringify(longText), capability);
      const after = listCapabilities(conns.readwrite);
      applyRelationWork(conns.readwrite, relationDiff({ kind: "activation", before, after }));
    })();
  };
  /** Authors' name drawn as long text, which puts every relation pointing at it to sleep, or not. */
  const activateAuthors = (nameIsLong: boolean) =>
    activate("authors", nameIsLong ? ["name", "bio"] : ["bio"]);
  const editNote = (
    text: string,
    picks: Readonly<Record<string, string>>,
    activation: () => void,
  ) =>
    routerApp(conns, { readActiveCatalog: changingAfterRead(activation) }).request(
      capabilityActionUrl("notes", "update"),
      saveBody({ [RECORD_ID_FIELD]: NOTE_LE_GUIN, text }, picks, ["text"]),
    );
  const noteText = () => notes(conns).find(({ id }) => id === NOTE_LE_GUIN)?.text;
  const noteLinks = () => linkRows(conns).filter((row) => row.source_record === NOTE_LE_GUIN);
  /** The note's form as its address draws it now; no card carries a form to draw it in. */
  const drawnForm = () => recordAddressView(routerApp(conns), "notes", NOTE_LE_GUIN);

  test("finds the relation woken since: a form drawn while it slept cannot undo the revival", async () => {
    activateAuthors(true)();
    conns.readwrite.run('UPDATE "cap_authors" SET "name" = ? WHERE "id" = ?', [
      "Ursula Le Guin",
      LE_GUIN,
    ]);

    const response = await editNote("Ursula K. Le Guin", {}, activateAuthors(false));

    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe(FORM_CHANGED_ERROR_CODE);
    expect(noteText()).toBe("Ursula Le Guin");
    expect(noteLinks()).toEqual([noteLink(NOTE_LE_GUIN, LE_GUIN)]);
  });

  test("finds the relation woken since: a form holding the record's text saves, drawn linked", async () => {
    activateAuthors(true)();
    const response = await editNote("Ursula K. Le Guin", {}, activateAuthors(false));

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(LINK_MARK_CHAIN);
    expect(await drawnForm()).toContain(capabilityPickUrl("notes", "text"));
    expect(noteLinks()).toEqual([noteLink(NOTE_LE_GUIN, LE_GUIN)]);
  });

  test("finds its own field put to sleep by its activation since, and draws it plain", async () => {
    const response = await editNote(
      "Octavia E. Butler",
      { text: BUTLER },
      activate("notes", ["text"]),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(LINK_MARK_CHAIN);
    expect(await drawnForm()).not.toContain(capabilityPickUrl("notes", "text"));
    expect(noteLinks()).toEqual([]);
  });

  test("finds the relation put to sleep since: the pick is dropped, the text saves as typed", async () => {
    const response = await editNote("Octavia E. Butler", { text: BUTLER }, activateAuthors(true));

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(LINK_MARK_CHAIN);
    expect(await drawnForm()).not.toContain(capabilityPickUrl("notes", "text"));
    expect(noteText()).toBe("Octavia E. Butler");
    expect(noteLinks()).toEqual([]);
  });
});
