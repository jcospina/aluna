// A linked field at its edges, run through the shipped `public/controls/linked-field.js`: the window
// before its records are first read, a read that lands while the list stands open, a field whose
// link turns out to be gone, the field's error and description, an input method's Enter, and an
// optional field emptied on purpose. Each case is one an adversarial review found broken.

import { describe, expect, test } from "bun:test";
import { startFieldErrors } from "#shell/fields/field-errors.js";
import {
  FIELD_NOT_LINKED_CODE,
  linkNoticeSentence,
} from "../../../../lifecycle/link/presentation.ts";
import { notesRow } from "../../../../runtime/router/dispatch/router.test-support.ts";
import { probeField } from "../../../fields/field-renderer.test-support.ts";
import type { El } from "../../double/choice-picker.test-support.ts";
import { held, installLinkGlobals, noticed, settle } from "../link-control.test-support.ts";
import {
  dropdownScene,
  editBook,
  linkedBooks,
  NAMES,
  newBook,
  records,
  TITLE,
} from "./linked-field.test-support.ts";

installLinkGlobals();

const notLinked = noticed(
  { code: FIELD_NOT_LINKED_CODE, source: { row: notesRow(), field: "text" } },
  422,
);
const broken = () => new Response("Internal Server Error", { status: 500 });

/** Every node a scene's field is drawn from keeps its document once detached, as a browser's does. */
function keepDocument(scene: Awaited<ReturnType<typeof dropdownScene>>) {
  for (const node of [scene.root, ...scene.root.descendants()]) {
    Object.defineProperty(node, "ownerDocument", { get: () => scene.doc, configurable: true });
  }
}

describe("before the records are first read", () => {
  test("typing and leaving puts the text back, though no list ever opened", async () => {
    const first = held(records());
    const scene = await dropdownScene([first.reply], editBook("Octavia E. Butler"));
    scene.input.focus();
    scene.type("xyz");
    scene.doc.fire("focusout", scene.input, { relatedTarget: null });
    expect(scene.input.value).toBe("Octavia E. Butler");
    first.release();
    await settle();
    expect(scene.panel.hidden).toBe(true);
    expect(scene.carrier.value).toBe("Octavia E. Butler");
  });

  test("a first read that failed still puts typed text back on Tab", async () => {
    const scene = await dropdownScene([broken, broken], editBook("Octavia E. Butler"));
    scene.input.focus();
    scene.type("zzz");
    await settle();
    // A Tab is its keydown and then focus moving on.
    scene.key("Tab");
    scene.doc.fire("focusout", scene.input, { relatedTarget: null });
    expect(scene.input.value).toBe("Octavia E. Butler");
  });

  test("an optional field emptied and left by Tab stays empty, though its records are unread", async () => {
    for (const first of [held(broken), held(records())]) {
      const scene = await dropdownScene([first.reply, broken], editBook("Octavia E. Butler"));
      scene.input.focus();
      scene.type("");
      scene.key("Tab");
      scene.doc.fire("focusout", scene.input, { relatedTarget: null });
      first.release();
      await settle();
      expect(scene.carrier.value).toBe("");
    }
  });

  test("an input method's Escape leaves what is being composed alone", async () => {
    const first = held(records());
    const scene = await dropdownScene([first.reply], editBook("Octavia E. Butler"));
    scene.input.focus();
    scene.type("おく");
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      scene.doc.fire("keydown", scene.input, { key: "Escape", ...extra });
      expect(scene.input.value).toBe("おく");
    }
    first.release();
    await settle();
  });

  test("Escape lets go of an opening still waiting on the read", async () => {
    const first = held(records());
    const scene = await dropdownScene([first.reply], editBook("Octavia E. Butler"));
    scene.input.focus();
    scene.key("ArrowDown");
    scene.key("Escape");
    first.release();
    await settle();
    expect(scene.panel.hidden).toBe(true);
  });

  test("a refusal for a field taken off the page meanwhile says nothing", async () => {
    const first = held(noticed({ code: "link_stale", moved: null, opening: true }, 409));
    const scene = await dropdownScene([first.reply]);
    scene.key("ArrowDown");
    scene.field.remove();
    first.release();
    await settle();
    expect(scene.said).toEqual([]);
  });
});

describe("a read that lands while the list stands open", () => {
  test("keeps the keyboard on the record it was on, so Enter picks that one", async () => {
    const second = held(records());
    const scene = await dropdownScene([records(), second.reply], editBook("Brandon Sanderson"));
    scene.input.focus();
    scene.key("ArrowDown");
    scene.key("ArrowDown");
    scene.key("ArrowDown");
    second.release();
    await settle();
    scene.key("Enter");
    expect(scene.carrier.value).toBe(NAMES[2] as string);
  });
});

describe("a field whose link is gone is plain text, and only plain text", () => {
  test("its counter goes back after the guidance slot, where the server drew it", async () => {
    const limited = probeField("string", { name: "author", label: "Author", max_length: 120 });
    const scene = await dropdownScene(
      [notLinked],
      editBook("Ursula Le Guin", linkedBooks([limited, TITLE])),
    );
    const field = (scene.doc.getElementById("edit-books-author") as El).closest(".field") as El;
    const lines = field.children.filter((child) => child.tag === "p").map((p) => p.className);
    expect(lines).toEqual(["field__guidance", "field__guidance field__guidance--count"]);
  });

  test("turned plain by its first read, it takes typing, Enter and a press as any text field does", async () => {
    const first = held(notLinked);
    const scene = await dropdownScene([first.reply], editBook("Ursula Le Guin"));
    keepDocument(scene);
    first.release();
    await settle();
    const input = scene.doc.getElementById("edit-books-author") as El;
    input.focus();
    input.value = "Ursula K. Le Guin";
    scene.doc.fire("input", input);
    expect(scene.doc.fire("keydown", input, { key: "Enter" }).prevented).toBe(false);
    input.selection = null;
    scene.doc.fire("click", input);
    await settle();
    expect(input.selection).toBeNull();
    expect(input.value).toBe("Ursula K. Le Guin");
    expect(scene.asked).toHaveLength(1);
  });

  test("turned plain while someone waited to open it, it says why", async () => {
    const first = held(notLinked);
    const scene = await dropdownScene([first.reply], editBook("Ursula Le Guin"));
    scene.key("ArrowDown");
    first.release();
    await settle();
    const sentence = linkNoticeSentence({
      code: FIELD_NOT_LINKED_CODE,
      source: { row: notesRow(), field: "text" },
    });
    expect(scene.said).toEqual([{ sentence, refused: true }]);
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
  });

  test("turned plain under the person, it keeps their focus, and an open list says why it went", async () => {
    const second = held(notLinked);
    const scene = await dropdownScene([records(), second.reply], editBook("Ursula Le Guin"));
    keepDocument(scene);
    scene.input.focus();
    scene.key("ArrowDown");
    expect(scene.panel.hidden).toBe(false);
    second.release();
    await settle();
    const input = scene.doc.getElementById("edit-books-author") as El;
    expect(input.getAttribute("name")).toBe("author");
    expect(scene.doc.activeElement).toBe(input);
    expect(scene.said).toHaveLength(1);
  });

  test("a re-read that fails under an open list keeps the list it read, and says nothing", async () => {
    const second = held(broken);
    const scene = await dropdownScene([records(), second.reply], editBook("Ursula Le Guin"));
    scene.input.focus();
    scene.key("ArrowDown");
    second.release();
    await settle();
    expect(scene.panel.hidden).toBe(false);
    expect(scene.options()).toHaveLength(NAMES.length);
    expect(scene.said).toEqual([]);
  });

  test("turned plain after a good read, what is typed into it afterwards stays", async () => {
    const scene = await dropdownScene([records(), notLinked], editBook("Ursula Le Guin"));
    keepDocument(scene);
    scene.input.focus();
    scene.key("ArrowDown");
    await settle();
    const input = scene.doc.getElementById("edit-books-author") as El;
    expect(input.getAttribute("name")).toBe("author");
    input.focus();
    input.value = "Ann Leckie";
    scene.doc.fire("input", input);
    await settle();
    expect(input.value).toBe("Ann Leckie");
    expect(input.hasAttribute("aria-expanded")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

describe("what the field says about itself", () => {
  test("a required field's error stands while a search finds nothing to pick", async () => {
    const required = probeField("string", { name: "author", label: "Author", required: true });
    const scene = await dropdownScene(
      [records(), records()],
      newBook(linkedBooks([required, TITLE])),
    );
    startFieldErrors(scene.doc as never);
    expect(scene.doc.fire("submit", scene.root.closest("form") as El).prevented).toBe(true);
    expect(scene.field.classList.contains("is-invalid")).toBe(true);
    scene.type("tolk");
    await settle();
    scene.key("Escape");
    expect(scene.field.classList.contains("is-invalid")).toBe(true);
    scene.type("san");
    await settle();
    scene.key("Enter");
    expect(scene.field.classList.contains("is-invalid")).toBe(false);
  });

  test("the line asking for a pick is in the description only while it shows", async () => {
    const said = (scene: Awaited<ReturnType<typeof dropdownScene>>) =>
      (scene.input.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => scene.doc.getElementById(id)?.textContent ?? "")
        .join(" ");
    const matched = await dropdownScene([records()], editBook("Brandon Sanderson"));
    expect(said(matched)).not.toContain(matched.line.textContent);
    const unmatched = await dropdownScene([records(), records()], editBook("Ursula Le Guin"));
    expect(said(unmatched)).toContain(unmatched.line.textContent);
    unmatched.type("san");
    await settle();
    unmatched.key("Enter");
    expect(said(unmatched)).not.toContain(unmatched.line.textContent);
  });

  test("the Enter that ends an input method's composition is the input method's", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.type("san");
    await settle();
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      const enter = scene.doc.fire("keydown", scene.input, { key: "Enter", ...extra });
      expect(enter.prevented).toBe(false);
    }
    expect(scene.carrier.value).toBe("");
  });
});

describe("an optional field emptied and left", () => {
  test("stays empty, and says so as any change does", async () => {
    for (const leave of ["Tab", "outside", "blur"] as const) {
      const scene = await dropdownScene([records(), records()], editBook("Brandon Sanderson"));
      scene.input.focus();
      scene.type("");
      await settle();
      if (leave === "outside") scene.doc.fire("pointerdown", scene.doc.body);
      else if (leave === "blur") scene.doc.fire("focusout", scene.input, { relatedTarget: null });
      else scene.key(leave);
      expect(scene.carrier.value, leave).toBe("");
      expect(scene.input.value, leave).toBe("");
      expect(scene.doc.changes, leave).toEqual([{ value: "" }]);
    }
  });

  test("but Escape puts it back, and a required field is never left empty", async () => {
    const escaped = await dropdownScene([records(), records()], editBook("Brandon Sanderson"));
    escaped.type("");
    await settle();
    escaped.key("Escape");
    expect(escaped.carrier.value).toBe("Brandon Sanderson");

    const required = probeField("string", { name: "author", label: "Author", required: true });
    const html = editBook("Brandon Sanderson", linkedBooks([required, TITLE]));
    const scene = await dropdownScene([records(), records()], html);
    scene.type("");
    await settle();
    scene.key("Tab");
    expect(scene.carrier.value).toBe("Brandon Sanderson");
    expect(scene.input.value).toBe("Brandon Sanderson");
  });
});
