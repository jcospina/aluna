// A pick remembers the record it came from: a create posting the text and a pick through the
// real router, against the link-control desk's seeded authors.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { PICKED_RECORD_ATTRIBUTE } from "#shell/core/shell-dom.js";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { pickAgainLine } from "../../../../presentation/controls/link/link-copy.ts";
import { FIFTH_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import {
  ALUNA_RESERVED_FIELD_PREFIX,
  BEHAVIORAL_ERROR_MARKERS,
  PICK_NOT_FOUND_ERROR_CODE,
  readActiveRegistryCatalog,
} from "../../../../registry/index.ts";
import { escapeHtml } from "../../../../server/http/html.ts";
import { storeRelations } from "../../../../server/routes/lifecycle/link.test-support.ts";
import { MutationCoordinator } from "../../../concurrency/mutation-coordinator.ts";
import {
  capabilityIncarnation,
  createReadGateCoordinator,
} from "../../../concurrency/read-gates.ts";
import type { CapabilityInput } from "../../contract.ts";
import { READ_UNAVAILABLE_ERROR_CODE } from "../../wire/failure-responses.ts";
import { makeSpyLoader, teardownRouterTest } from "../router.test-support.ts";
import {
  BUTLER,
  failingAfterWork,
  linkedNotesDesk,
  linkRows,
  noteLink,
  notes,
  routerApp,
  SANDERSON,
  saveBody,
  TEXT_TO_NAME,
  watchingInput,
} from "./router.links.test-support.ts";

const CREATE = capabilityActionUrl("notes", "create");

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = linkedNotesDesk());
});

afterEach(() => teardownRouterTest(dir, conns));

/** A new note as its form posts it: the text, Pinned left unticked, and the text's pick. */
function newNote(text: string, author?: string): RequestInit {
  return saveBody({ text }, author === undefined ? {} : { text: author }, ["text", "pinned"]);
}

/** The one note a create wrote. */
function created(): string {
  const [note] = notes(conns);
  if (!note) throw new Error("the create stored no note");
  return note.id;
}

/** The refusal a body carries: its code, the fields it names, and its sentence. */
function refusalIn(html: string) {
  const { code_attribute, fields_attribute } = BEHAVIORAL_ERROR_MARKERS;
  return {
    code: new RegExp(`${code_attribute}="([^"]*)"`).exec(html)?.[1],
    fields: new RegExp(`${fields_attribute}="([^"]*)"`).exec(html)?.[1],
    sentence: />([^<]*)<\/p>/.exec(html)?.[1],
  };
}

describe("a valid pick", () => {
  test("writes its link row with the record, and the card it returns carries the pick", async () => {
    const response = await routerApp(conns).request(
      CREATE,
      newNote("Brandon Sanderson", SANDERSON),
    );
    expect(response.status).toBe(200);
    const id = created();
    expect(notes(conns)).toEqual([{ id, text: "Brandon Sanderson" }]);
    expect(linkRows(conns)).toEqual([noteLink(id, SANDERSON)]);
    // The card's Edit form was drawn inside the save, before the row was committed.
    expect(await response.text()).toContain(`${PICKED_RECORD_ATTRIBUTE}="${SANDERSON}"`);
  });

  test("goes with its record when the Handler fails after the create", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const failing = failingAfterWork();
    const response = await routerApp(conns, { loadHandler: failing }).request(
      CREATE,
      newNote("Brandon Sanderson", SANDERSON),
    );
    quiet.mockRestore();
    expect(response.status).toBe(500);
    expect(notes(conns)).toEqual([]);
    expect(linkRows(conns)).toEqual([]);
  });

  test("never reaches the Handler's input, which holds the text alone", async () => {
    const seen: CapabilityInput[] = [];
    const watching = watchingInput(seen);
    const response = await routerApp(conns, { loadHandler: watching }).request(
      CREATE,
      newNote("Brandon Sanderson", SANDERSON),
    );
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.values).toEqual({ text: "Brandon Sanderson" });
    expect([...(seen[0]?.submittedFields ?? [])]).toEqual(["text", "pinned"]);
  });
});

describe("a pick naming no record", () => {
  const refused = async (id: string, deps = {}) => {
    const spy = makeSpyLoader();
    const response = await routerApp(conns, { loadHandler: spy.loadHandler, ...deps }).request(
      CREATE,
      newNote("Brandon Sanderson", id),
    );
    return { response, html: await response.text(), loads: spy.calls };
  };

  test("a forged id is refused before any Handler loads, and the field asks for a new pick", async () => {
    const { response, html, loads } = await refused("made-up");
    expect(response.status).toBe(422);
    expect(loads).toEqual([]);
    expect(refusalIn(html)).toEqual({
      code: PICK_NOT_FOUND_ERROR_CODE,
      fields: "text",
      sentence: escapeHtml(pickAgainLine(["author"])),
    });
    expect(notes(conns)).toEqual([]);
    expect(linkRows(conns)).toEqual([]);
  });

  test("a stale id, its record deleted while the form was open, is refused the same way", async () => {
    conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [BUTLER]);
    const { response, html, loads } = await refused(BUTLER);
    expect(response.status).toBe(422);
    expect(loads).toEqual([]);
    expect(refusalIn(html).code).toBe(PICK_NOT_FOUND_ERROR_CODE);
    expect(notes(conns)).toEqual([]);
  });

  test("is checked again inside the save, after the first check passed", async () => {
    // The record goes between the router's first check and the save's transaction, as a delete
    // committing in between would take it.
    const writes = conns.readwrite;
    class Racing extends MutationCoordinator {
      override tryAcquireRecordWrite() {
        writes.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
        return super.tryAcquireRecordWrite();
      }
    }
    const { response, html, loads } = await refused(SANDERSON, {
      mutationCoordinator: new Racing(),
    });
    expect(response.status).toBe(422);
    expect(refusalIn(html).code).toBe(PICK_NOT_FOUND_ERROR_CODE);
    expect(loads).toEqual([]);
    expect(notes(conns)).toEqual([]);
  });
});

describe("the marker in the protocol", () => {
  const posted = async (init: RequestInit) => {
    const spy = makeSpyLoader();
    const response = await routerApp(conns, { loadHandler: spy.loadHandler }).request(CREATE, init);
    return { status: response.status, loads: spy.calls };
  };

  test("an unknown reserved key is still a protocol error", async () => {
    const unknown = `${ALUNA_RESERVED_FIELD_PREFIX}links`;
    const init = saveBody({ text: "Kindred", [unknown]: "x" }, {}, ["text", "pinned"]);
    expect(await posted(init)).toEqual({ status: 400, loads: [] });
  });

  test("a pick for a field holding no text is a protocol error", async () => {
    expect(await posted(newNote("", SANDERSON))).toEqual({ status: 400, loads: [] });
    expect(await posted(newNote("  ", SANDERSON))).toEqual({ status: 400, loads: [] });
  });

  test("a pick for a field the form did not submit is a protocol error", async () => {
    const init = saveBody({}, { text: SANDERSON }, ["pinned"]);
    expect(await posted(init)).toEqual({ status: 400, loads: [] });
  });

  test("a pick for a field whose relation is gone is dropped, and the text saves as text", async () => {
    storeRelations(conns, "notes", []);
    const response = await routerApp(conns).request(
      CREATE,
      newNote("Brandon Sanderson", "made-up"),
    );
    expect(response.status).toBe(200);
    expect(notes(conns).map((note) => note.text)).toEqual(["Brandon Sanderson"]);
    expect(linkRows(conns)).toEqual([]);
  });

  test("a pick for a field whose relation is dormant is dropped too", async () => {
    // Pinned to a lifetime of Authors that is not the one on the desk.
    const to = { ...TEXT_TO_NAME.to, incarnation: FIFTH_INCARNATION_ID };
    storeRelations(conns, "notes", [{ ...TEXT_TO_NAME, to }]);
    const response = await routerApp(conns).request(
      CREATE,
      newNote("Brandon Sanderson", "made-up"),
    );
    expect(response.status).toBe(200);
    expect(linkRows(conns)).toEqual([]);
  });
});

describe("a relation removed after the request was admitted", () => {
  test("takes its pick with it: the text saves, and no row is written", async () => {
    // An Unlink committing between the router's read of the desk and the save's transaction.
    class Unlinking extends MutationCoordinator {
      override tryAcquireRecordWrite() {
        storeRelations(conns, "notes", []);
        return super.tryAcquireRecordWrite();
      }
    }
    const app = routerApp(conns, { mutationCoordinator: new Unlinking() });
    const response = await app.request(CREATE, newNote("Brandon Sanderson", SANDERSON));
    expect(response.status).toBe(200);
    expect(notes(conns).map((note) => note.text)).toEqual(["Brandon Sanderson"]);
    expect(linkRows(conns)).toEqual([]);
  });
});

describe("the target's read token", () => {
  test("a save holds its pick's target, so it is refused while the target closes", async () => {
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog(
      readActiveRegistryCatalog(conns.readonly).capabilities.map(capabilityIncarnation),
    );
    await readGates.closeAndDrain({
      capabilityId: TEXT_TO_NAME.to.capability,
      incarnationId: TEXT_TO_NAME.to.incarnation,
    });
    const app = routerApp(conns, { readGates });
    const picked = await app.request(CREATE, newNote("Kindred", BUTLER));
    expect(picked.status).toBe(422);
    expect(refusalIn(await picked.text()).code).toBe(READ_UNAVAILABLE_ERROR_CODE);
    expect(notes(conns)).toEqual([]);

    const typed = await app.request(CREATE, newNote("Kindred"));
    expect(typed.status).toBe(200);
    expect(notes(conns).map((note) => note.text)).toEqual(["Kindred"]);
  });
});
