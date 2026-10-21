// A linking-only request that connects: the link step runs alone under
// the build lease on the capability as committed, the relation is written in place with the
// matching scan, and the prompt bar says what came of it. No version, no code, no lease beyond the
// build's. Driven through POST /prompt with a fake provider; no test calls a real one.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ZodType } from "zod";
import * as restoration from "../../../../pipeline/jobs/restoration.ts";
import type { GenerateResult, Provider } from "../../../../platform/provider/index.ts";
import {
  alreadyConnected,
  connectingNote,
  matchingReport,
  NOTHING_ELSE_TO_CONNECT,
  requestConnected,
} from "../../../../presentation/controls/link/link-copy.ts";
import {
  FIFTH_INCARNATION_ID,
  SIXTH_INCARNATION_ID,
} from "../../../../registry/incarnations.test-support.ts";
import { getCapability } from "../../../../registry/index.ts";
import * as store from "../../../../registry/store/store.ts";
import { install } from "../../../../runtime/router/dispatch/router.test-support.ts";
import { eventData, lastEventData, teardownScratchDbEnv } from "../../../app.test-support.ts";
import { PROMPT_REFUSAL_ATTRIBUTE } from "../../../http/fragments/fragments.ts";
import {
  AUTHORS,
  BOOKS,
  type DeskCapability,
  deskRow,
  READING_LOG,
  READING_LOG_INCARNATION,
  storeRelations,
  textField,
} from "../../lifecycle/link.test-support.ts";
import {
  AUTHOR_TO_NAME,
  answering,
  ask,
  authorTo,
  BOOK_NOUNS,
  bookField,
  freshDesk,
  isLinkPrompt,
  LINKING,
  type LinkingDesk,
  linkRows,
  RESOLVING,
  TITLE_TO_LOG,
} from "./linking-only.test-support.ts";

let desk: LinkingDesk;
let quiet: ReturnType<typeof spyOn>;

beforeEach(() => {
  quiet = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  teardownScratchDbEnv(desk.env);
});

const PEOPLE: DeskCapability = {
  id: "people",
  label: "People",
  noun: "person",
  plural: "people",
  incarnation: FIFTH_INCARNATION_ID,
  fields: [textField("name", "Name", { max_length: 120 })],
};
const COMICS: DeskCapability = {
  id: "comics",
  label: "Comics",
  noun: "comic",
  plural: "comics",
  incarnation: SIXTH_INCARNATION_ID,
  fields: [
    textField("title", "Title"),
    textField("writer", "Writer", { max_length: 120 }),
    textField("artist", "Artist", { max_length: 120 }),
  ],
};

describe("a linking-only request", () => {
  test("the step runs alone under the build lease, and the relation lands in place with its scan", async () => {
    desk = freshDesk([
      ["The Dispossessed", "  ursula k. LE GUIN "],
      ["Kindred", "Octavia E. Butler"],
      ["Mistborn", "B. Sanderson"],
      ["Untitled", null],
    ]);
    const booksBefore = getCapability(BOOKS.id, desk.env.conns.readonly);
    const leases: (string | null)[] = [];
    const { provider, prompts } = answering({ relations: [AUTHOR_TO_NAME] });
    const watched: Provider = {
      generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
        if (isLinkPrompt(prompt))
          leases.push(desk.coordinator.snapshot().activeLease?.kind ?? null);
        return provider.generate(prompt, schema);
      },
    };
    const platformWrites = spyOn(desk.coordinator, "withPlatformWrite");
    const writing = store.writeCapabilityRelations;
    const writeLeases: (string | null)[] = [];
    const written = spyOn(store, "writeCapabilityRelations").mockImplementation((...args) => {
      writeLeases.push(desk.coordinator.snapshot().activeLease?.kind ?? null);
      return writing(...args);
    });
    const { events, sentences, preview, metrics, jobId } = await ask(desk, watched);
    written.mockRestore();

    const books = getCapability(BOOKS.id, desk.env.conns.readonly);
    expect(books?.relations).toStrictEqual([authorTo("name")]);
    expect({ ...books, relations: [] }).toStrictEqual({ ...booksBefore, relations: [] });
    expect(prompts.length).toBe(2);
    expect(prompts.filter(isLinkPrompt).length).toBe(1);
    expect(leases).toStrictEqual(["build"]);
    expect(platformWrites).not.toHaveBeenCalled();
    expect(writeLeases).toStrictEqual(["build"]);
    expect(linkRows(desk)).toBe(2);
    expect(sentences).toStrictEqual([
      RESOLVING,
      connectingNote(BOOKS.plural, AUTHORS.plural),
      matchingReport(BOOK_NOUNS, AUTHORS.noun, { linked: 2, unmatched: 1 }),
    ]);
    const ending = lastEventData(events, "fragment");
    expect(ending).toContain("data-linked-field");
    expect(ending).not.toContain(PROMPT_REFUSAL_ATTRIBUTE);
    expect(eventData(events, "done")).toBe("ok");
    expect(preview).toMatchObject({
      promptJobId: jobId,
      outcome: "completed",
      resolver: { intent: { type: "link_capability", targetCapability: BOOKS.id } },
      linkStep: { usage: { totalTokens: expect.any(Number) } },
    });
    expect([metrics.rows, metrics.resolutionRows, metrics.lifecycles]).toStrictEqual([[], [], []]);
  });

  test("fields no record has named anything in yet are written in field order and said to be connected", async () => {
    desk = freshDesk([]);
    install(desk.env.conns, deskRow(READING_LOG));
    const intent = { ...LINKING, related_capabilities: [AUTHORS.id, READING_LOG.id] };
    const { provider } = answering({ relations: [AUTHOR_TO_NAME, TITLE_TO_LOG] }, intent);
    const { said } = await ask(desk, provider);

    const toLog = { capability: READING_LOG.id, incarnation: READING_LOG_INCARNATION };
    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([
      { field: "title", to: { ...toLog, field: "title" } },
      authorTo("name"),
    ]);
    const unnamed = { linked: 0, unmatched: 0 };
    const log = { targetNoun: READING_LOG.noun, targetPlural: READING_LOG.plural };
    const authors = { targetNoun: AUTHORS.noun, targetPlural: AUTHORS.plural };
    expect(said).toBe(
      requestConnected(BOOK_NOUNS, [
        { field: bookField("title"), ...log, matched: unnamed },
        { field: bookField("author"), ...authors, matched: unnamed },
      ]),
    );
  });

  test("two fields picking from one capability are each reported by their own label", async () => {
    desk = freshDesk([]);
    install(desk.env.conns, deskRow(PEOPLE));
    install(desk.env.conns, deskRow(COMICS));
    desk.env.conns.readwrite.run('INSERT INTO "cap_people" ("id", "name") VALUES (?, ?)', [
      "person-0",
      "Alan Moore",
    ]);
    desk.env.conns.readwrite.run(
      'INSERT INTO "cap_comics" ("id", "title", "writer", "artist") VALUES (?, ?, ?, ?)',
      ["comic-0", "Watchmen", "Alan Moore", "Dave Gibbons"],
    );
    const intent = { ...LINKING, target_capability: COMICS.id, related_capabilities: [PEOPLE.id] };
    const toName = (field: string) => ({ field, capability: PEOPLE.id, target_field: "name" });
    const { provider } = answering({ relations: [toName("artist"), toName("writer")] }, intent);
    const { said } = await ask(desk, provider);

    expect(getCapability(COMICS.id, desk.env.conns.readonly)?.relations.length).toBe(2);
    const nouns = { noun: COMICS.noun, plural: COMICS.plural };
    const writer = matchingReport(nouns, "writer", { linked: 1, unmatched: 0 });
    const artist = matchingReport(nouns, "artist", { linked: 0, unmatched: 1 });
    expect(said).toBe(`${writer} ${artist}`);
    expect(writer).not.toBe(matchingReport(nouns, PEOPLE.noun, { linked: 1, unmatched: 0 }));
  });
});

describe("a linking-only request whose window stays as it was", () => {
  test("fields that already have a relation keep it, and the bar says they are already connected", async () => {
    desk = freshDesk([["The Dispossessed", "Ursula K. Le Guin"]]);
    install(desk.env.conns, deskRow(READING_LOG));
    const titleToLog = {
      field: "title",
      to: { capability: READING_LOG.id, incarnation: READING_LOG_INCARNATION, field: "title" },
    };
    storeRelations(desk.env.conns, BOOKS.id, [titleToLog, authorTo("pen_name")]);
    const { provider, prompts } = answering({ relations: [AUTHOR_TO_NAME] });
    const { sentences, events } = await ask(desk, provider);

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([
      titleToLog,
      authorTo("pen_name"),
    ]);
    expect(linkRows(desk)).toBe(0);
    // No field is open, so no call is made and nothing is said to be under way.
    expect(prompts.some(isLinkPrompt)).toBe(false);
    const connected = [{ field: bookField("author"), targetPlural: AUTHORS.plural }];
    expect(sentences).toStrictEqual([RESOLVING, alreadyConnected(BOOKS.noun, connected)]);
    expect(eventData(events, "done")).toBe("ok");
  });

  test("a request about a field still open says what is already connected and that nothing else is", async () => {
    desk = freshDesk([["The Dispossessed", "Ursula K. Le Guin"]]);
    storeRelations(desk.env.conns, BOOKS.id, [authorTo("pen_name")]);
    const { provider, prompts } = answering({ relations: [] });
    const { sentences } = await ask(desk, provider);

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([
      authorTo("pen_name"),
    ]);
    expect(prompts.some(isLinkPrompt)).toBe(true);
    const connected = [{ field: bookField("author"), targetPlural: AUTHORS.plural }];
    expect(sentences).toStrictEqual([
      RESOLVING,
      connectingNote(BOOKS.plural, AUTHORS.plural),
      `${alreadyConnected(BOOKS.noun, connected)} ${NOTHING_ELSE_TO_CONNECT}`,
    ]);
  });

  test("a window that cannot be drawn again takes back nothing written, and the bar still says it", async () => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    const drawing = spyOn(restoration, "renderRestorationFragment").mockImplementationOnce(() => {
      throw new Error("the registry is unreadable");
    });
    try {
      const { provider } = answering({ relations: [AUTHOR_TO_NAME] });
      const { said, events } = await ask(desk, provider);

      expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([
        authorTo("name"),
      ]);
      expect(said).toBe(matchingReport(BOOK_NOUNS, AUTHORS.noun, { linked: 1, unmatched: 0 }));
      expect(lastEventData(events, "fragment")).not.toContain("data-build-restoration");
      expect(eventData(events, "done")).toBe("ok");
    } finally {
      drawing.mockRestore();
    }
  });
});
