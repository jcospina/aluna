// Unlink: the broken chain's press takes the relation and every pick its field made in one
// platform write under the lease, leaves every stored text and the version as they were, and the
// field is plain text again, its chain drawn and no card marked for it. Through the real app on the
// notes fixture, its text linked to Authors · Name, with Books' author linked beside it.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  capabilityActionUrl,
  capabilityLinkUrl,
  capabilityPickUrl,
  unlinkFieldUrl,
} from "#shell/core/routes.js";
import type { PickList } from "../../../../lifecycle/link/pick/pick.ts";
import {
  FIELD_NOT_LINKED_CODE,
  FIELD_UNLINKED_CODE,
  LINK_STALE_CODE,
  LINK_UNREADABLE_CODE,
  linkNoticeSentence,
} from "../../../../lifecycle/link/presentation.ts";
import { until } from "../../../../platform/async.test-support.ts";
import * as linkTable from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../../platform/persistence/table-names.ts";
import {
  connectFieldName,
  disconnectDetail,
  disconnectQuestion,
  matchingReport,
  pickTargetMark,
} from "../../../../presentation/controls/link/link-copy.ts";
import { FIFTH_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import { type CapabilityRow, getCapability } from "../../../../registry/index.ts";
import { escapeHtml } from "../../../../server/http/html.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  answerLines,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../concurrency/mutation-coordinator.ts";
import { NOTES_INCARNATION_ID, notesRow, teardownRouterTest } from "../router.test-support.ts";
import {
  BOOK_AUTHOR,
  BOOK_LINK,
  BUTLER,
  LE_GUIN,
  linkedNotesDesk,
  linkRows,
  noteLink,
  notes,
  queuedPlatformWrite,
  routerApp,
  seedLinkedBook,
  seedNote,
  TEXT_TO_NAME,
} from "./router.links.test-support.ts";

const LINKED = "0b0b0b0b-0000-4000-8000-000000000001";
const SPACED = "0b0b0b0b-0000-4000-8000-000000000002";
const UNKNOWN = "0b0b0b0b-0000-4000-8000-000000000003";

let dir: string;
let conns: PlatformDatabase;
let coordinator: MutationCoordinator;

beforeEach(() => {
  ({ dir, conns } = linkedNotesDesk());
  coordinator = createMutationCoordinator();
  seedNote(conns, LINKED, "Octavia E. Butler", BUTLER);
  seedNote(conns, SPACED, "  ursula k. le guin ", LE_GUIN);
  seedNote(conns, UNKNOWN, "Terry Pratchett");
  seedLinkedBook(conns);
});

afterEach(() => teardownRouterTest(dir, conns));

const app = () => routerApp(conns, { mutationCoordinator: coordinator });

function notesNow(): CapabilityRow {
  const row = getCapability("notes", conns.readonly);
  if (!row) throw new Error("notes is not on the desk");
  return row;
}

/** What the dropdown read last says the broken chain posts. */
async function pressRead(): Promise<Record<string, string>> {
  const list = (await (await app().request(capabilityPickUrl("notes", "text"))).json()) as PickList;
  return list.unlinking.press;
}

function unlink(press: Record<string, string>, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app().request(unlinkFieldUrl(capabilityLinkUrl("notes", "text")), {
      method: "POST",
      body: new URLSearchParams(press),
      ...init,
    }),
  );
}

/** The collection as it reads now: every Edit template, and every card's mark. */
async function collection(): Promise<string> {
  return (await app().request(capabilityActionUrl("notes", "read"))).text();
}

describe("the broken chain's press", () => {
  test("is what the dropdown reads: the question, the chain it gives back, and the row as read", async () => {
    const list = (await (
      await app().request(capabilityPickUrl("notes", "text"))
    ).json()) as PickList;
    const text = notesRow().schema.fields.find((field) => field.name === "text");
    if (!text) throw new Error("the notes fixture has no text field");
    expect(list.unlinking).toEqual({
      lead: disconnectQuestion(notesRow().plural_noun, AUTHORS.plural),
      detail: disconnectDetail(notesRow().plural_noun, text),
      connect: connectFieldName(notesRow().noun, text),
      press: {
        incarnation_id: NOTES_INCARNATION_ID,
        version: "1",
        target: "authors",
        target_field: "name",
        target_incarnation_id: AUTHORS_INCARNATION,
        target_version: "1",
      },
    });
  });
});

describe("unlinking a linked field", () => {
  test("takes the relation and every link row of the field in one write, no text and no version", async () => {
    const before = { notes: notes(conns), row: notesNow() };
    expect(linkRows(conns)).toContainEqual(noteLink(LINKED, BUTLER));

    const response = await unlink(await pressRead());

    expect(response.status).toBe(204);
    expect(linkRows(conns)).toEqual([BOOK_LINK]);
    expect(notes(conns)).toEqual(before.notes);
    expect(notesNow()).toEqual({ ...before.row, relations: [] });
    expect(getCapability("books", conns.readonly)?.relations).toEqual([BOOK_AUTHOR]);
    expect(coordinator.snapshot().activeLease).toBeNull();
  });

  test("gives the field back as plain text with its chain, and no card carries a mark for it", async () => {
    const linked = await collection();
    expect(linked).toContain(`aria-label="${pickTargetMark([AUTHORS.noun])}"`);
    expect(linked).toContain(`data-pick-url="${capabilityPickUrl("notes", "text")}"`);

    await unlink(await pressRead());

    const plain = await collection();
    expect(plain).not.toContain("link-mark");
    expect(plain).not.toContain("data-linked-field");
    expect(plain).toContain(`data-link-url="${capabilityLinkUrl("notes", "text")}"`);
    const field = await app().request(capabilityPickUrl("notes", "text"));
    expect(field.status).toBe(422);
    expect(await field.text()).toContain(`data-error-code="${FIELD_UNLINKED_CODE}"`);
  });

  test("Link again afterwards matches the names every note holds, as the first link did", async () => {
    await unlink(await pressRead());
    const body = new URLSearchParams({
      incarnation_id: NOTES_INCARNATION_ID,
      version: "1",
      target: AUTHORS.id,
      target_field: "name",
      target_incarnation_id: AUTHORS_INCARNATION,
      target_version: "1",
    });
    const linked = await app().request(capabilityLinkUrl("notes", "text"), {
      method: "POST",
      body,
    });
    const [, report] = await answerLines(linked);
    const noun = { noun: notesRow().noun, plural: notesRow().plural_noun };
    expect(report).toEqual({
      report: matchingReport(noun, AUTHORS.noun, { linked: 2, unmatched: 1 }),
    });
    expect(linkRows(conns)).toEqual([
      noteLink(LINKED, BUTLER),
      noteLink(SPACED, LE_GUIN),
      BOOK_LINK,
    ]);
  });

  test("waits its turn behind a build, then applies", async () => {
    const lease = await coordinator.acquireBuild(coordinator.reserveBuild());
    const press = await pressRead();
    const answer = unlink(press);
    await queuedPlatformWrite(coordinator);
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
    coordinator.release(lease);
    expect((await answer).status).toBe(204);
    expect(notesNow().relations).toEqual([]);
  });

  test("a press whose caller went away while it waited writes nothing", async () => {
    const lease = await coordinator.acquireBuild(coordinator.reserveBuild());
    const press = await pressRead();
    const gone = new AbortController();
    const answer = unlink(press, { signal: gone.signal }).catch(() => null);
    await queuedPlatformWrite(coordinator);
    gone.abort();
    coordinator.release(lease);
    await answer;
    await until(() => coordinator.snapshot().activeLease === null);
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toContainEqual(noteLink(LINKED, BUTLER));
  });
});

describe("a press that read something else", () => {
  test("is stale once the row moved, and writes nothing", async () => {
    const press = await pressRead();
    conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET version = 2 WHERE id = 'notes'`);
    const response = await unlink(press);
    expect(response.status).toBe(409);
    const sentence = linkNoticeSentence({
      code: LINK_STALE_CODE,
      moved: notesNow(),
      disconnecting: true,
    });
    expect(await response.text()).toContain(sentence);
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toHaveLength(3);
  });

  test("is stale when the field now follows another field, and writes nothing", async () => {
    const press = { ...(await pressRead()), target_field: "pen_name" };
    const response = await unlink(press);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain(`data-error-code="${LINK_STALE_CODE}"`);
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
  });

  test("is stale once the target moved, and writes nothing", async () => {
    const press = await pressRead();
    conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET version = 2 WHERE id = 'authors'`);
    const response = await unlink(press);
    expect(response.status).toBe(409);
    const authors = getCapability("authors", conns.readonly);
    const sentence = linkNoticeSentence({
      code: LINK_STALE_CODE,
      moved: authors,
      disconnecting: true,
    });
    expect(await response.text()).toContain(escapeHtml(sentence));
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toHaveLength(3);
  });

  test("leaves a relation that went dormant since, as no dropdown draws one", async () => {
    const press = await pressRead();
    // Pinned to a lifetime of Authors that is not the one on the desk, so it holds no longer.
    const dormant = {
      ...TEXT_TO_NAME,
      to: { ...TEXT_TO_NAME.to, incarnation: FIFTH_INCARNATION_ID },
    };
    storeRelations(conns, "notes", [dormant]);
    const response = await unlink(press);
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${FIELD_NOT_LINKED_CODE}"`);
    expect(notesNow().relations).toEqual([dormant]);
    expect(linkRows(conns)).toHaveLength(3);
  });

  test("says the field is not connected anymore when its relation is gone, naming its chain", async () => {
    const press = await pressRead();
    storeRelations(conns, "notes", []);
    const response = await unlink(press);
    expect(response.status).toBe(422);
    const source = { row: notesNow(), field: "text" };
    const notice = await response.text();
    expect(notice).toContain(`data-error-code="${FIELD_UNLINKED_CODE}"`);
    expect(notice).toContain(linkNoticeSentence({ code: FIELD_UNLINKED_CODE, source }));
    const text = notesRow().schema.fields.find((field) => field.name === "text");
    if (!text) throw new Error("the notes fixture has no text field");
    expect(notice).toContain(`data-connect-name="${escapeHtml(connectFieldName("note", text))}"`);
  });

  test("is refused unread when a value is missing or repeated, as no dropdown sends one", async () => {
    const { version: _left, ...unversioned } = await pressRead();
    const repeated = new URLSearchParams(await pressRead());
    repeated.append("target", "books");
    const sentence = linkNoticeSentence({ code: LINK_UNREADABLE_CODE, disconnecting: true });
    for (const press of [new URLSearchParams(unversioned), repeated]) {
      const response = await unlink(Object.fromEntries(press), { body: press });
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(escapeHtml(sentence));
    }
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
  });
});

describe("the one write", () => {
  test("leaves the relation where it was when its link rows cannot be deleted", async () => {
    const press = await pressRead();
    const failing = spyOn(linkTable, "deleteFieldLinkRows").mockImplementation(() => {
      throw new Error("disk full");
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await unlink(press)).status).toBe(500);
    } finally {
      failing.mockRestore();
      logged.mockRestore();
    }
    expect(notesNow().relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toContainEqual(noteLink(LINKED, BUTLER));
    expect(coordinator.snapshot().activeLease).toBeNull();
  });
});
