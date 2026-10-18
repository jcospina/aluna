// What an edit and a delete do to a record's link rows: the Edit form posts its pick again,
// so changing another field keeps the link; a submitted linked field without a pick loses it once
// its text changes or its record is gone; a form draws no pick whose record is gone, and refuses
// one that went while it was open; a dormant relation's row sleeps until its text changes; and a
// deleted record takes every row it holds as a source with it.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { PICKED_RECORD_ATTRIBUTE, RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { LINK_TABLE } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { FIFTH_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import { storeRelations } from "../../../../server/routes/lifecycle/link.test-support.ts";
import type { HandlerLoader } from "../generated-code.ts";
import { makeSpyLoader, notesRow, notesSpec, teardownRouterTest } from "../router.test-support.ts";
import {
  BUTLER,
  failingAfterWork,
  LE_GUIN,
  linkedNotesDesk,
  linkRows,
  noteLink,
  notes,
  recordAddressView,
  routerApp,
  SANDERSON,
  saveBody,
  seedNote,
  TEXT_TO_NAME,
} from "./router.links.test-support.ts";

const UPDATE = capabilityActionUrl("notes", "update");
/** Two notes, each with an id the record address takes. */
const NOTE_ONE = "0a0a0a0a-0000-4000-8000-000000000001";
const NOTE_TWO = "0a0a0a0a-0000-4000-8000-000000000002";

/** Notes whose text may be left empty, so an emptied linked field saves. */
const optionalText = () => {
  const spec = notesSpec();
  const fields = spec.schema.fields.map((field) => ({ ...field, required: false }));
  return notesRow({ schema: { fields }, behavioral_errors: [] });
};

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = linkedNotesDesk(undefined, optionalText()));
  seedNote(conns, NOTE_ONE, "Brandon Sanderson", SANDERSON);
  seedNote(conns, NOTE_TWO, "Octavia E. Butler", BUTLER);
});

afterEach(() => teardownRouterTest(dir, conns));

/** An edit of the first note as its form posts it. */
function edit(
  values: Readonly<Record<string, string>>,
  picks: Readonly<Record<string, string>> = {},
  present: readonly string[] = Object.keys(values),
) {
  return routerApp(conns).request(
    UPDATE,
    saveBody({ [RECORD_ID_FIELD]: NOTE_ONE, ...values }, picks, present),
  );
}

describe("an edit", () => {
  test("that changes another field posts the pick again, and the link row stays", async () => {
    const response = await edit({ text: "Brandon Sanderson", pinned: "on" }, { text: SANDERSON });
    expect(response.status).toBe(200);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
    // The card it answers with carries no form; the record's address draws the pick again.
    expect(await response.text()).not.toContain(PICKED_RECORD_ATTRIBUTE);
    expect(await recordAddressView(routerApp(conns), "notes", NOTE_ONE)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${SANDERSON}"`,
    );
  });

  test("from a form that posts no pick keeps the row while the text stands", async () => {
    // A form drawn before the link existed, or one the field was linked in, posts no pick.
    const response = await edit({ text: "Brandon Sanderson", pinned: "on" });
    expect(response.status).toBe(200);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });

  test("that leaves the linked field out of the form keeps its row", async () => {
    const response = await edit({ pinned: "on" });
    expect(response.status).toBe(200);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });

  test("with a new pick points the row at it", async () => {
    const response = await edit({ text: "Ursula K. Le Guin" }, { text: LE_GUIN });
    expect(response.status).toBe(200);
    expect(notes(conns)[0]).toEqual({ id: NOTE_ONE, text: "Ursula K. Le Guin" });
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, LE_GUIN), noteLink(NOTE_TWO, BUTLER)]);
  });

  test("that empties the linked field loses its row", async () => {
    // The dropdown posts its marker with no record once it picks none.
    const response = await edit({ text: "" }, { text: "" });
    expect(response.status).toBe(200);
    expect(notes(conns)[0]).toEqual({ id: NOTE_ONE, text: null });
    expect(linkRows(conns)).toEqual([noteLink(NOTE_TWO, BUTLER)]);
  });

  test("with other text and no pick still saves the text, and loses its row", async () => {
    const response = await edit({ text: "Someone typed this" }, { text: "" });
    expect(response.status).toBe(200);
    expect(notes(conns)[0]).toEqual({ id: NOTE_ONE, text: "Someone typed this" });
    expect(linkRows(conns)).toEqual([noteLink(NOTE_TWO, BUTLER)]);
  });

  test("that fails in its Handler leaves the row where it was", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const failing = failingAfterWork();
    const response = await routerApp(conns, { loadHandler: failing }).request(
      UPDATE,
      saveBody({ [RECORD_ID_FIELD]: NOTE_ONE, text: "Ursula K. Le Guin" }, { text: LE_GUIN }, [
        "text",
      ]),
    );
    quiet.mockRestore();
    expect(response.status).toBe(500);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });
});

describe("a pick whose record is gone", () => {
  test("is no pick of a form drawn after it went, and saving that form lets the link go", async () => {
    conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    const app = routerApp(conns);
    expect(await recordAddressView(app, "notes", NOTE_ONE)).not.toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${SANDERSON}"`,
    );
    expect(await recordAddressView(app, "notes", NOTE_TWO)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${BUTLER}"`,
    );
    const response = await edit({ text: "Brandon Sanderson", pinned: "on" });
    expect(response.status).toBe(200);
    expect(notes(conns)[0]).toEqual({ id: NOTE_ONE, text: "Brandon Sanderson" });
    expect(linkRows(conns)).toEqual([noteLink(NOTE_TWO, BUTLER)]);
  });

  test("drawn with the form and deleted while it was open, is refused", async () => {
    conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    const spy = makeSpyLoader();
    const body = saveBody(
      { [RECORD_ID_FIELD]: NOTE_ONE, text: "Brandon Sanderson", pinned: "on" },
      { text: SANDERSON },
      ["text", "pinned"],
    );
    const response = await routerApp(conns, { loadHandler: spy.loadHandler }).request(UPDATE, body);
    expect(response.status).toBe(422);
    expect(spy.calls).toEqual([]);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });

  test("picked anew in an edit is refused before any Handler loads", async () => {
    conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [BUTLER]);
    const spy = makeSpyLoader();
    const body = saveBody(
      { [RECORD_ID_FIELD]: NOTE_ONE, text: "Octavia E. Butler" },
      { text: BUTLER },
      ["text"],
    );
    const response = await routerApp(conns, { loadHandler: spy.loadHandler }).request(UPDATE, body);
    expect(response.status).toBe(422);
    expect(spy.calls).toEqual([]);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });
});

describe("a dormant relation", () => {
  beforeEach(() => {
    // Pinned to a lifetime of Authors that is not the one on the desk, so it holds no longer.
    const to = { ...TEXT_TO_NAME.to, incarnation: FIFTH_INCARNATION_ID };
    storeRelations(conns, "notes", [{ ...TEXT_TO_NAME, to }]);
  });

  test("keeps its row through an edit that leaves its text as it was", async () => {
    expect((await edit({ text: "Brandon Sanderson", pinned: "on" })).status).toBe(200);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });

  test("loses its row to an edit that changes its text, so a revival keeps what was typed", async () => {
    expect((await edit({ text: "Brandon Sanderson, signed" })).status).toBe(200);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_TWO, BUTLER)]);
  });
});

describe("a delete", () => {
  const remove = (loadHandler?: HandlerLoader) =>
    routerApp(conns, loadHandler ? { loadHandler } : {}).request(
      capabilityActionUrl("notes", "delete"),
      saveBody({ [RECORD_ID_FIELD]: NOTE_ONE }, {}, []),
    );

  test("takes every link row its record holds as a source, and no other", async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(notes(conns).map((note) => note.id)).toEqual([NOTE_TWO]);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_TWO, BUTLER)]);
  });

  test("that fails in its Handler keeps the record's rows, since they went in its savepoint", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const failing = failingAfterWork();
    const response = await remove(failing);
    quiet.mockRestore();
    expect(response.status).toBe(500);
    expect(linkRows(conns)).toEqual([noteLink(NOTE_ONE, SANDERSON), noteLink(NOTE_TWO, BUTLER)]);
  });
});

describe("a record's Edit form", () => {
  test("carries its pick at the record's own address, and no card in the collection carries one", async () => {
    const app = routerApp(conns);
    const read = await (await app.request(capabilityActionUrl("notes", "read"))).text();
    expect(read).not.toContain(PICKED_RECORD_ATTRIBUTE);
    expect(read).not.toContain("data-record-edit-form");
    expect(await recordAddressView(app, "notes", NOTE_ONE)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${SANDERSON}"`,
    );
    expect(await recordAddressView(app, "notes", NOTE_TWO)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${BUTLER}"`,
    );
  });

  test("carries no pick that points into another lifetime of the target", async () => {
    conns.readwrite.run(`UPDATE ${LINK_TABLE} SET target_incarnation = ? WHERE source_record = ?`, [
      FIFTH_INCARNATION_ID,
      NOTE_ONE,
    ]);
    const app = routerApp(conns);
    expect(await recordAddressView(app, "notes", NOTE_ONE)).not.toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${SANDERSON}"`,
    );
    expect(await recordAddressView(app, "notes", NOTE_TWO)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${BUTLER}"`,
    );
  });
});
