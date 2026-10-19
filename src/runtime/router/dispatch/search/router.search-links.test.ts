import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { filteredCollectionCountSentence } from "../../../../presentation/index.ts";
import {
  AUTHORS,
  BOOKS,
  MEMOS,
  READING_LOG,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import type { ItemRendererLoader } from "../generated-code.ts";
import { setupRouterTest, teardownRouterTest } from "../router.test-support.ts";
import {
  BOOK_AUTHOR,
  describeAuthor,
  deskCode,
  gateOf,
  gates,
  handClock,
  installSearchDesk,
  LE_GUIN,
  LOG_TITLE,
  MEMO_SUBJECT,
  outsideCards,
  quietly,
  readers,
  SANDERSON,
  searched,
  seed,
  TOPIC_MEMO,
  TOPICS,
  watchTokens,
} from "./search-links.test-support.ts";

// Searching a capability finds records through the links they point along: after the Handler's
// answer, nearest first, then newest first.

const scratch: { dir?: string; conns?: PlatformDatabase } = {};
const conns = () => scratch.conns as PlatformDatabase;

afterEach(() => {
  if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
});

/** Books by Le Guin and Sanderson, and Reading Log entries whose title picked one of them. */
function readingDesk(relations = { books: [BOOK_AUTHOR], reading_log: [LOG_TITLE] }) {
  installSearchDesk(conns(), relations);
  const by = (author: string, name: string) => ({ author: [AUTHORS, author] as const, name });
  for (const [id, on, title, { author, name }, notes] of [
    ["b-lh", 1, "The Left Hand of Darkness", by(LE_GUIN, "Ursula K. Le Guin"), "Gethen"],
    ["b-we", 2, "A Wizard of Earthsea", by(LE_GUIN, "Ursula K. Le Guin"), ""],
    ["b-mb", 3, "Mistborn", by(SANDERSON, "Brandon Sanderson"), ""],
  ] as const) {
    seed(conns(), BOOKS, id, on, { title, author: name, notes }, { author });
  }
  describeAuthor(conns(), LE_GUIN, { pen_name: "Kroeber", bio: "Wrote of Gethen and Anarres" });
  seed(conns(), READING_LOG, "e-direct", 4, { title: "Winter on Gethen" });
  for (const [id, on, book, title] of [
    ["e-lh1", 5, "b-lh", "The Left Hand of Darkness"],
    ["e-mb", 6, "b-mb", "Mistborn"],
    ["e-lh2", 7, "b-lh", "The Left Hand of Darkness"],
    ["e-we", 9, "b-we", "A Wizard of Earthsea"],
  ] as const) {
    seed(conns(), READING_LOG, id, on, { title }, { title: [BOOKS, book] });
  }
}

describe("search follows the links a capability points along", () => {
  beforeEach(() => {
    Object.assign(scratch, setupRouterTest());
    readingDesk();
  });

  test("lists the records linked to a match after the Handler's, nearest first, then newest", async () => {
    // e-lh2 and e-lh1 picked a book whose notes say Gethen; e-we, one by an author whose bio does.
    const answer = await searched(conns(), "reading_log", "gethen");
    expect(answer.listed).toEqual(["e-direct", "e-lh2", "e-lh1", "e-we"]);
    expect(outsideCards(answer.records)).toBe("");
  });

  test("keeps the Handler's own order and lists no record twice", async () => {
    conns().readwrite.run(`UPDATE "cap_reading_log" SET "notes" = 'Gethen' WHERE "id" = 'e-lh2'`);
    const oldestFirst = deskCode({ reading_log: { oldestFirst: true } });
    expect((await searched(conns(), "reading_log", "gethen", oldestFirst)).listed).toEqual([
      "e-direct",
      "e-lh2",
      "e-lh1",
      "e-we",
    ]);
  });

  test("a chain of two links finds a name only the far end holds, through records that exist", async () => {
    // Lavinia's book is gone, though a link to it and its entry's link to it are left.
    seed(conns(), BOOKS, "b-gone", 10, { title: "Lavinia" }, { author: [AUTHORS, LE_GUIN] });
    seed(conns(), READING_LOG, "e-gone", 11, { title: "Lavinia" }, { title: [BOOKS, "b-gone"] });
    conns().readwrite.run(`DELETE FROM "cap_books" WHERE "id" = 'b-gone'`);
    expect((await searched(conns(), "reading_log", "kroeber")).listed).toEqual([
      "e-we",
      "e-lh2",
      "e-lh1",
    ]);
  });

  test("matches by the rule a search Handler is given, a linked field's own name included", async () => {
    // A book's author field names Le Guin, one link away; so does Mistborn's note.
    conns().readwrite.run(
      `UPDATE "cap_books" SET "notes" = 'Not Le Guin', "pages" = 286 WHERE "id" = 'b-mb'`,
    );
    expect((await searched(conns(), "reading_log", "le guin")).listed).toEqual([
      "e-we",
      "e-lh2",
      "e-mb",
      "e-lh1",
    ]);
    expect((await searched(conns(), "reading_log", "286")).listed).toEqual([]);
  });

  test("link matches replace the empty answer, and the count counts them", async () => {
    const answer = await searched(conns(), "reading_log", "kroeber");
    expect(answer.records.trim()).not.toBe("");
    const nouns = { noun: READING_LOG.noun, plural: READING_LOG.plural };
    expect(answer.sentence).toBe(filteredCollectionCountSentence(3, 5, nouns));
  });

  test("a record the Handler drew and left out of its answer is still listed", async () => {
    const drawsAll = deskCode({ reading_log: { drawsEveryRecord: true } });
    expect((await searched(conns(), "reading_log", "gethen", drawsAll)).listed).toEqual([
      "e-direct",
      "e-lh2",
      "e-lh1",
      "e-we",
    ]);
  });

  test("a match does not spread to records that only share a record with it", async () => {
    // The Left Hand of Darkness and Earthsea share Le Guin: a title finds its own entries only.
    expect((await searched(conns(), "reading_log", "left hand")).listed).toEqual([
      "e-lh2",
      "e-lh1",
    ]);
  });

  test("a blank search shows the Handler's answer alone and walks nowhere", async () => {
    const readGates = gates(conns());
    const tokens = watchTokens(readGates);
    const everyEntry = ["e-we", "e-lh2", "e-mb", "e-lh1", "e-direct"];
    for (const blank of [undefined, "  "]) {
      expect((await searched(conns(), "reading_log", blank, { readGates })).listed).toEqual(
        everyEntry,
      );
    }
    expect(tokens()).toEqual([["reading_log"], ["reading_log"]]);
  });

  test("cards count as the answer however they are spaced, and however the scrub rewrites them", async () => {
    // A raw `<` in a card's attribute is escaped by the scrub, which changes the card's bytes.
    conns().readwrite.run(
      `UPDATE "cap_reading_log" SET "title" = 'Gethen <3' WHERE "id" = 'e-direct'`,
    );
    const { loadItemRenderer: cards } = deskCode();
    const loadItemRenderer: ItemRendererLoader = async (path) => {
      const card = await cards(path);
      return (record) => `<span title="${String(record.title)}">${card(record)}</span>`;
    };
    const spaced = (answer: string) => `\n ${answer.split(/(?=<button)/).join("\n ")}\n`;
    const answer = await searched(conns(), "reading_log", "gethen", {
      ...deskCode({ reading_log: { answers: spaced } }),
      loadItemRenderer,
    });
    expect(answer.listed).toEqual(["e-direct", "e-lh2", "e-lh1", "e-we"]);
  });

  test("an answer holding more than its cards gets nothing appended", async () => {
    for (const [opens, closes] of [
      ["<ul>", "</ul>"],
      ["", "<template>"],
    ]) {
      await quietly(async () => {
        const answers = (cards: string) => `${opens}${cards}${closes}`;
        const answer = await searched(conns(), "reading_log", "gethen", {
          ...deskCode({ reading_log: { answers } }),
        });
        expect(answer.listed).toEqual(["e-direct"]);
        expect(outsideCards(answer.records)).toBe(`${opens}${closes}`);
      });
    }
  });
});

describe("what the walk reads, and for how long", () => {
  beforeEach(() => {
    Object.assign(scratch, setupRouterTest());
    readingDesk();
  });

  test("reads each capability under its own read token, and not one closed by its deletion", async () => {
    const readGates = gates(conns());
    const tokens = watchTokens(readGates);
    await searched(conns(), "reading_log", "gethen", { readGates });
    expect(tokens()).toEqual([["reading_log"], ["books"], ["authors"]]);
    expect(readers(readGates)).toEqual([]);
    await readGates.closeAndDrain(gateOf(AUTHORS));
    expect((await searched(conns(), "reading_log", "gethen", { readGates })).listed).toEqual([
      "e-direct",
      "e-lh2",
      "e-lh1",
    ]);
  });

  test("the searched capability closing as the walk begins refuses the read", async () => {
    const readGates = gates(conns());
    const acquire = readGates.tryAcquire.bind(readGates);
    readGates.tryAcquire = (input) => {
      if (input.incarnations[0]?.capabilityId === "books") {
        void readGates.closeAndDrain(gateOf(READING_LOG));
      }
      return acquire(input);
    };
    expect((await searched(conns(), "reading_log", "gethen", { readGates })).status).toBe(409);
  });

  test("a search that runs past its time limit shows what it found in time", async () => {
    const clock = handClock();
    try {
      // The Handler and its card take 650ms of the 1,000; each link match's card takes 250ms.
      const slow = deskCode({ reading_log: { meanwhile: () => clock.advance(400) } });
      const loadItemRenderer: ItemRendererLoader = async (path) => {
        const card = await slow.loadItemRenderer(path);
        return (record) => {
          clock.advance(250);
          return card(record);
        };
      };
      await quietly(async () => {
        const answer = await searched(conns(), "reading_log", "gethen", {
          ...slow,
          loadItemRenderer,
          handlerTimeoutMs: 1_000,
        });
        expect(answer.listed).toEqual(["e-direct", "e-lh2", "e-lh1"]);
        expect(outsideCards(answer.records)).toBe("");
      });
    } finally {
      clock.restore();
    }
  });
});

describe("a capability with no relations", () => {
  beforeEach(() => {
    Object.assign(scratch, setupRouterTest());
    readingDesk({ books: [BOOK_AUTHOR], reading_log: [] });
  });

  test("searches exactly as before, taking no other capability's token", async () => {
    const readGates = gates(conns());
    const tokens = watchTokens(readGates);
    const answer = await searched(conns(), "reading_log", "gethen", { readGates });
    expect(answer.listed).toEqual(["e-direct"]);
    expect(outsideCards(answer.records)).toBe("");
    expect(tokens()).toEqual([["reading_log"]]);
  });
});

describe("a looped pair of capabilities", () => {
  beforeEach(() => {
    Object.assign(scratch, setupRouterTest());
    installSearchDesk(conns(), { memos: [MEMO_SUBJECT], topics: [TOPIC_MEMO] });
    // Each topic's memo picks the other topic's memo, so the two links reach different memos.
    for (const [on, name, tags, memo] of [
      [1, "Orbits", '["tides"]', "Rain"],
      [2, "Rain", "[]", "Orbits"],
    ] as const) {
      const picks = { memo: [MEMOS, `m-${memo}`] as const };
      seed(conns(), TOPICS, `t-${name}`, on, { name, memo, tags }, picks);
      const subject = { subject: [TOPICS, `t-${name}`] as const };
      seed(conns(), MEMOS, `m-${name}`, on + 2, { subject: name }, subject);
    }
  });

  test("finishes the search, each capability searched once, along both of its links", async () => {
    const readGates = gates(conns());
    const tokens = watchTokens(readGates);
    // m-Orbits picked the topic holding tides, and that topic's memo picked m-Rain.
    expect((await searched(conns(), "memos", "tides", { readGates })).listed).toEqual([
      "m-Rain",
      "m-Orbits",
    ]);
    expect(tokens()).toEqual([["memos"], ["topics"]]);
  });
});
