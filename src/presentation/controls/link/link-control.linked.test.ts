// Once a pick is written, run through the shipped `public/controls/link-control.js` on the markup the
// renderer writes: where focus goes, and how every copy of the field, on the page and in each
// record's template, gives up its chain and stands as the server draws a linked field, in the
// wrapper `linked-field.js` draws its dropdown in. A refusal that says the chain is finished does
// the same, or leaves the field plain text when it can no longer be linked.

import { describe, expect, test } from "bun:test";
import { pageOf } from "#shell/controls/link-notices.js";
import { startLinkedFields } from "#shell/controls/linked-field.js";
import { capabilityLinkUrl, capabilityPickUrl } from "#shell/core/routes.js";
import { linkNoticeSentence } from "../../../lifecycle/link/presentation.ts";
import { renderCreateForm, renderEditForm } from "../../fields/field-renderer.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { NAMES, records } from "./dropdown/linked-field.test-support.ts";
import {
  ALREADY_LINKED,
  AUTHOR,
  bookCapability,
  deskWithTemplate,
  held,
  installLinkGlobals,
  linkScene,
  listed,
  NOT_LINKABLE,
  noticed,
  openScene,
  settle,
  TITLE,
  written,
} from "./link-control.test-support.ts";

installLinkGlobals();

const LINK_URL = capabilityLinkUrl("books", AUTHOR.name);
const refusal = (sentence: string) => ({ sentence, refused: true });
const PICK_URL = capabilityPickUrl("books", AUTHOR.name);

/** The server's own drawing of the author field once linked, to hold each copy the client made to. */
const SERVER_LINKED = parseHtml(
  renderCreateForm({
    ...bookCapability(),
    relations: [
      { field: "author", to: { capability: "authors", incarnation: "x", field: "name" } },
    ],
    linkedFields: ["author"],
  }),
  new Doc(),
).querySelector("[data-linked-field]") as El;

/** Whether `input` stands as the server draws a linked field: its shell alone in the wrapper. */
function drawnLinked(input: El): boolean {
  const shell = input.parent as El;
  const wrapper = shell.parent as El;
  return (
    shell.className === "field__control" &&
    shell.children.length === 1 &&
    wrapper.className === SERVER_LINKED.className &&
    wrapper.hasAttribute("data-linked-field") &&
    wrapper.getAttribute("data-pick-url") === SERVER_LINKED.getAttribute("data-pick-url") &&
    wrapper.getAttribute("data-pick-url") === PICK_URL &&
    wrapper.children.length === 1
  );
}

describe("once a pick is written", () => {
  test("once written, the chain and its chooser go and the field stands as a linked one, focused", async () => {
    const scene = await openScene([written]);
    const field = scene.root.parent as El;
    await scene.press(scene.options()[0] as El);
    expect(scene.doc.querySelector("[data-link-control]")).toBeNull();
    expect(scene.doc.querySelector(".link-control__button")).toBeNull();
    expect(scene.doc.querySelector(".listbox__panel")).toBeNull();
    expect(drawnLinked(scene.input)).toBe(true);
    expect(scene.shell.parent?.parent).toBe(field);
    expect(scene.doc.activeElement).toBe(scene.input);
  });

  test("focus goes to the input from the page itself, but stays where the person took it", async () => {
    for (const [elsewhere, lands] of [
      [false, "input"],
      [true, "title"],
    ] as const) {
      const write = held(written);
      const scene = await openScene(
        [write.reply],
        renderCreateForm(bookCapability([AUTHOR, TITLE])),
      );
      await scene.press(scene.options()[0] as El);
      const title = scene.doc.getElementById("cap-books-title") as El;
      if (elsewhere) title.focus();
      else scene.button.blur();
      write.release();
      await settle();
      expect(scene.doc.activeElement).toBe(lands === "input" ? scene.input : title);
    }
  });

  test("focus on another copy's chain lands in that copy's input, not on the page", async () => {
    const write = held(written);
    const page =
      renderCreateForm(bookCapability()) + renderEditForm(bookCapability(), { id: "book-1" });
    const scene = await openScene([write.reply], page);
    await scene.press(scene.options()[0] as El);
    const copy = scene.chooserOf("edit-books-author");
    copy.button.focus();
    write.release();
    await settle();
    expect(scene.doc.activeElement).toBe(scene.doc.getElementById("edit-books-author") as El);
  });

  test("every other copy of the field gives up its chain too, templates included", async () => {
    const scene = await openScene([written], deskWithTemplate());
    await scene.press(scene.options()[0] as El);
    const template = scene.doc.querySelector("template") as El;
    const chained = (root: El) =>
      root
        .querySelectorAll("[data-link-control]")
        .map((control) => control.getAttribute("data-link-url"));
    expect(chained(scene.doc)).toEqual([capabilityLinkUrl("books", TITLE.name)]);
    expect(chained(template.content as El)).toEqual([capabilityLinkUrl("books", TITLE.name)]);
    const copy = (template.content as El).querySelector('[name="author"]') as El;
    expect(drawnLinked(copy)).toBe(true);
    expect(drawnLinked(scene.input)).toBe(true);
  });
});

describe("a refusal that says the chain is finished", () => {
  test("a field another tab already linked gives up its chain everywhere, on open or on a pick", async () => {
    for (const replies of [
      [noticed(ALREADY_LINKED, 422)],
      [listed(), noticed(ALREADY_LINKED, 422)],
    ]) {
      const scene = await linkScene(replies, deskWithTemplate());
      await scene.press(scene.button);
      if (scene.options().length > 0) await scene.press(scene.options()[0] as El);
      expect(scene.said).toEqual([refusal(linkNoticeSentence(ALREADY_LINKED))]);
      const template = scene.doc.querySelector("template") as El;
      for (const root of [scene.doc, template.content as El]) {
        expect(
          root
            .querySelectorAll("[data-link-control]")
            .map((control) => control.getAttribute("data-link-url")),
        ).toEqual([capabilityLinkUrl("books", TITLE.name)]);
        const copy = root.querySelector('[name="author"]') as El;
        expect(drawnLinked(copy)).toBe(true);
      }
      expect(scene.input.parent).toBe(scene.shell);
    }
  });

  test("a field no longer linkable gives up its chain too, and the refusal is still said", async () => {
    const scene = await linkScene([noticed(NOT_LINKABLE, 422)], deskWithTemplate());
    await scene.press(scene.button);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(NOT_LINKABLE))]);
    expect(scene.doc.querySelector(`[data-link-url="${LINK_URL}"]`)).toBeNull();
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    expect(scene.shell.children).toEqual([scene.input]);
  });

  test("a refusal that takes the chain away leaves focus in the field, on open or on a pick", async () => {
    for (const replies of [
      [noticed(ALREADY_LINKED, 422)],
      [listed(), noticed(ALREADY_LINKED, 422)],
    ]) {
      const scene = await linkScene(replies);
      scene.button.focus();
      await scene.key("Enter", scene.button);
      if (scene.options().length > 0) await scene.key("Enter", scene.button);
      expect(scene.root.isConnected).toBe(false);
      expect(scene.doc.activeElement).toBe(scene.input);
    }
  });
});

describe("while a pick is written", () => {
  test("while the write is in flight the chain stays shut, so no second pick is made", async () => {
    const write = held(written);
    const scene = await openScene([write.reply]);
    await scene.press(scene.options()[0] as El);
    await scene.press(scene.button);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.exchanges.map((exchange) => exchange.method)).toEqual(["GET", "POST"]);
    write.release();
    await settle();
    expect(scene.doc.querySelector("[data-link-control]")).toBeNull();
  });

  test("nor does another copy of the same field open while it is written", async () => {
    const write = held(written);
    const page =
      renderCreateForm(bookCapability()) + renderEditForm(bookCapability(), { id: "book-1" });
    const scene = await openScene([write.reply], page);
    const copy = scene.chooserOf("edit-books-author");
    await scene.press(scene.options()[0] as El);
    await scene.press(copy.button);
    expect(copy.button.getAttribute("aria-expanded")).toBe("false");
    expect(scene.exchanges.map((exchange) => exchange.method)).toEqual(["GET", "POST"]);
    write.release();
    await settle();
    expect(scene.doc.querySelector("[data-link-control]")).toBeNull();
  });
});

describe("once a pick is written whole", () => {
  /** The new-record form with the collection region it reads its records back into. */
  const WITH_RECORDS = `${renderCreateForm(bookCapability())}<div id="books-records"></div>`;

  test("the field is let go while its records are read again, and a press taken then is kept", async () => {
    const read = held(() => new Response("", { status: 200 }));
    const scene = await openScene([written, read.reply], WITH_RECORDS);
    await scene.press(scene.options()[0] as El);
    await settle();
    expect(scene.exchanges.at(-1)?.url).toBe("/capability/books/read");
    const { writing } = pageOf(scene.doc as never);
    expect(writing.has(LINK_URL)).toBe(false);
    // An Unlink of the field, pressed while the records are still being read, holds the field.
    writing.add(LINK_URL);
    read.release();
    await settle();
    expect(writing.has(LINK_URL)).toBe(true);
  });
});

describe("on the page, as the shell starts both", () => {
  test("a field linked from an open form is a dropdown at once, reading the target's records", async () => {
    const scene = await linkScene([listed(), written, records()], deskWithTemplate());
    startLinkedFields(scene.doc as never);
    await scene.press(scene.button);
    await scene.press(scene.options()[0] as El);
    await settle();
    const input = scene.doc.getElementById("cap-books-author") as El;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.hasAttribute("name")).toBe(false);
    const carrier = scene.doc.querySelector('input[type="hidden"][name="author"]') as El;
    expect(carrier.hasAttribute("data-choice-value")).toBe(true);
    expect(scene.exchanges.map((exchange) => exchange.url)).toEqual([
      expect.stringContaining(LINK_URL),
      LINK_URL,
      capabilityPickUrl("books", "author"),
    ]);
    const options = input.closest("[data-linked-field]")?.querySelectorAll('[role="option"]');
    expect(options?.map((option) => option.textContent)).toEqual([...NAMES]);
    expect(scene.doc.activeElement).toBe(input);
  });
});
