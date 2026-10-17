// A revival rides in its activation's transaction. Notes' shelf is hidden and a shelf is
// renamed while it sleeps. A fault after the registry swap undoes the revival with the activation.
// A revival that fails on its own is undone alone and logged, and the activation goes on, because
// no link may fail a build. A revival that fills the disk, after which SQLite ends the transaction
// itself, fails the activation whole, with nothing of it kept.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { errorDetail } from "../../../platform/errors.ts";
import * as linkedText from "../../../runtime/data/links/linked-text.ts";
import { durableLifecycle, evolve } from "../run/evolution-run.test-support.ts";
import {
  closeLinkedDesk,
  evolveTo,
  type LinkedDesk,
  linkRows,
  notesWith,
  openLinkedDesk,
  row,
  saveRecord,
  shelfTexts,
} from "./linked-evolution.test-support.ts";

const RENAMED = "Old Oak";

let desk: LinkedDesk;
let asleep: { rows: ReturnType<typeof linkRows>; texts: ReturnType<typeof shelfTexts> };

beforeEach(async () => {
  desk = await openLinkedDesk();
  await evolveTo(desk, notesWith({ lifecycle: "inactive" }), "hide-shelf");
  expect((await saveRecord(desk, "shelves", "shelf-oak", { name: RENAMED })).status).toBe(200);
  asleep = { rows: linkRows(desk), texts: shelfTexts(desk) };
}, 60_000);

afterEach(() => closeLinkedDesk(desk));

test("a fault after the registry swap undoes the revival with the activation", async () => {
  const shelfOnTheSaveConnection = () =>
    desk.env.conns.readwrite
      .query<{ shelf: string }, []>(`SELECT "shelf" FROM "cap_notes" WHERE "id" = 'note-oak'`)
      .get()?.shelf;
  let revivedInside: string | undefined;
  const fault = new Error("fault after the registry swap");

  const run = evolve(desk.env, notesWith(), "show the shelf again", {
    buildId: "reactivate-faulted",
    behavioralTierEnabled: false,
    durableMetrics: true,
    active: row(desk, "notes"),
    faults: {
      afterRegistryCas: () => {
        revivedInside = shelfOnTheSaveConnection();
        throw fault;
      },
    },
  });

  await expect(run).rejects.toBe(fault);
  expect(revivedInside).toBe(RENAMED);
  expect(row(desk, "notes").version).toBe(2);
  expect({ rows: linkRows(desk), texts: shelfTexts(desk) }).toEqual(asleep);
});

test("a revival that fails is undone alone and logged, and the activation goes on", async () => {
  const failure = new Error("the revival failed");
  const failing = spyOn(linkedText, "reviveLinkedText").mockImplementation(() => {
    throw failure;
  });
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    await evolveTo(desk, notesWith(), "reactivate-failing");
    expect(logged.mock.calls.some((call) => call.includes(errorDetail(failure)))).toBe(true);
  } finally {
    failing.mockRestore();
    logged.mockRestore();
  }

  expect(row(desk, "notes").version).toBe(3);
  expect({ rows: linkRows(desk), texts: shelfTexts(desk) }).toEqual(asleep);
});

/** Hold the database to the pages it has, write more than fits, then let it grow again. */
function fillTheDisk(database: Database): void {
  const pages = database.query<{ page_count: number }, []>("PRAGMA page_count").get()?.page_count;
  database.exec(`PRAGMA max_page_count = ${pages}`);
  try {
    database.run('UPDATE "cap_notes" SET "text" = ?', ["x".repeat(400_000)]);
  } finally {
    database.exec("PRAGMA max_page_count = 1073741823");
  }
}

test("a revival that fills the disk fails the activation whole, keeping none of it", async () => {
  const full = spyOn(linkedText, "reviveLinkedText").mockImplementation(fillTheDisk);
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const buildId = "reactivate-full";
  try {
    const run = evolve(desk.env, notesWith(), "show the shelf again", {
      buildId,
      behavioralTierEnabled: false,
      durableMetrics: true,
      active: row(desk, "notes"),
    });
    await expect(run).rejects.toMatchObject({ code: "SQLITE_FULL" });
  } finally {
    full.mockRestore();
    logged.mockRestore();
  }

  expect(row(desk, "notes").version).toBe(2);
  expect({ rows: linkRows(desk), texts: shelfTexts(desk) }).toEqual(asleep);
  expect(durableLifecycle(desk.env, buildId)?.outcome).not.toBe("activated");
});
