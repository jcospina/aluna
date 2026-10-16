// A linked name follows its record, through the real router on the link-control desk:
// Notes' text and Books' author linked to Authors' name, Memos' subject to Books' author. A pick
// stores the author's name as it is now; renaming an author carries the name down every chain in
// the rename's own transaction, under the one lease it holds, skipping a capability closed by its
// deletion; a name cleared or an author deleted lets the links to it go, and no text moves.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { writeLinkRow } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { pickTargetMark } from "../../../../presentation/controls/link/link-copy.ts";
import { PICK_NOT_FOUND_ERROR_CODE, type Relation } from "../../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  noticeCode,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { MutationCoordinator } from "../../../concurrency/mutation-coordinator.ts";
import type { CapabilityHandler, CapabilityInput } from "../../contract.ts";
import { defaultLoadHandler, type HandlerLoader } from "../generated-code.ts";
import { teardownRouterTest } from "../router.test-support.ts";
import {
  authorHandlers,
  authorsDesk,
  BEFORE,
  BOOK_AUTHOR,
  BOOKS_GATE,
  failingAfterWork,
  NOTE_BUTLER,
  NOTE_LE_GUIN,
  NOTE_TYPED,
} from "./router.links.refresh.test-support.ts";
import {
  BUTLER,
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

afterEach(() => {
  teardownRouterTest(dir, conns);
  quiet?.mockRestore();
  quiet = undefined;
});

let quiet: ReturnType<typeof spyOn> | undefined;

/** Keep the console quiet for a Handler meant to fail; the spy goes after the test. */
function expectFailure(): void {
  quiet = spyOn(console, "error").mockImplementation(() => {});
}

/** An edit of a note as its form posts it: its text and what the text picked. */
function editNote(note: string, text: string, picked: string) {
  return routerApp(conns).request(
    capabilityActionUrl("notes", "update"),
    saveBody({ [RECORD_ID_FIELD]: note, text }, { text: picked }, ["text"]),
  );
}

describe("a pick", () => {
  test("stores the author's name, whatever the Handler made of the text", async () => {
    const shouting: HandlerLoader = async (path, action) => {
      if (action !== "create") return defaultLoadHandler(path, action);
      const create = async (context: {
        input: CapabilityInput;
        mutation: { create(values: Record<string, unknown>): unknown };
        present(record: unknown): string;
      }) =>
        context.present(
          context.mutation.create({ text: String(context.input.values.text).toUpperCase() }),
        );
      return create as unknown as CapabilityHandler;
    };
    const response = await routerApp(conns, { loadHandler: shouting }).request(
      capabilityActionUrl("notes", "create"),
      saveBody({ text: "ursula" }, { text: LE_GUIN }, ["text", "pinned"]),
    );
    expect(response.status).toBe(200);
    const seeded = [NOTE_LE_GUIN, NOTE_BUTLER, NOTE_TYPED];
    const created = notes(conns).find(({ id }) => !seeded.includes(id));
    expect(created?.text).toBe("Ursula K. Le Guin");
  });

  test("posted with the old name stores the name as it is now", async () => {
    conns.readwrite.run(`UPDATE "cap_authors" SET "name" = 'Ursula Le Guin' WHERE "id" = ?`, [
      LE_GUIN,
    ]);
    const response = await editNote(NOTE_LE_GUIN, "Ursula K. Le Guin", LE_GUIN);
    expect(response.status).toBe(200);
    expect(notes(conns).find(({ id }) => id === NOTE_LE_GUIN)?.text).toBe("Ursula Le Guin");
  });

  test("naming an author whose name was cleared asks for a new pick", async () => {
    for (const cleared of [null, String.fromCodePoint(0x200b, 0x20)]) {
      conns.readwrite.run(`UPDATE "cap_authors" SET "name" = ? WHERE "id" = ?`, [cleared, LE_GUIN]);
      const response = await editNote(NOTE_BUTLER, "Ursula K. Le Guin", LE_GUIN);
      expect(response.status).toBe(422);
      expect(noticeCode(await response.text())).toBe(PICK_NOT_FOUND_ERROR_CODE);
      expect(desk.linkedTexts()).toEqual(BEFORE());
    }
  });
});

describe("renaming an author", () => {
  test("carries the name to every field linked to them, down the chain, and nowhere else", async () => {
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin");
    expect(response.status).toBe(200);
    const expected = BEFORE();
    expected.notes[NOTE_LE_GUIN] = "Ursula Le Guin";
    expected.books["book-1"] = "Ursula Le Guin";
    expected.memos["memo-1"] = "Ursula Le Guin";
    expect(desk.linkedTexts()).toEqual(expected);
  });

  test("that fails leaves every linked field as it was", async () => {
    expectFailure();
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin", {}, failingAfterWork("update"));
    expect(response.status).toBe(500);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula K. Le Guin");
    expect(desk.linkedTexts()).toEqual(BEFORE());
  });

  test("to nothing lets the links to them go, and moves no text", async () => {
    const response = await desk.rename(LE_GUIN, "");
    expect(response.status).toBe(200);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBeNull();
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns).map(({ source_record }) => source_record)).toEqual([
      NOTE_BUTLER,
      "book-2",
      "memo-1",
    ]);
  });

  test("carries the text into a field of Authors' own, under the edit's own token", async () => {
    storeRelations(conns, "authors", [
      { field: "name", to: { ...BOOK_AUTHOR.to, field: "pen_name" } },
    ]);
    writeLinkRow(
      conns.readwrite,
      { capability: "authors", record: BUTLER, field: "name" },
      { capability: "authors", incarnation: AUTHORS_INCARNATION, record: LE_GUIN },
    );
    const response = await desk.editAuthor(LE_GUIN, { pen_name: "Le Guin" });
    expect(response.status).toBe(200);
    expect(desk.texts("cap_authors", "name")[BUTLER]).toBe("Le Guin");
    expect(desk.linkedTexts().books["book-2"]).toBe("Le Guin");
  });
});

describe("a rename's lease and read tokens", () => {
  test("runs under the one lease the save holds, with each linking capability's token", async () => {
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
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin", deps, handlers);
    expect(response.status).toBe(200);
    expect(desk.linkedTexts().memos["memo-1"]).toBe("Ursula Le Guin");
    expect(leases.record).toHaveBeenCalledTimes(1);
    const others = [leases.platform, leases.deletion, leases.build];
    expect(others.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect(seen.lease).toBe("record");
    expect(seen.readers).toMatchObject({ authors: 1, books: 1, memos: 1, notes: 1 });
    expect(Object.values(desk.readers(readGates)).every((count) => count === 0)).toBe(true);
  });

  test("takes each linking capability's token when it admits the edit, before its lease", async () => {
    const coordinator = new MutationCoordinator();
    const readGates = desk.gates();
    const order: string[] = [];
    const acquire = readGates.tryAcquire.bind(readGates);
    spyOn(readGates, "tryAcquire").mockImplementation((input) => {
      order.push(input.incarnations.map(({ capabilityId }) => capabilityId).join(" + "));
      return acquire(input);
    });
    const lease = coordinator.tryAcquireRecordWrite.bind(coordinator);
    spyOn(coordinator, "tryAcquireRecordWrite").mockImplementation(() => {
      order.push("lease");
      return lease();
    });
    const deps = { mutationCoordinator: coordinator, readGates };
    expect((await desk.rename(LE_GUIN, "Ursula Le Guin", deps)).status).toBe(200);
    expect(order).toEqual(["authors", "books", "notes", "memos", "lease"]);
  });

  test("takes one token for each capability it may write, none for a dormant one, and gives each back", async () => {
    const toPenName: Relation = { field: "title", to: { ...BOOK_AUTHOR.to, field: "pen_name" } };
    storeRelations(conns, "books", [BOOK_AUTHOR, toPenName]);
    storeRelations(conns, "reading_log", [{ field: "notes", to: { ...BOOK_AUTHOR.to } }]);
    storeRelations(conns, "authors", [{ field: "name", to: { ...toPenName.to } }]);
    const readGates = desk.gates();
    const seen: { readers?: Record<string, number> } = {};
    const handlers = authorHandlers(() => {
      seen.readers = desk.readers(readGates);
    });
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin", { readGates }, handlers);
    expect(response.status).toBe(200);
    expect(seen.readers).toMatchObject({ authors: 1, books: 1, memos: 1, reading_log: 0 });
    expect(Object.values(desk.readers(readGates)).every((count) => count === 0)).toBe(true);
  });

  test("gives every token back when taking one of them fails", async () => {
    expectFailure();
    const readGates = desk.gates();
    const acquire = readGates.tryAcquire.bind(readGates);
    spyOn(readGates, "tryAcquire").mockImplementation((input) => {
      const memos = input.incarnations.some(({ capabilityId }) => capabilityId === "memos");
      if (memos) throw new Error("the gate broke");
      return acquire(input);
    });
    expect((await desk.rename(LE_GUIN, "Ursula Le Guin", { readGates })).status).toBe(500);
    expect(Object.values(desk.readers(readGates)).every((count) => count === 0)).toBe(true);
    expect(desk.linkedTexts()).toEqual(BEFORE());
  });

  test("skips a linking capability its deletion has closed, and saves", async () => {
    const readGates = desk.gates();
    const closing = await readGates.closeAndDrain(BOOKS_GATE);
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin", { readGates });
    readGates.reopen(closing);
    expect(response.status).toBe(200);
    const expected = BEFORE();
    expected.notes[NOTE_LE_GUIN] = "Ursula Le Guin";
    expect(desk.linkedTexts()).toEqual(expected);
    expect(desk.texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula Le Guin");
  });

  test("writes a linking capability its failed deletion reopened before the save began", async () => {
    const coordinator = new MutationCoordinator();
    const readGates = desk.gates();
    const closing = await readGates.closeAndDrain(BOOKS_GATE);
    const lease = coordinator.tryAcquireRecordWrite.bind(coordinator);
    spyOn(coordinator, "tryAcquireRecordWrite").mockImplementation(() => {
      readGates.reopen(closing);
      return lease();
    });
    const deps = { mutationCoordinator: coordinator, readGates };
    expect((await desk.rename(LE_GUIN, "Ursula Le Guin", deps)).status).toBe(200);
    expect(desk.linkedTexts().books["book-1"]).toBe("Ursula Le Guin");
    expect(Object.values(desk.readers(readGates)).every((count) => count === 0)).toBe(true);
  });

  test("skips a linking capability whose deletion closes it during the save, and saves", async () => {
    const readGates = desk.gates();
    let drained: Promise<unknown> | undefined;
    const handlers = authorHandlers(() => {
      drained = readGates.closeAndDrain(BOOKS_GATE);
    });
    const response = await desk.rename(LE_GUIN, "Ursula Le Guin", { readGates }, handlers);
    expect(response.status).toBe(200);
    expect(desk.linkedTexts().books["book-1"]).toBe("Ursula K. Le Guin");
    expect(desk.linkedTexts().notes[NOTE_LE_GUIN]).toBe("Ursula Le Guin");
    expect(drained).toBeDefined();
    await drained;
  });
});

describe("deleting an author", () => {
  test("removes the link rows naming them and changes no other record", async () => {
    const readGates = desk.gates();
    const seen: { readers?: Record<string, number> } = {};
    const handlers = authorHandlers(() => {
      seen.readers = desk.readers(readGates);
    });
    const response = await desk.deleteAuthor(LE_GUIN, { readGates }, handlers);
    expect(response.status).toBe(200);
    expect(desk.linkedTexts()).toEqual(BEFORE());
    expect(linkRows(conns)).toEqual([
      noteLink(NOTE_BUTLER, BUTLER),
      expect.objectContaining({ source_record: "book-2", target_record: BUTLER }),
      expect.objectContaining({ source_record: "memo-1", target_record: "book-1" }),
    ]);
    expect(seen.readers).toMatchObject({ authors: 1, books: 0, memos: 0 });
  });

  test("leaves the note's card asking for a new pick", async () => {
    const mark = pickTargetMark([AUTHORS.noun]);
    const read = () => routerApp(conns).request(capabilityActionUrl("notes", "read"));
    const marked = async () => (await (await read()).text()).split(mark).length - 1;
    const before = await marked();
    await desk.deleteAuthor(LE_GUIN);
    expect(await marked()).toBe(before + 1);
  });

  test("that fails keeps every link row", async () => {
    expectFailure();
    const before = linkRows(conns);
    const response = await desk.deleteAuthor(LE_GUIN, {}, failingAfterWork("delete"));
    expect(response.status).toBe(500);
    expect(linkRows(conns)).toEqual(before);
  });
});
