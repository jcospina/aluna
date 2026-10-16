// Linking a field that already holds names: the press's answer, the matching scan under
// the relation's lease, and the broken-link mark the item wrapper draws on each card whose name
// found no single record, through the real app on the notes fixture and the link-control desk.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { capabilityActionUrl, capabilityLinkUrl } from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { until } from "../../../../platform/async.test-support.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  connectingNote,
  matchingReport,
  pickTargetMark,
} from "../../../../presentation/controls/link/link-copy.ts";
import {
  countRenderedItems,
  itemElementIdForTemplate,
} from "../../../../presentation/records/collection/list-container.ts";
import { getCapability } from "../../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  answerLines,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../concurrency/mutation-coordinator.ts";
import {
  NOTES_INCARNATION_ID,
  notesRow,
  notesSpec,
  teardownRouterTest,
} from "../router.test-support.ts";
import {
  BUTLER,
  LE_GUIN,
  linkedNotesDesk,
  linkRows,
  noteLink,
  notes,
  routerApp,
  SANDERSON,
  saveBody,
  seedNote,
  TEXT_TO_NAME,
} from "./router.links.test-support.ts";

/** Notes whose text may be left empty, so an empty one can stand beside the named ones. */
const NOTES = (() => {
  const fields = notesSpec().schema.fields.map((field) => ({ ...field, required: false }));
  return notesRow({ schema: { fields }, behavioral_errors: [] });
})();

const LINKED = "0a0a0a0a-0000-4000-8000-000000000001";
const SPACED = "0a0a0a0a-0000-4000-8000-000000000002";
const SHARED = "0a0a0a0a-0000-4000-8000-000000000003";
const UNKNOWN = "0a0a0a0a-0000-4000-8000-000000000004";
const EMPTY = "0a0a0a0a-0000-4000-8000-000000000005";

let dir: string;
let conns: PlatformDatabase;
let coordinator: MutationCoordinator;

beforeEach(() => {
  ({ dir, conns } = linkedNotesDesk([], NOTES));
  coordinator = createMutationCoordinator();
  // A second Brandon Sanderson, so the name two authors share links neither.
  conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name") VALUES (?, ?)', [
    "author-3",
    " brandon SANDERSON",
  ]);
  seedNote(conns, LINKED, "Octavia E. Butler");
  seedNote(conns, SPACED, "  ursula k. le guin ");
  seedNote(conns, SHARED, "Brandon Sanderson");
  seedNote(conns, UNKNOWN, "Terry Pratchett");
  seedNote(conns, EMPTY, "");
});

afterEach(() => teardownRouterTest(dir, conns));

const app = () => routerApp(conns, { mutationCoordinator: coordinator });

/** The notes' text linked to Authors · Name, as the chooser read both. */
function press(): Promise<Response> {
  const body = new URLSearchParams({
    incarnation_id: NOTES_INCARNATION_ID,
    version: "1",
    target: AUTHORS.id,
    target_field: "name",
    target_incarnation_id: AUTHORS_INCARNATION,
    target_version: "1",
  });
  return Promise.resolve(
    app().request(capabilityLinkUrl("notes", "text"), { method: "POST", body }),
  );
}

/** Each card on the collection, by note, with the name of the mark it carries or null. */
async function cards(): Promise<Record<string, string | null>> {
  const read = await (await app().request(capabilityActionUrl("notes", "read"))).text();
  const byItem = new Map(
    [LINKED, SPACED, SHARED, UNKNOWN, EMPTY].map((id) => [
      itemElementIdForTemplate(`record-notes-${id}`),
      id,
    ]),
  );
  const marks: Record<string, string | null> = {};
  let card = "";
  new HTMLRewriter()
    .on(".capability-item[data-item]", {
      element(element) {
        card = byItem.get(element.getAttribute("id") ?? "") ?? "";
        marks[card] = null;
      },
    })
    .on(".capability-item .link-mark", {
      element(element) {
        marks[card] = element.getAttribute("aria-label");
      },
    })
    .transform(read);
  return marks;
}

const ASKED = pickTargetMark([AUTHORS.noun]);

/** The name of every mark in `html`, in order. */
function marksIn(html: string): (string | null)[] {
  const names: (string | null)[] = [];
  new HTMLRewriter()
    .on(".link-mark", {
      element(element) {
        names.push(element.getAttribute("aria-label"));
      },
    })
    .transform(html);
  return names;
}

describe("linking a field that holds names", () => {
  test("links each name exactly one author holds, and reports how it went in the record nouns", async () => {
    const before = { notes: notes(conns), row: getCapability("notes", conns.readonly) };
    const response = await press();

    expect(response.status).toBe(200);
    expect(await answerLines(response)).toEqual([
      { note: connectingNote(NOTES.plural_noun, AUTHORS.plural) },
      {
        report: matchingReport({ noun: NOTES.noun, plural: NOTES.plural_noun }, AUTHORS.noun, {
          linked: 2,
          unmatched: 2,
        }),
      },
    ]);
    expect(linkRows(conns)).toEqual([noteLink(LINKED, BUTLER), noteLink(SPACED, LE_GUIN)]);
    expect(notes(conns)).toEqual(before.notes);
    const after = getCapability("notes", conns.readonly);
    expect(after?.relations).toEqual([TEXT_TO_NAME]);
    expect({ ...after, relations: [] }).toEqual({ ...before.row, relations: [] });
  });

  test("answers its head once the lease admits the pair, and holds it until both are written", async () => {
    const response = await press();
    expect(getCapability("notes", conns.readonly)?.relations).toEqual([]);
    expect(linkRows(conns)).toEqual([]);
    expect(coordinator.snapshot().activeLease?.kind).toBe("platform");
    expect(coordinator.tryAcquireRecordWrite()).toBeUndefined();

    await response.text();
    expect(getCapability("notes", conns.readonly)?.relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toHaveLength(2);
    expect(coordinator.snapshot().activeLease).toBeNull();
  });

  test("sends nothing while the press waits its turn behind a build", async () => {
    const lease = await coordinator.acquireBuild(coordinator.reserveBuild());
    let answered = false;
    const answer = press().then((response) => {
      answered = true;
      return response;
    });
    await until(() => coordinator.snapshot().queuedTickets.some(({ kind }) => kind === "platform"));
    expect(answered).toBe(false);
    coordinator.release(lease);
    expect(await answerLines(await answer)).toHaveLength(2);
  });

  test("writes the relation and its rows in one transaction: a scan that fails leaves neither", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await press();
      conns.readwrite.run('ALTER TABLE "cap_authors" RENAME TO "authors_away"');
      expect(await answerLines(response)).toEqual([
        { note: connectingNote(NOTES.plural_noun, AUTHORS.plural) },
      ]);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(getCapability("notes", conns.readonly)?.relations).toEqual([]);
      expect(linkRows(conns)).toEqual([]);
      expect(coordinator.snapshot().activeLease).toBeNull();
    } finally {
      logged.mockRestore();
    }
    conns.readwrite.run('ALTER TABLE "authors_away" RENAME TO "cap_authors"');
    expect(await answerLines(await press())).toHaveLength(2);
    expect(linkRows(conns)).toHaveLength(2);
  });
});

describe("the broken-link mark", () => {
  test("is drawn by the wrapper on each card whose name found no single author", async () => {
    await (await press()).text();
    expect(await cards()).toEqual({
      [LINKED]: null,
      [SPACED]: null,
      [SHARED]: ASKED,
      [UNKNOWN]: ASKED,
      [EMPTY]: null,
    });
  });

  test("goes once a record is picked for the field", async () => {
    await (await press()).text();
    const saved = await app().request(
      capabilityActionUrl("notes", "update"),
      saveBody({ [RECORD_ID_FIELD]: UNKNOWN, text: "Brandon Sanderson" }, { text: SANDERSON }, [
        "text",
      ]),
    );
    expect(saved.status).toBe(200);
    expect((await cards())[UNKNOWN]).toBeNull();
    expect((await cards())[SHARED]).toBe(ASKED);
  });

  test("rides on the card a create returns, and leaves the card an edit with a pick returns", async () => {
    await (await press()).text();
    const created = await app().request(
      capabilityActionUrl("notes", "create"),
      saveBody({ text: "Ursula Le Guin" }, {}, ["text", "pinned"]),
    );
    const createdCard = await created.text();
    expect(countRenderedItems(createdCard)).toBe(1);
    expect(marksIn(createdCard)).toEqual([ASKED]);
    const edited = await app().request(
      capabilityActionUrl("notes", "update"),
      saveBody({ [RECORD_ID_FIELD]: UNKNOWN, text: "Octavia E. Butler" }, { text: BUTLER }, [
        "text",
      ]),
    );
    const editedCard = await edited.text();
    expect(countRenderedItems(editedCard)).toBe(1);
    expect(marksIn(editedCard)).toEqual([]);
  });

  test("is not drawn before the field is linked", async () => {
    expect(await cards()).toEqual({
      [LINKED]: null,
      [SPACED]: null,
      [SHARED]: null,
      [UNKNOWN]: null,
      [EMPTY]: null,
    });
  });
});
