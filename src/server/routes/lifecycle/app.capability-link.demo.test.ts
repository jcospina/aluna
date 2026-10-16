// The living demo, on the demo desk the Link control is tested on, where Books ·
// Title holds 300 characters and so can be picked for Reading Log · Title: three test entries
// besides the older one, a second book titled Kindred, the link, the report, the marks, and a
// pick for the Kindred entry taking its mark away.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { capabilityLinkUrl } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  connectingNote,
  matchingReport,
  pickTargetMark,
} from "../../../presentation/controls/link/link-copy.ts";
import { renderableFromRow } from "../../../presentation/fields/renderable-capability.ts";
import { createPresentationAdapter } from "../../../presentation/records/adapter.ts";
import { getCapability, holdingRelations, listCapabilities } from "../../../registry/index.ts";
import { createCapabilityActionRecord, heldPicks } from "../../../runtime/data/index.ts";
import { relinkUpdatedRecord } from "../../../runtime/data/links/picks.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import { createTestApp } from "../../isolated-app.test-support.ts";
import {
  answerLines,
  BOOKS,
  installDesk,
  offeredOptions,
  READING_LOG,
} from "./link.test-support.ts";

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  installDesk(conns);
  const books = [
    ["left-hand", "The Left Hand of Darkness"],
    ["earthsea", "A Wizard of Earthsea"],
    ["mistborn", "Mistborn"],
    ["kindred-1", "Kindred"],
    ["kindred-2", "Kindred"],
  ] as const;
  for (const [id, title] of books) {
    conns.readwrite.run('INSERT INTO "cap_books" ("id", "title") VALUES (?, ?)', [id, title]);
  }
  const entries = [
    ["entry-left-hand", "The Left Hand of Darkness"],
    ["entry-earthsea", "  a wizard of earthsea "],
    ["entry-mistborn", "Mistborn"],
    ["entry-kindred", "Kindred"],
  ] as const;
  for (const [id, title] of entries) {
    conns.readwrite.run('INSERT INTO "cap_reading_log" ("id", "title") VALUES (?, ?)', [id, title]);
  }
});

afterEach(() => teardownRouterTest(dir, conns));

/** Each entry's card mark, by entry: the name it is read aloud by, or null. */
function marks(): Record<string, string | null> {
  const catalog = listCapabilities(conns.readonly);
  const row = getCapability("reading_log", conns.readonly);
  if (!row) throw new Error("Reading Log is not on the desk");
  const relations = holdingRelations(row, catalog);
  const present = createPresentationAdapter({
    capability: renderableFromRow(row, catalog),
    renderItem: (record) => `<p>${String(record.title)}</p>`,
    links: (id) => heldPicks(conns.readonly, row.id, id, relations),
    linkNouns: new Map(relations.map(({ field }) => [field, BOOKS.noun])),
  });
  const stored = conns.readonly
    .query('SELECT * FROM "cap_reading_log" ORDER BY "id"')
    .all() as Record<string, unknown>[];
  return Object.fromEntries(
    stored.map((entry) => {
      const html = present(createCapabilityActionRecord({ created_at: "", ...entry } as never));
      return [
        entry.id,
        /class="link-mark" role="img" aria-label="([^"]*)"/.exec(html)?.[1] ?? null,
      ];
    }),
  );
}

test("Reading Log · Title linked to Books · Title links three entries and marks the rest", async () => {
  const app = createTestApp({ capabilityRouter: { databases: conns } });
  const chooser = await app.request(`${capabilityLinkUrl("reading_log", "title")}?for=demo`);
  const option = offeredOptions(await chooser.text()).find(({ value }) => value === "books.title");
  expect(option).toBeDefined();

  const linked = await app.request(capabilityLinkUrl("reading_log", "title"), {
    method: "POST",
    body: new URLSearchParams(option?.press),
  });
  expect(await answerLines(linked)).toEqual([
    { note: connectingNote(READING_LOG.plural, BOOKS.plural) },
    {
      report: matchingReport(READING_LOG, BOOKS.noun, { linked: 3, unmatched: 2 }),
    },
  ]);

  const asked = pickTargetMark([BOOKS.noun]);
  expect(marks()).toEqual({
    "entry-0": asked,
    "entry-earthsea": null,
    "entry-kindred": asked,
    "entry-left-hand": null,
    "entry-mistborn": null,
  });

  // A book picked for the Kindred entry, written as its save writes it: the mark goes.
  const row = getCapability("reading_log", conns.readwrite);
  if (!row) throw new Error("Reading Log is not on the desk");
  const relations = holdingRelations(row, listCapabilities(conns.readwrite));
  relinkUpdatedRecord(
    conns.readwrite,
    { capabilityId: "reading_log", recordId: "entry-kindred", changed: () => false },
    { relations, dormant: [], picks: new Map([["title", "kindred-2"]]) },
    new Set(["title"]),
  );
  expect(marks()["entry-kindred"]).toBeNull();
  expect(marks()["entry-0"]).toBe(asked);
});
