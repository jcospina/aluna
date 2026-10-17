// Hiding either end of a link puts it to sleep. Through scripted evolutions: its link rows
// stay, nothing draws or answers a dropdown, a renamed target leaves the sleeping field alone, and a
// deleted target record still takes its row. Reactivating the field wakes the relation with its
// rows, in the activation's own transaction: each linked record shows its target's current text,
// and a name typed before is matched as every boot matches it. While a source's target is hidden,
// the source is plain text with no chain, Unlink is out of reach, Link refuses the field, and a
// save that changes its text lets its row go.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FIELD_NOT_LINKED_CODE } from "../../../lifecycle/link/presentation.ts";
import type { Relation } from "../../../registry/index.ts";
import {
  closeLinkedDesk,
  createRecord,
  deleteRecord,
  evolveTo,
  LINK_URL,
  type LinkedDesk,
  linkRows,
  notesWith,
  openLinkedDesk,
  pickStatus,
  press,
  pressUnlink,
  refusal,
  row,
  saveRecord,
  shelfDrawnAs,
  shelfNamed,
  shelfTexts,
  shelvesWith,
} from "./linked-evolution.test-support.ts";

describe("a hidden source", () => {
  let desk: LinkedDesk;
  let relations: Relation[];
  let linked: ReturnType<typeof linkRows>;

  beforeAll(async () => {
    desk = await openLinkedDesk();
    relations = [...row(desk, "notes").relations];
    linked = linkRows(desk);
    await evolveTo(desk, notesWith({ lifecycle: "inactive" }), "hide-shelf");
  }, 60_000);

  afterAll(() => closeLinkedDesk(desk));

  test("sleeps with its relation and rows, drawn nowhere, its dropdown answering none", async () => {
    expect(row(desk, "notes").relations).toEqual(relations);
    expect(linkRows(desk)).toEqual(linked);
    expect(await shelfDrawnAs(desk)).toBe("absent");
    expect(await pickStatus(desk)).toBe(422);
  });

  test("keeps its text when its shelf is renamed, and loses the row of a shelf deleted", async () => {
    expect((await saveRecord(desk, "shelves", "shelf-oak", { name: "Old Oak" })).status).toBe(200);
    expect((await deleteRecord(desk, "shelves", "shelf-pine")).status).toBe(200);
    const birch = { text: "The birch shelf", name: "Birch" };
    expect((await createRecord(desk, "shelves", birch)).status).toBe(200);

    expect(shelfTexts(desk)).toMatchObject({ "note-oak": "Oak", "note-pine": " pine " });
    expect(linkRows(desk)).toEqual([["note-oak", "shelf-oak"]]);
  });

  test("wakes when reactivated: its shelf's current name, a typed name matched, a dropdown", async () => {
    await evolveTo(desk, notesWith(), "reactivate-shelf");
    const birch = shelfNamed(desk, "Birch");

    expect(shelfTexts(desk)).toMatchObject({
      "note-oak": "Old Oak",
      "note-pine": " pine ",
      "note-birch": "Birch",
    });
    expect(linkRows(desk)).toEqual([
      ["note-birch", birch],
      ["note-oak", "shelf-oak"],
    ]);
    expect(await shelfDrawnAs(desk)).toBe("dropdown");
    expect(await pickStatus(desk)).toBe(200);
  });
});

describe("a hidden target", () => {
  let desk: LinkedDesk;
  let relations: Relation[];
  let linked: ReturnType<typeof linkRows>;

  beforeAll(async () => {
    desk = await openLinkedDesk();
    relations = [...row(desk, "notes").relations];
    linked = linkRows(desk);
    await evolveTo(desk, shelvesWith({ lifecycle: "inactive" }), "hide-name");
  }, 60_000);

  afterAll(() => closeLinkedDesk(desk));

  test("leaves its source asleep with its rows: plain text, with neither dropdown nor chain", async () => {
    expect(row(desk, "notes").relations).toEqual(relations);
    expect(linkRows(desk)).toEqual(linked);
    expect(await shelfDrawnAs(desk)).toBe("plain");
    expect(await pickStatus(desk)).toBe(422);
  });

  test("leaves Unlink out of reach, and Link refuses the field, while the relation sleeps", async () => {
    expect(await refusal(await pressUnlink(desk))).toEqual([422, FIELD_NOT_LINKED_CODE]);
    expect(await refusal(await press(desk, LINK_URL))).toEqual([422, "source_already_linked"]);
    expect(row(desk, "notes").relations).toEqual(relations);
  });

  test("lets a row go when a save changes its text, and keeps one whose text stands", async () => {
    expect((await saveRecord(desk, "notes", "note-oak", { shelf: "Oak, top" })).status).toBe(200);
    const moved = { text: "A note moved", shelf: " pine " };
    expect((await saveRecord(desk, "notes", "note-pine", moved)).status).toBe(200);

    expect(linkRows(desk)).toEqual([["note-pine", "shelf-pine"]]);
  });

  test("wakes when reactivated: the linked note shows its shelf's name, the typed one stays", async () => {
    await evolveTo(desk, shelvesWith(), "reactivate-name");

    expect(shelfTexts(desk)).toMatchObject({ "note-oak": "Oak, top", "note-pine": "Pine" });
    expect(linkRows(desk)).toEqual([["note-pine", "shelf-pine"]]);
    expect(await shelfDrawnAs(desk)).toBe("dropdown");
  });
});
