// A linked field posts the record it picked beside its text, run through the shipped
// `public/controls/linked-field.js` on the renderer's own forms: a pick posts its id, an
// Edit form posts again the pick it was drawn with, and a field that picks nothing, or is
// plain text again, posts none.

import { describe, expect, test } from "bun:test";
import {
  CREATE_CANCELLED_EVENT,
  LINK_FIELD,
  linkFieldValue,
  PICKED_RECORD_ATTRIBUTE,
} from "#shell/core/shell-dom.js";
import { formState } from "#shell/records/unsaved-changes.js";
import { FIELD_NOT_LINKED_CODE } from "../../../../lifecycle/link/presentation.ts";
import { notesRow } from "../../../../runtime/router/dispatch/router.test-support.ts";
import type { El } from "../../double/choice-picker.test-support.ts";
import { held, installLinkGlobals, noticed, settle } from "../link-control.test-support.ts";
import {
  AUTHOR,
  dropdownScene,
  editBook,
  linkedBooks,
  NAMES,
  newBook,
  posted,
  records,
  TITLE,
} from "./linked-field.test-support.ts";

installLinkGlobals();

/** What `scene`'s form posts as the field's pick, if it posts one. */
function pickPosted(scene: Awaited<ReturnType<typeof dropdownScene>>): string[] {
  const form = scene.root.closest("form") as El;
  return posted(form)
    .filter(([name]) => name === LINK_FIELD)
    .map(([, value]) => value);
}

/** The author's id the pick route gives `name`. */
const idOf = (name: string) => `author-${NAMES.indexOf(name)}`;

describe("the Edit form", () => {
  test("names the record a linked field picked, and an unlinked field names none", () => {
    const picked = idOf("Brandon Sanderson");
    expect(editBook("Brandon Sanderson", linkedBooks(), picked)).toContain(
      `${PICKED_RECORD_ATTRIBUTE}="${picked}"`,
    );
    const unlinked = editBook("Brandon Sanderson", linkedBooks([AUTHOR, TITLE], []), picked);
    expect(unlinked).not.toContain(PICKED_RECORD_ATTRIBUTE);
  });
});

describe("a pick", () => {
  test("posts the record's id beside its text, and never the words typed to find it", async () => {
    const scene = await dropdownScene([records(), records()], newBook());
    expect(pickPosted(scene)).toEqual([]);
    scene.type("oct");
    await settle();
    scene.key("Enter");
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
  });

  test("in Edit, the pick the form was drawn with posts as it stands, before any read", async () => {
    const picked = idOf("Brandon Sanderson");
    const scene = await dropdownScene([], editBook("Brandon Sanderson", linkedBooks(), picked));
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", picked)]);
  });

  test("in Edit, a new pick takes the old one's place", async () => {
    const html = editBook("Brandon Sanderson", linkedBooks(), idOf("Brandon Sanderson"));
    const scene = await dropdownScene([records(), records()], html);
    scene.type("le guin");
    await settle();
    scene.key("Enter");
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Ursula K. Le Guin"))]);
  });

  test("is the record chosen in the list, beside another holding the same text", async () => {
    const twins = records(["Kindred", "Kindred"]);
    const scene = await dropdownScene([twins], editBook("Kindred", linkedBooks(), "author-1"));
    await settle();
    const chosen = scene.options().map((option) => option.getAttribute("aria-selected"));
    expect(chosen).toEqual(["false", "true"]);
    expect(scene.line.hidden).toBe(true);
  });
});

describe("text an Edit form was drawn with, and no pick", () => {
  test("that two records share names neither: the line asks for a pick, and none posts", async () => {
    const twins = records(["Kindred", "Kindred"]);
    const scene = await dropdownScene([twins], editBook("Kindred", linkedBooks()));
    await settle();
    const chosen = scene.options().map((option) => option.getAttribute("aria-selected"));
    expect(chosen).toEqual(["false", "false"]);
    expect(scene.line.hidden).toBe(false);
    expect(pickPosted(scene)).toEqual([]);
  });

  test("that one record holds names it, and posts it, as the matching scan links it", async () => {
    const scene = await dropdownScene([records()], editBook("  octavia E. BUTLER ", linkedBooks()));
    await settle();
    expect(scene.line.hidden).toBe(true);
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
  });

  test("that holds nothing to match names nothing, beside a record whose name is invisible", async () => {
    for (const html of [newBook(), editBook("", linkedBooks()), editBook(" ", linkedBooks())]) {
      const scene = await dropdownScene([records(["Brandon Sanderson", "\u200b"])], html);
      await settle();
      expect(pickPosted(scene)).toEqual([]);
      expect(
        scene.options().some((option) => option.getAttribute("aria-selected") === "true"),
      ).toBe(false);
    }
  });

  test("drawn on its record, asks nothing on leaving however late its list arrives", async () => {
    const html = editBook("Octavia E. Butler", linkedBooks(), idOf("Octavia E. Butler"));
    const late = held(records());
    const scene = await dropdownScene([late.reply], html);
    const form = scene.root.closest("form") as El;
    const touched = formState(form as never);
    late.release();
    await settle();
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
    expect(formState(form as never)).toBe(touched);
  });

  test("drawn on one record and naming another, counts a pick of the named one as a change", async () => {
    const drawnOn = idOf("Brandon Sanderson");
    const html = editBook("Octavia E. Butler", linkedBooks(), drawnOn);
    const scene = await dropdownScene([records(), records()], html);
    await settle();
    const form = scene.root.closest("form") as El;
    const untouched = formState(form as never);
    scene.type("octavia");
    await settle();
    scene.key("Enter");
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
    expect(formState(form as never)).not.toBe(untouched);
  });

  test("whose record went is read again once a save is refused, and posted no more", async () => {
    const without = records(NAMES.filter((name) => name !== "Octavia E. Butler"));
    const scene = await dropdownScene([records(), without], editBook("Octavia E. Butler"));
    await settle();
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
    const form = scene.root.closest("form") as El;
    scene.doc.fire("htmx:afterRequest", form, { detail: { xhr: { status: 422 } } });
    await settle();
    expect(scene.asked).toHaveLength(2);
    expect(pickPosted(scene)).toEqual([]);
  });

  test("posts it as no change of the person's, picked or not: leaving asks nothing for it", async () => {
    const html = editBook("Octavia E. Butler", linkedBooks());
    const unread = await dropdownScene([], html);
    const form = (scene: typeof unread) => scene.root.closest("form") as El;
    const read = await dropdownScene([records()], html);
    await settle();
    expect(pickPosted(read)).toEqual([linkFieldValue("author", idOf("Octavia E. Butler"))]);
    expect(formState(form(read) as never)).toBe(formState(form(unread) as never));
    read.type("octavia");
    await settle();
    read.key("Enter");
    expect(formState(form(read) as never)).toBe(formState(form(unread) as never));
    read.type("le guin");
    await settle();
    read.key("Enter");
    expect(formState(form(read) as never)).not.toBe(formState(form(unread) as never));
  });
});

describe("a read that lands while the list stands open", () => {
  test("keeps the keyboard on the record it was on, beside another holding the same text", async () => {
    const twins = ["Kindred", "Kindred", "Octavia E. Butler"];
    const second = held(records(twins));
    const html = editBook("Octavia E. Butler", linkedBooks(), "author-2");
    const scene = await dropdownScene([records(twins), second.reply], html);
    scene.input.focus();
    scene.key("ArrowDown");
    scene.key("ArrowUp");
    expect(scene.active()).toBe(scene.options()[1]?.id ?? null);
    second.release();
    await settle();
    scene.key("Enter");
    expect(pickPosted(scene)).toEqual([linkFieldValue("author", "author-1")]);
  });
});

describe("a field that picks nothing posts no pick", () => {
  test("once it is emptied and left", async () => {
    const html = editBook("Brandon Sanderson", linkedBooks(), idOf("Brandon Sanderson"));
    const scene = await dropdownScene([records(), records()], html);
    scene.input.focus();
    scene.type("");
    await settle();
    scene.key("Tab");
    expect(scene.carrier.value).toBe("");
    expect(pickPosted(scene)).toEqual([]);
  });

  test("once a finished create form puts it back", async () => {
    const scene = await dropdownScene([records(), records()], newBook());
    scene.type("san");
    await settle();
    scene.key("Enter");
    expect(pickPosted(scene)).toHaveLength(1);
    scene.doc.fire(CREATE_CANCELLED_EVENT, scene.root.closest("form") as El);
    expect(pickPosted(scene)).toEqual([]);
  });

  test("once its link turns out to be gone and it is plain text again", async () => {
    const notLinked = noticed(
      { code: FIELD_NOT_LINKED_CODE, source: { row: notesRow(), field: "text" } },
      422,
    );
    const html = editBook("Brandon Sanderson", linkedBooks(), idOf("Brandon Sanderson"));
    const scene = await dropdownScene([notLinked], html);
    await settle();
    const form = scene.doc.querySelector("form") as El;
    expect(posted(form).filter(([name]) => name === LINK_FIELD)).toEqual([]);
    expect(posted(form).filter(([name]) => name === "author")).toEqual([
      ["author", "Brandon Sanderson"],
    ]);
  });
});
