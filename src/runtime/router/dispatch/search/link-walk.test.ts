import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { readActiveRegistryCatalog } from "../../../../registry/index.ts";
import {
  AUTHORS,
  BOOKS,
  READING_LOG,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { setupRouterTest, teardownRouterTest } from "../router.test-support.ts";
import { type LinkWalk, type WalkPace, walkLinks } from "./link-walk.ts";
import {
  BOOK_AUTHOR,
  describeAuthor,
  gateOf,
  gates,
  installSearchDesk,
  LE_GUIN,
  LOG_TITLE,
  readers,
  SANDERSON,
  seed,
} from "./search-links.test-support.ts";

// A walk cut short by its time limit or its reader keeps what it found, nearest first; one whose
// capability starts closing is never waited for.

const scratch: { dir?: string; conns?: PlatformDatabase } = {};
const conns = () => scratch.conns as PlatformDatabase;

beforeEach(() => {
  Object.assign(scratch, setupRouterTest());
  installSearchDesk(conns(), { books: [BOOK_AUTHOR], reading_log: [LOG_TITLE] });
  seed(
    conns(),
    BOOKS,
    "b-lh",
    1,
    { title: "Left Hand", notes: "Gethen" },
    { author: [AUTHORS, LE_GUIN] },
  );
  seed(
    conns(),
    BOOKS,
    "b-mb",
    2,
    { title: "Mistborn", notes: "" },
    { author: [AUTHORS, SANDERSON] },
  );
  describeAuthor(conns(), SANDERSON, { bio: "Gethen fan" });
  seed(conns(), READING_LOG, "e-lh", 3, { title: "Left Hand" }, { title: [BOOKS, "b-lh"] });
  seed(conns(), READING_LOG, "e-mb", 4, { title: "Mistborn" }, { title: [BOOKS, "b-mb"] });
});

afterEach(() => {
  if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
});

function walkFrom(searched: string): LinkWalk {
  const catalog = readActiveRegistryCatalog(conns().readonly).capabilities;
  const row = catalog.find((each) => each.id === searched);
  if (row === undefined) throw new Error(`no ${searched} on the desk`);
  const signal = new AbortController().signal;
  return { database: conns().readonly, readGates: gates(conns()), catalog, searched: row, signal };
}

/** A pace that says stop once `paths` paths have been walked. */
function stoppingAfter(paths: number): WalkPace {
  let walked = 0;
  return { over: () => ++walked > paths, breathe: async () => {} };
}

describe("a walk told to stop", () => {
  test("keeps what it found, and gives back every read token", async () => {
    const walk = walkFrom("reading_log");
    // Left Hand's notes say Gethen, one link away; Sanderson's bio does, two away.
    expect(await walkLinks(walk, ["gethen"], stoppingAfter(Number.POSITIVE_INFINITY))).toEqual({
      byLinks: [["e-lh"], ["e-mb"]],
      complete: true,
    });
    expect(await walkLinks(walk, ["gethen"], stoppingAfter(1))).toEqual({
      byLinks: [["e-lh"]],
      complete: false,
    });
    expect(readers(walk.readGates)).toEqual([]);
  });
});

describe("a capability closing as the walk goes", () => {
  test("is given back its read token at once, and left out", async () => {
    const walk = walkFrom("reading_log");
    let closing: Promise<unknown> | undefined;
    const pace: WalkPace = {
      over: () => false,
      // The close waits for every reader of Authors: a walk holding its token would never finish.
      breathe: async () => {
        closing ??= walk.readGates.closeAndDrain(gateOf(AUTHORS));
        await closing;
      },
    };
    expect(await walkLinks(walk, ["gethen"], pace)).toEqual({
      byLinks: [["e-lh"]],
      complete: true,
    });
  });
});
