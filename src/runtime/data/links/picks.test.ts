// The picks a save carries, checked and written by the mutation ports: the ports write
// only what they are handed, in the record's own savepoint, and a save's picks link one record. A
// dormant relation's row sleeps until a save changes its field's text.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readSourceLinkRows } from "../../../platform/links/link-table.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { SECOND_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { Relation } from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import {
  applyCapabilityTableDdl,
  type CapabilityActionRecord,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  heldPicks,
  type LinkBinding,
  materializeCapabilityActionRecord,
  NO_LINKS,
  PickNotFoundError,
  PickWriteError,
  resolveSubmittedPicks,
} from "../index.ts";
import { noFiles } from "../tool.test-support.ts";

const TEXT_TO_NAME: Relation = {
  field: "text",
  to: { capability: "authors", incarnation: SECOND_INCARNATION_ID, field: "name" },
};
const SPEC = notesSpec();
const SANDERSON = "author-2";
/** Text linked to the author with the id Sanderson's record has. */
const PICKED: LinkBinding = {
  relations: [TEXT_TO_NAME],
  dormant: [],
  picks: new Map([["text", SANDERSON]]),
};

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-picks-");
  applyCapabilityTableDdl(SPEC, env.conns.readwrite);
  env.conns.readwrite.exec('CREATE TABLE "cap_authors" ("id" TEXT PRIMARY KEY, "name" TEXT)');
  env.conns.readwrite.run(`INSERT INTO "cap_authors" VALUES (?, 'Brandon Sanderson')`, [SANDERSON]);
});

afterEach(() => teardownScratchDbEnv(env));

const scope = () => ({
  database: env.conns.readwrite,
  capabilityId: SPEC.id,
  action: "update" as const,
  targetNoun: (id: string) => (id === "authors" ? "author" : id),
});

const holding = (relations: readonly Relation[]) => ({ relations, dormant: [] });

/** A create port bound to `links`, as the router binds one. */
const createPort = (links: LinkBinding) =>
  createCapabilityMutationPort(SPEC, noFiles(SPEC, env.conns.readwrite), undefined, links);

/** An update port on `recordId`, its form submitting `submitted`, bound to `links`. */
const updatePort = (recordId: string, submitted: readonly string[], links: LinkBinding) =>
  createCapabilityUpdateMutationPort(
    SPEC,
    recordId,
    new Set(submitted),
    noFiles(SPEC, env.conns.readwrite),
    undefined,
    links,
  );

const idOf = (record: CapabilityActionRecord) =>
  String(materializeCapabilityActionRecord(record).id);

const linksOf = (recordId: string) => readSourceLinkRows(env.conns.readonly, SPEC.id, recordId);

const toSanderson = new Map([
  ["text", { capability: "authors", incarnation: SECOND_INCARNATION_ID, record: SANDERSON }],
]);

/** A note whose text picked Sanderson. */
const linkedNote = () => idOf(createPort(PICKED).create({ text: "Brandon Sanderson" }));

const textOf = (recordId: string) =>
  env.conns.readonly.query('SELECT "text" FROM "cap_notes" WHERE "id" = ?').get(recordId);

/** The error `run` throws, or `undefined`. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Run `write` as a Handler that catches its failure and answers anyway: the save then commits. */
function caught(write: () => unknown): unknown {
  const database = env.conns.readwrite;
  database.exec("BEGIN");
  const error = thrown(write);
  database.exec("COMMIT");
  return error;
}

describe("checking a save's picks", () => {
  test("keeps a pick naming a record of its field's target", () => {
    const posted = new Map([["text", SANDERSON]]);
    const checked = resolveSubmittedPicks(scope(), holding([TEXT_TO_NAME]), posted);
    expect(checked).toEqual({ relations: [TEXT_TO_NAME], dormant: [], picks: posted });
  });

  test("drops a pick for a field that holds no relation, whatever it names", () => {
    const posted = new Map([["text", "made-up"]]);
    expect(resolveSubmittedPicks(scope(), holding([]), posted).picks).toEqual(new Map());
  });

  test("refuses every field whose pick names no record, with its target's noun", () => {
    const toEditor: Relation = { ...TEXT_TO_NAME, field: "editor" };
    const posted = new Map([
      ["text", "made-up"],
      ["editor", SANDERSON],
      ["pinned", "made-up"],
    ]);
    const refused = thrown(() =>
      resolveSubmittedPicks(scope(), holding([TEXT_TO_NAME, toEditor]), posted),
    );
    expect(refused).toBeInstanceOf(PickNotFoundError);
    const { fields, nouns, action } = refused as PickNotFoundError;
    expect({ fields, nouns, action }).toEqual({
      fields: ["text"],
      nouns: ["author"],
      action: "update",
    });
  });

  test("refuses a pick whose record went, the one the record holds included", () => {
    linkedNote();
    env.conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    const again = new Map([["text", SANDERSON]]);
    expect(
      thrown(() => resolveSubmittedPicks(scope(), holding([TEXT_TO_NAME]), again)),
    ).toBeInstanceOf(PickNotFoundError);
  });
});

describe("the create port", () => {
  test("writes what it is handed and nothing it is not: no binding, no row", () => {
    expect(linksOf(linkedNote())).toEqual(toSanderson);
    expect(linksOf(idOf(createPort(NO_LINKS).create({ text: "Plain" })))).toEqual(new Map());
  });

  test("leaves no row when its insert fails, even for a Handler that catches the failure", () => {
    env.conns.readwrite.exec(
      `CREATE TRIGGER refuse BEFORE INSERT ON "cap_notes" BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    expect(caught(() => createPort(PICKED).create({ text: "Brandon Sanderson" }))).toBeDefined();
    expect(env.conns.readonly.query("SELECT count(*) AS n FROM capability_links").get()).toEqual({
      n: 0,
    });
  });

  test("links one record: a second create from the same save is refused", () => {
    const port = createPort(PICKED);
    port.create({ text: "Brandon Sanderson" });
    expect(thrown(() => port.create({ text: "Brandon Sanderson" }))).toBeInstanceOf(PickWriteError);
    const plain = createPort(NO_LINKS);
    plain.create({ text: "One" });
    expect(thrown(() => plain.create({ text: "Two" }))).toBeUndefined();
  });
});

describe("the update and delete ports", () => {
  test("an update whose link write fails changes nothing, even for a Handler that catches it", () => {
    const note = idOf(createPort(NO_LINKS).create({ text: "Plain" }));
    env.conns.readwrite.exec(
      `CREATE TRIGGER refuse BEFORE INSERT ON capability_links BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    const write = () => updatePort(note, ["text"], PICKED).update({ text: "Brandon Sanderson" });
    expect(caught(write)).toBeDefined();
    expect(textOf(note)).toEqual({ text: "Plain" });
  });

  test("a delete whose unlinking fails keeps its record, even for a Handler that catches it", () => {
    const note = linkedNote();
    env.conns.readwrite.exec(
      `CREATE TRIGGER refuse BEFORE DELETE ON capability_links BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    const port = createCapabilityDeleteMutationPort(
      SPEC,
      note,
      noFiles(SPEC, env.conns.readwrite).scope,
    );
    expect(caught(() => port.delete())).toBeDefined();
    expect(textOf(note)).toEqual({ text: "Brandon Sanderson" });
    expect(linksOf(note)).toEqual(toSanderson);
  });

  test("a field posting no pick keeps its row while its text and its record stand", () => {
    const unpicked: LinkBinding = { relations: [TEXT_TO_NAME], dormant: [], picks: new Map() };
    const note = linkedNote();
    updatePort(note, ["text"], unpicked).update({ text: "Brandon Sanderson" });
    expect(linksOf(note)).toEqual(toSanderson);
    updatePort(note, ["text"], unpicked).update({ text: "Brandon Sanderson, typed" });
    expect(linksOf(note)).toEqual(new Map());

    const dangling = linkedNote();
    env.conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    updatePort(dangling, ["text"], unpicked).update({ text: "Brandon Sanderson" });
    expect(linksOf(dangling)).toEqual(new Map());
  });

  test("a dormant relation's row sleeps through an edit, and goes when the edit changes its text", () => {
    const asleep: LinkBinding = { relations: [], dormant: [TEXT_TO_NAME], picks: new Map() };
    const note = linkedNote();
    updatePort(note, ["text"], asleep).update({ text: "Brandon Sanderson" });
    updatePort(note, ["pinned"], asleep).update({ pinned: true });
    expect(linksOf(note)).toEqual(toSanderson);
    updatePort(note, ["text"], asleep).update({ text: "Brandon Sanderson, typed" });
    expect(linksOf(note)).toEqual(new Map());
  });
});

describe("what a record picked", () => {
  test("is read for the relations that hold, in the lifetime each pins", () => {
    const id = linkedNote();
    const database = env.conns.readonly;
    expect(heldPicks(database, SPEC.id, id, [TEXT_TO_NAME])).toEqual(
      new Map([["text", SANDERSON]]),
    );
    expect(heldPicks(database, SPEC.id, id, [])).toEqual(new Map());
    const elsewhere = { ...TEXT_TO_NAME, to: { ...TEXT_TO_NAME.to, incarnation: "another" } };
    expect(heldPicks(database, SPEC.id, id, [elsewhere])).toEqual(new Map());
  });

  test("names no record since deleted, and fails no read when its target's table is gone", () => {
    const id = linkedNote();
    env.conns.readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    expect(heldPicks(env.conns.readonly, SPEC.id, id, [TEXT_TO_NAME])).toEqual(new Map());
    env.conns.readwrite.exec('DROP TABLE "cap_authors"');
    expect(heldPicks(env.conns.readonly, SPEC.id, id, [TEXT_TO_NAME])).toEqual(new Map());
  });
});
