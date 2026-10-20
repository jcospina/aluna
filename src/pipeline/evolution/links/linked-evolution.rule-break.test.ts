// An evolution that breaks the link rules under a live relation puts it to sleep (ADR-0011).
// Shelves' name given a limit above Notes' shelf, or Notes' shelf moved into long text: the relation
// keeps its rows, and the shelf stays an active field drawn as plain text, with neither dropdown nor
// chain. A renamed shelf leaves it alone, and a save that changes its text lets its row go, so the
// revival never writes over what was typed. When the rule holds again the relation wakes with the
// rows it kept, each showing its shelf's current name.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FIELD_NOT_LINKED_CODE } from "../../../lifecycle/link/presentation.ts";
import type { Relation } from "../../../registry/index.ts";
import {
  closeLinkedDesk,
  evolveTo,
  fieldDrawnAs,
  type LinkedDesk,
  linkRows,
  notesWith,
  openLinkedDesk,
  pickStatus,
  pressUnlink,
  refusal,
  row,
  SHELF_FIELD,
  saveRecord,
  shelfTexts,
  shelvesWith,
} from "./linked-evolution.test-support.ts";

const WIDER = (SHELF_FIELD.max_length ?? 0) * 2;

let desk: LinkedDesk;
let relations: Relation[];
let linked: ReturnType<typeof linkRows>;

beforeAll(async () => {
  desk = await openLinkedDesk();
  relations = [...row(desk, "notes").relations];
  linked = linkRows(desk);
}, 60_000);

afterAll(() => closeLinkedDesk(desk));

describe("a target allowed longer names than its source holds", () => {
  beforeAll(() => evolveTo(desk, shelvesWith({ max_length: WIDER }), "wider-name"), 60_000);

  test("puts the relation to sleep with its rows, the shelf active and plain", async () => {
    expect(row(desk, "notes").relations).toEqual(relations);
    expect(linkRows(desk)).toEqual(linked);
    expect(await fieldDrawnAs(desk)).toBe("plain");
    expect(await pickStatus(desk)).toBe(422);
    expect(await refusal(await pressUnlink(desk))).toEqual([422, FIELD_NOT_LINKED_CODE]);
  });

  test("leaves the shelf alone when its target is renamed, and a changed text lets its row go", async () => {
    expect((await saveRecord(desk, "shelves", "shelf-oak", { name: "Old Oak" })).status).toBe(200);
    expect((await saveRecord(desk, "notes", "note-pine", { shelf: "Pine, low" })).status).toBe(200);

    expect(shelfTexts(desk)).toMatchObject({ "note-oak": "Oak", "note-pine": "Pine, low" });
    expect(linkRows(desk)).toEqual([["note-oak", "shelf-oak"]]);
  });

  test("wakes when the source is let hold as much, each kept row showing its shelf's name", async () => {
    await evolveTo(desk, notesWith({ max_length: WIDER }), "wider-shelf");

    expect(shelfTexts(desk)).toMatchObject({ "note-oak": "Old Oak", "note-pine": "Pine, low" });
    expect(linkRows(desk)).toEqual([["note-oak", "shelf-oak"]]);
    expect(await fieldDrawnAs(desk)).toBe("dropdown");
  });
});

describe("a source moved into long text", () => {
  beforeAll(
    () => evolveTo(desk, notesWith({ max_length: WIDER }, ["shelf"]), "long-shelf"),
    60_000,
  );

  test("puts the relation to sleep with its rows, drawn as plain text", async () => {
    expect(row(desk, "notes").relations).toEqual(relations);
    expect(linkRows(desk)).toEqual([["note-oak", "shelf-oak"]]);
    expect(await fieldDrawnAs(desk)).toBe("plain");
    expect(await pickStatus(desk)).toBe(422);
  });

  test("wakes when it is one line again, its rows kept", async () => {
    expect((await saveRecord(desk, "shelves", "shelf-oak", { name: "Oak" })).status).toBe(200);
    await evolveTo(desk, notesWith({ max_length: WIDER }), "short-shelf");

    expect(shelfTexts(desk)).toMatchObject({ "note-oak": "Oak" });
    expect(linkRows(desk)).toEqual([["note-oak", "shelf-oak"]]);
    expect(await fieldDrawnAs(desk)).toBe("dropdown");
  });
});
