// Evolving either end of a link leaves the link alone. Notes evolved to hold a due date and
// Shelves evolved the same way each activate a new version with the relation and every link row as
// they were, the Gate passes on the capability Notes links to, and the shelf field is still a live
// dropdown. No prompt and no Diff Engine input carries a relation. Link, each activation, Unlink and
// the target's deletion all pass through the one relation diff, and no relation change makes a version.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { capabilityDeletionUrl, capabilityPickUrl, unlinkFieldUrl } from "#shell/core/routes.js";
import { assertSuccessfulGate } from "../../../builder/artifacts/publication/snapshot-contract.ts";
import * as diffEngine from "../../../builder/evolution/diff/diff-engine.ts";
import type { PickList } from "../../../lifecycle/link/pick/pick.ts";
import { SIXTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { CapabilitySpec, Relation } from "../../../registry/index.ts";
import * as relationDiffs from "../../../runtime/data/links/relation-diff/relation-diff.ts";
import { confirmationRequest } from "../../../server/routes/lifecycle/deletion.test-support.ts";
import { activated, DUE_DATE_FIELD, type EvolveResult } from "../run/evolution-run.test-support.ts";
import {
  closeLinkedDesk,
  evolveTo,
  LINK_URL,
  type LinkedDesk,
  linkRows,
  notesWith,
  openLinkedDesk,
  row,
  saveRecord,
  shelfDrawnAs,
  shelfTexts,
  shelvesWith,
} from "./linked-evolution.test-support.ts";

const diffs = spyOn(relationDiffs, "relationDiff");
const specDiffs = spyOn(diffEngine, "diffCapabilitySpec");

let desk: LinkedDesk;
let relations: Relation[];
/** How many changes the relation diff had been asked about before the link, and before evolving. */
const asked = { beforeLink: 0, beforeEvolving: 0 };
let rows: ReturnType<typeof linkRows>;
let texts: ReturnType<typeof shelfTexts>;
let notesEvolved: EvolveResult;
let shelvesEvolved: EvolveResult;
const kept: { relations: Relation[]; rows: typeof rows; texts: typeof texts }[] = [];

/** `spec` with a due date beside its other fields. */
function withDueDate(spec: CapabilitySpec): CapabilitySpec {
  return { ...spec, schema: { fields: [...spec.schema.fields, DUE_DATE_FIELD] } };
}

function standing() {
  const relations = [...row(desk, "notes").relations];
  return { relations, rows: linkRows(desk), texts: shelfTexts(desk) };
}

/** Each change the relation diff was asked about from the `from`th on, and the work it answered. */
function askedSince(from: number, to?: number) {
  const calls = diffs.mock.calls.slice(from, to).map(([change]) => change.kind);
  return { calls, work: diffs.mock.results.slice(from, to).map((result) => result.value) };
}

beforeAll(async () => {
  asked.beforeLink = diffs.mock.calls.length;
  desk = await openLinkedDesk();
  asked.beforeEvolving = diffs.mock.calls.length;
  ({ relations, rows, texts } = standing());
  specDiffs.mockClear();
  notesEvolved = await evolveTo(desk, withDueDate(notesWith()), "notes-due-date");
  kept.push(standing());
  shelvesEvolved = await evolveTo(desk, withDueDate(shelvesWith()), "shelves-due-date");
  kept.push(standing());
}, 120_000);

afterAll(() => {
  diffs.mockRestore();
  specDiffs.mockRestore();
  closeLinkedDesk(desk);
});

describe("an evolution of either end carries the link forward", () => {
  test("each activates a new version with the relation, every link row and every text kept", () => {
    expect(rows).toEqual([
      ["note-oak", "shelf-oak"],
      ["note-pine", "shelf-pine"],
    ]);
    expect([row(desk, "notes").version, row(desk, "shelves").version]).toEqual([2, 2]);
    expect(kept).toEqual([
      { relations, rows, texts },
      { relations, rows, texts },
    ]);
  });

  test("the capability others link to passes the Gate, as the linking one does", () => {
    expect(() => assertSuccessfulGate(activated(shelvesEvolved).assembly.gate)).not.toThrow();
    expect(() => assertSuccessfulGate(activated(notesEvolved).assembly.gate)).not.toThrow();
  });

  test("the shelf is still a dropdown whose pick and whose target's rename both reach the note", async () => {
    expect(await shelfDrawnAs(desk)).toBe("dropdown");
    const picked = { shelf: "shelf-elm" };
    expect((await saveRecord(desk, "notes", "note-birch", { shelf: "x" }, picked)).status).toBe(
      200,
    );
    expect((await saveRecord(desk, "shelves", "shelf-oak", { name: "Old Oak" })).status).toBe(200);
    expect(shelfTexts(desk)).toMatchObject({ "note-birch": "Elm", "note-oak": "Old Oak" });
  });
});

describe("no relation reaches the model or the Diff Engine", () => {
  test("no prompt either evolution sent carries a relation", () => {
    const prompts = [...notesEvolved.prompts, ...shelvesEvolved.prompts];
    expect(prompts.length).toBeGreaterThan(2);
    const [relation] = relations;
    if (!relation) throw new Error("the shelf holds no relation");
    const written = [relations, relation, relation.to].flatMap((value) => [
      JSON.stringify(value),
      JSON.stringify(value, null, 2),
    ]);
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/"relations"\s*:/);
      for (const each of written) expect(prompt).not.toContain(each);
    }
  });

  test("no spec the Diff Engine compared carries one", () => {
    expect(specDiffs.mock.calls).toHaveLength(2);
    for (const [committed, candidate] of specDiffs.mock.calls) {
      expect(Object.keys(committed)).not.toContain("relations");
      expect(Object.keys(candidate)).not.toContain("relations");
    }
  });
});

describe("every relation change passes through the one relation diff", () => {
  test("Link and each activation did, and an activation of a held relation found no work", () => {
    expect(askedSince(asked.beforeLink, asked.beforeEvolving).calls).toEqual(["link"]);
    expect(askedSince(asked.beforeEvolving)).toEqual({
      calls: ["activation", "activation"],
      work: [[], []],
    });
  });

  test("Unlink and the target's deletion do too, and neither makes a version", async () => {
    const list = (await (
      await desk.app.request(capabilityPickUrl("notes", "shelf"))
    ).json()) as PickList;
    const beforeUnlink = diffs.mock.calls.length;
    const unlinked = await desk.app.request(unlinkFieldUrl(LINK_URL), {
      method: "POST",
      body: new URLSearchParams(list.unlinking.press),
    });
    expect(unlinked.status).toBe(204);
    const deleted = await desk.app.request(
      `${capabilityDeletionUrl("shelves")}/confirm`,
      confirmationRequest(SIXTH_INCARNATION_ID),
    );
    expect(deleted.status).toBe(200);

    expect(askedSince(beforeUnlink).calls).toEqual(["unlink", "deletion"]);
    expect(row(desk, "notes").version).toBe(2);
    expect(row(desk, "notes").relations).toEqual([]);
  });
});
