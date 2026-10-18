// Deleting a record others link to holds nothing up, through the real router on the link-control
// desk: Notes' required text and Books' optional author linked to Authors' name, Memos' subject to
// Books' author. Deleting an author clears every optional field linked to them and keeps every
// required one's text, with the mark, in the delete's transaction.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { capabilityActionUrl, capabilityPickUrl } from "#shell/core/routes.js";
import { PICKED_RECORD_ATTRIBUTE, RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import type { PickList } from "../../../../lifecycle/link/pick/pick.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { pickAgainLine, pickTargetMark } from "../../../../presentation/controls/link/link-copy.ts";
import { PICK_NOT_FOUND_ERROR_CODE } from "../../../../registry/index.ts";
import { escapeHtml } from "../../../../server/http/html.ts";
import { AUTHORS } from "../../../../server/routes/lifecycle/link.test-support.ts";
import { MutationCoordinator } from "../../../concurrency/mutation-coordinator.ts";
import type { CapabilityHandler } from "../../contract.ts";
import { MUTATION_BUSY_ERROR_CODE } from "../../wire/failure-responses.ts";
import { teardownRouterTest } from "../router.test-support.ts";
import {
  authorHandlers,
  authorsDesk,
  BEFORE,
  BOOKS_GATE,
  failingAfterWork,
  NOTE_BUTLER,
  NOTE_LE_GUIN,
  reshapeField,
} from "./router.links.refresh.test-support.ts";
import {
  BUTLER,
  changingAfterRead,
  LE_GUIN,
  linkRows,
  noteLink,
  notes,
  recordAddressView,
  refusalIn,
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

/** The desk once Le Guin is deleted: Books' author cleared, every required text kept. */
function afterLeGuin() {
  const before = BEFORE();
  return { ...before, books: { ...before.books, "book-1": null } };
}

/** The link rows naming Butler, all that stand once Le Guin and the links through her go. */
const BUTLERS_ROWS = () => [
  noteLink(NOTE_BUTLER, BUTLER),
  expect.objectContaining({ source_record: "book-2", target_record: BUTLER }),
];

const allGivenBack = (readers: Record<string, number>) =>
  Object.values(readers).every((count) => count === 0);

describe("deleting an author", () => {
  test("clears every optional field linked to them, keeps every required one's text, and deletes no record", async () => {
    const response = await desk.deleteAuthor(LE_GUIN);
    expect(response.status).toBe(200);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBeUndefined();
    expect(desk.linkedTexts()).toEqual(afterLeGuin());
  });

  test("lets go of every link row naming them, and of those through a field it cleared", async () => {
    await desk.deleteAuthor(LE_GUIN);
    expect(linkRows(conns)).toEqual(BUTLERS_ROWS());
  });

  test("leaves a required field's card marked, and its form drawn with the text and no pick", async () => {
    const app = routerApp(conns);
    const mark = pickTargetMark([AUTHORS.noun]);
    const marks = async () =>
      (await (await app.request(capabilityActionUrl("notes", "read"))).text()).split(mark).length;
    const before = await marks();
    expect(await recordAddressView(app, "notes", NOTE_LE_GUIN)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${LE_GUIN}"`,
    );
    await desk.deleteAuthor(LE_GUIN);
    expect(await marks()).toBe(before + 1);
    const form = await recordAddressView(app, "notes", NOTE_LE_GUIN);
    expect(form).toContain(`value="${BEFORE().notes[NOTE_LE_GUIN]}"`);
    expect(form).not.toContain(PICKED_RECORD_ATTRIBUTE);
    // The field asks for a pick when no record its list offers holds its text.
    const list = (await (await app.request(capabilityPickUrl("notes", "text"))).json()) as PickList;
    expect(list.records.map(({ text }) => text)).not.toContain(BEFORE().notes[NOTE_LE_GUIN]);
  });

  test("keeps a required Books author's name, and the memo stays linked to the book", async () => {
    reshapeField(conns, "books", "author", { required: true });
    expect((await desk.deleteAuthor(LE_GUIN)).status).toBe(200);
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns)).toEqual([
      ...BUTLERS_ROWS(),
      expect.objectContaining({ source_record: "memo-1", target_record: "book-1" }),
    ]);
  });

  test("keeps an optional field's text behind a dormant relation, and lets its rows go", async () => {
    // Shorter than Authors' name, so the relation no longer holds (rule 4).
    reshapeField(conns, "books", "author", { max_length: 80 });
    expect((await desk.deleteAuthor(LE_GUIN)).status).toBe(200);
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns).map(({ source_record }) => source_record)).toEqual([
      NOTE_BUTLER,
      "book-2",
      "memo-1",
    ]);
  });

  test("that fails leaves every linking record and link row as it was", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const rows = linkRows(conns);
    const response = await desk.deleteAuthor(LE_GUIN, {}, failingAfterWork("delete"));
    quiet.mockRestore();
    expect(response.status).toBe(500);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula K. Le Guin");
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns)).toEqual(rows);
  });
});

describe("a delete's lease and read tokens", () => {
  test("runs under the one lease it holds, with the token of each capability whose field it clears", async () => {
    const coordinator = new MutationCoordinator();
    const leases = {
      record: spyOn(coordinator, "tryAcquireRecordWrite"),
      platform: spyOn(coordinator, "withPlatformWrite"),
      deletion: spyOn(coordinator, "tryAcquireDeletion"),
      build: spyOn(coordinator, "reserveBuild"),
    };
    const readGates = desk.gates();
    const seen: { lease?: string; readers?: Record<string, number> } = {};
    const handlers = authorHandlers(() => {
      seen.lease = coordinator.snapshot().activeLease?.kind;
      seen.readers = desk.readers(readGates);
    });
    const deps = { mutationCoordinator: coordinator, readGates };
    expect((await desk.deleteAuthor(LE_GUIN, deps, handlers)).status).toBe(200);
    expect(desk.linkedTexts()).toEqual(afterLeGuin());
    expect(leases.record).toHaveBeenCalledTimes(1);
    const others = [leases.platform, leases.deletion, leases.build];
    expect(others.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect(seen.lease).toBe("record");
    expect(seen.readers).toMatchObject({ authors: 1, books: 1, memos: 0, notes: 0 });
    expect(allGivenBack(desk.readers(readGates))).toBe(true);
  });

  test("skips a linking capability its deletion has closed, and deletes at once", async () => {
    const readGates = desk.gates();
    const closing = await readGates.closeAndDrain(BOOKS_GATE);
    const response = await desk.deleteAuthor(LE_GUIN, { readGates });
    readGates.reopen(closing);
    expect(response.status).toBe(200);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBeUndefined();
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns).map(({ source_record }) => source_record)).toEqual([
      NOTE_BUTLER,
      "book-2",
      "memo-1",
    ]);
  });

  test("skips a linking capability whose deletion closes it during the delete", async () => {
    const readGates = desk.gates();
    let drained: Promise<unknown> | undefined;
    const handlers = authorHandlers(() => {
      drained = readGates.closeAndDrain(BOOKS_GATE);
    });
    expect((await desk.deleteAuthor(LE_GUIN, { readGates }, handlers)).status).toBe(200);
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(drained).toBeDefined();
    await drained;
  });

  test("clears a field an evolution made optional after admission, under a token taken then", async () => {
    const readGates = desk.gates();
    const seen: { readers?: Record<string, number> } = {};
    const handlers = authorHandlers(() => {
      seen.readers = desk.readers(readGates);
    });
    const evolve = () => reshapeField(conns, "notes", "text", { required: false });
    const deps = { readGates, readActiveCatalog: changingAfterRead(evolve) };
    expect((await desk.deleteAuthor(LE_GUIN, deps, handlers)).status).toBe(200);
    const expected = afterLeGuin();
    expect(desk.linkedTexts()).toEqual({
      ...expected,
      notes: { ...expected.notes, [NOTE_LE_GUIN]: null },
    });
    expect(seen.readers).toMatchObject({ books: 1, notes: 1 });
    expect(allGivenBack(desk.readers(readGates))).toBe(true);
  });

  test("keeps a field an evolution made required after admission", async () => {
    const evolve = () => reshapeField(conns, "books", "author", { required: true });
    const deps = { readActiveCatalog: changingAfterRead(evolve) };
    expect((await desk.deleteAuthor(LE_GUIN, deps)).status).toBe(200);
    expect(desk.linkedTexts()).toEqual(BEFORE());
  });
});

describe("the linking capabilities' tokens", () => {
  test("are taken by no create and no read of a record others link to", async () => {
    const readGates = desk.gates();
    const seen: Record<string, number>[] = [];
    const answer = async () => {
      seen.push(desk.readers(readGates));
      return "<p>Seen.</p>";
    };
    const handlers = { create: answer, read: answer } as unknown as Record<
      string,
      CapabilityHandler
    >;
    const app = desk.app({ readGates }, handlers);
    expect((await app.request(capabilityActionUrl("authors", "read"))).status).toBe(200);
    const created = saveBody({ name: "N. K. Jemisin" }, {}, ["name", "pen_name", "bio", "born"]);
    expect((await app.request(capabilityActionUrl("authors", "create"), created)).status).toBe(200);
    expect(seen).toHaveLength(2);
    for (const readers of seen) {
      expect(readers).toMatchObject({ authors: 1, books: 0, memos: 0, notes: 0 });
    }
  });

  test("leave a delete refused while a capability's deletion holds its lease, changing nothing", async () => {
    const coordinator = new MutationCoordinator();
    const readGates = desk.gates();
    const deletion = coordinator.tryAcquireDeletion();
    if (!deletion) throw new Error("the deletion lease was refused");
    const closing = await readGates.closeAndDrain(BOOKS_GATE);
    const deps = { mutationCoordinator: coordinator, readGates };
    const response = await desk.deleteAuthor(LE_GUIN, deps);
    readGates.reopen(closing);
    coordinator.release(deletion);
    expect(response.status).toBe(422);
    expect(refusalIn(await response.text()).code).toBe(MUTATION_BUSY_ERROR_CODE);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula K. Le Guin");
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(allGivenBack(desk.readers(readGates))).toBe(true);
  });
});

describe("a form holding the deleted author's pick", () => {
  test("is refused when saved, writes nothing, and the field asks for a new pick", async () => {
    const app = routerApp(conns);
    const form = await recordAddressView(app, "notes", NOTE_LE_GUIN);
    const picked = new RegExp(`${PICKED_RECORD_ATTRIBUTE}="([^"]*)"`).exec(form)?.[1];
    expect(picked).toBe(LE_GUIN);
    expect((await desk.deleteAuthor(LE_GUIN)).status).toBe(200);
    const text = BEFORE().notes[NOTE_LE_GUIN];
    const response = await app.request(
      capabilityActionUrl("notes", "update"),
      saveBody({ [RECORD_ID_FIELD]: NOTE_LE_GUIN, text }, { text: picked ?? "" }, ["text"]),
    );
    expect(response.status).toBe(422);
    expect(refusalIn(await response.text())).toEqual({
      code: PICK_NOT_FOUND_ERROR_CODE,
      fields: "text",
      sentence: escapeHtml(pickAgainLine([AUTHORS.noun])),
    });
    expect(notes(conns).find(({ id }) => id === NOTE_LE_GUIN)?.text).toBe(text);
    expect(linkRows(conns)).toEqual(BUTLERS_ROWS());
  });
});
