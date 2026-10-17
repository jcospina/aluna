// The open icon inside a linked field, run through the shipped `public/controls/linked-field.js` on
// the renderer's own forms: it follows the record a save would post, and it is hidden wherever a
// save would post no record. Its press is `linked-field.open-press.test.ts`.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { CREATE_CANCELLED_EVENT } from "#shell/core/shell-dom.js";
import { formState } from "#shell/records/unsaved-changes.js";
import type { El } from "../../double/choice-picker.test-support.ts";
import { held, installLinkGlobals, settle } from "../link-control.test-support.ts";
import {
  AUTHOR,
  AUTHOR_TO_NAME,
  dropdownScene,
  editBook,
  linkedBooks,
  NAMES,
  newBook,
  records,
  TITLE,
} from "./linked-field.test-support.ts";
import { at, authors, iconOf, idOf, notLinked, pointing } from "./open-icon.test-support.ts";

installLinkGlobals();

const LE_GUIN = "Ursula K. Le Guin";
const leGuinsBook = () => editBook(LE_GUIN, linkedBooks(), idOf(LE_GUIN));

describe("the icon follows the record a save would post", () => {
  test("on an existing record, the pick it was drawn with", async () => {
    const scene = await dropdownScene([authors()], leGuinsBook());
    expect(pointing(scene)).toEqual(at(LE_GUIN));
    expect(pointing(scene)?.name).toContain(LE_GUIN);
    expect(scene.line.hidden).toBe(true);
    // Inside the field's root, so the line under the field stays the root's next sibling.
    expect(scene.root.contains(iconOf(scene) as El)).toBe(true);
    expect(scene.root.nextElementSibling).toBe(scene.line);
  });

  test("once the records are read, and not before", async () => {
    const gate = held(authors());
    const scene = await dropdownScene([gate.reply], leGuinsBook());
    expect(iconOf(scene)?.hidden).toBe(true);
    gate.release();
    await settle();
    expect(pointing(scene)).toEqual(at(LE_GUIN));
  });

  test("with no pick, the one record its text names", async () => {
    const scene = await dropdownScene([authors()], editBook("octavia e. butler", linkedBooks()));
    expect(pointing(scene)?.href).toBe(at("Octavia E. Butler").href);
    expect(pointing(scene)?.name).toBe(at("octavia e. butler").name);
  });

  test("a new pick points it at the record picked", async () => {
    const scene = await dropdownScene([authors(), authors()], newBook());
    expect(pointing(scene)).toBeNull();
    scene.type("oct");
    await settle();
    scene.key("Enter");
    expect(pointing(scene)).toEqual(at("Octavia E. Butler"));
    scene.type("brandon");
    await settle();
    scene.key("Enter");
    expect(pointing(scene)).toEqual(at("Brandon Sanderson"));
  });

  test("a new pick is a change the form would lose, so leaving asks first", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    const form = scene.root.closest("form") as El;
    const drawn = formState(form as never);
    scene.type("oct");
    await settle();
    scene.key("Enter");
    expect(pointing(scene)).toEqual(at("Octavia E. Butler"));
    expect(formState(form as never)).not.toBe(drawn);
  });

  test("emptying the field hides it, and so does putting a create form down", async () => {
    const edit = await dropdownScene([authors(), authors()], leGuinsBook());
    edit.input.focus();
    edit.type("");
    await settle();
    edit.key("Tab");
    expect(pointing(edit)).toBeNull();
    expect(edit.line.hidden).toBe(true);
    // An icon that opens nothing keeps no address and no name of the record it opened.
    expect(iconOf(edit)?.hasAttribute("href")).toBe(false);
    expect(iconOf(edit)?.hasAttribute("aria-label")).toBe(false);

    const create = await dropdownScene([authors(), authors()], newBook());
    create.type("san");
    await settle();
    create.key("Enter");
    expect(pointing(create)).toEqual(at("Brandon Sanderson"));
    create.doc.fire(CREATE_CANCELLED_EVENT, create.root.closest("form") as El);
    expect(pointing(create)).toBeNull();
  });
});

describe("the icon is hidden", () => {
  test("in a new record, where the field is empty and the line under it is hidden too", async () => {
    const scene = await dropdownScene([authors()], newBook());
    expect(pointing(scene)).toBeNull();
    expect(scene.line.hidden).toBe(true);
  });

  test("beside an empty field, even one drawn with a pick", async () => {
    for (const text of ["", "   "]) {
      const scene = await dropdownScene([authors()], editBook(text, linkedBooks(), idOf(LE_GUIN)));
      expect(pointing(scene), JSON.stringify(text)).toBeNull();
      expect(scene.line.hidden, JSON.stringify(text)).toBe(true);
    }
  });

  test("beside text that names no record, where the line under the field shows instead", async () => {
    const scene = await dropdownScene([authors()], editBook("Ursula Le Guin", linkedBooks()));
    expect(pointing(scene)).toBeNull();
    expect(scene.line.hidden).toBe(false);
  });

  test("beside text two records share, which names neither", async () => {
    const twice = [...NAMES, "Octavia E. Butler"];
    const scene = await dropdownScene(
      [records(twice, () => randomUUID())],
      editBook("Octavia E. Butler", linkedBooks()),
    );
    expect(pointing(scene)).toBeNull();
    expect(scene.line.hidden).toBe(false);
  });

  test("for a pick whose record is no longer among the records read", async () => {
    const gone = randomUUID();
    const scene = await dropdownScene([authors()], editBook(LE_GUIN, linkedBooks(), gone));
    expect(pointing(scene)).toBeNull();
    expect(scene.line.hidden).toBe(false);
  });

  test("for a record id no address can carry", async () => {
    const scene = await dropdownScene([records()], editBook("Octavia E. Butler", linkedBooks()));
    expect(scene.line.hidden).toBe(true);
    expect(pointing(scene)).toBeNull();
  });

  test("on a field that turns out not to be linked, which is plain text again", async () => {
    const scene = await dropdownScene([notLinked], leGuinsBook());
    await settle();
    expect(iconOf(scene)).toBeNull();
    expect(scene.doc.querySelector('input[name="author"]')?.value).toBe(LE_GUIN);
  });
});

describe("nothing about a link stops a record opening", () => {
  // A link row that dangles, or names a lifetime of the target that is gone, is no pick: the
  // store draws the form without one (`heldPicks`, `src/runtime/data/links/picks.test.ts`).
  test("a link row the store no longer stands behind leaves the field to its text", async () => {
    const unnamed = await dropdownScene([authors()], editBook("Mary Shelley", linkedBooks()));
    expect(unnamed.input.value).toBe("Mary Shelley");
    expect(pointing(unnamed)).toBeNull();
    // Text that still names one record opens it, as a save would post it.
    const named = await dropdownScene([authors()], editBook(LE_GUIN, linkedBooks()));
    expect(pointing(named)).toEqual(at(LE_GUIN));
  });

  test("a dormant relation draws its field as plain text, with no icon", async () => {
    const dormant = { ...linkedBooks([AUTHOR, TITLE], [AUTHOR_TO_NAME]), linkedFields: [] };
    const scene = await dropdownScene([], editBook(LE_GUIN, dormant, idOf(LE_GUIN)));
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    expect(scene.doc.querySelector(".linked-field__open")).toBeNull();
    expect(scene.doc.querySelector('input[name="author"]')?.value).toBe(LE_GUIN);
  });
});
