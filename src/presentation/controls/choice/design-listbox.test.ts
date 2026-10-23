// The design page's own listbox, `design/scripts/controls/listbox.js`, run on a linked field, a
// choice picker and a chooser: the first two search as the desk's do, and the chooser drawn on a
// button keeps its jump to a typed letter.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mountListboxes } from "#design/controls/listbox.js";
import { NO_RESULTS } from "#design/controls/listbox-search.js";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";

installDomGlobals();

const AUTHORS = [
  "Ann Leckie",
  "Becky Chambers",
  "Brandon Sanderson",
  "Martha Wells",
  "N. K. Jemisin",
  "Neil Gaiman",
  "Octavia E. Butler",
  "Susanna Clarke",
  "Ted Chiang",
  "Terry Pratchett",
  "Ursula K. Le Guin",
];

/** A field linked to Authors: a dropdown of their names, holding `picked` or text no name has. */
function linkedField(id: string, { picked = "", typed = "" } = {}): string {
  const options = AUTHORS.map(
    (name) =>
      `<div class="listbox__option" role="option" data-value="${name}"${name === picked ? ' aria-selected="true"' : ""}>${name}</div>`,
  ).join("");
  return `<div class="field"><label class="field__label caps" id="${id}-label" for="${id}">Author</label><div class="listbox linked-field" data-listbox${typed ? " data-listbox-unmatched" : ""}><span class="field__control field__control--select"><input class="field__input" id="${id}" type="text" role="combobox" aria-expanded="false" placeholder="Choose the author…" value="${typed}"><span class="listbox__chevron"></span></span><button class="linked-field__unlink" type="button"></button><div class="listbox__panel" hidden><div class="listbox__scroll" aria-labelledby="${id}-label">${options}</div></div></div></div>`;
}

const STATUS = `<div class="field listbox" data-listbox data-name="status"><label class="field__label caps" id="status-label" for="status-input">Status</label><span class="field__control field__control--select"><input class="field__input" id="status-input" type="text" role="combobox" aria-expanded="false"><span class="listbox__chevron"></span></span><div class="listbox__panel" hidden><div class="listbox__scroll" aria-labelledby="status-label"><div class="listbox__option" role="option" data-value="draft">Draft</div><div class="listbox__option" role="option" data-value="sent" aria-selected="true">Sent</div><div class="listbox__option" role="option" data-value="paid">Paid<span class="listbox__note" aria-hidden="true">closes the record</span></div><div class="listbox__option" role="option" data-value="overdue">Overdue</div><div class="listbox__option" role="option" data-value="void" aria-disabled="true">Void<span class="listbox__note" aria-hidden="true">needs a reason</span></div></div></div></div>`;

const CHOOSER = `<div class="listbox link-control" data-listbox><span class="field__control"><input class="field__input" type="text" value=""><button class="listbox__button link-control__button" type="button"><span class="listbox__value" hidden></span></button></span><div class="listbox__panel link-control__panel" hidden><div class="link-control__head"><p class="link-control__heading" id="chooser-heading">Connect every book’s author to…</p></div><div class="listbox__scroll" data-listbox-list aria-labelledby="chooser-heading"><div role="group"><div class="listbox__group caps" role="presentation">Suggested</div><div class="listbox__option" role="option" data-value="reading_log.title">Reading Log · Title</div></div><div role="group"><div class="listbox__group caps" role="presentation">Authors</div><div class="listbox__option" role="option" data-value="authors.name">Name</div><div class="listbox__option" role="option" data-value="authors.pen_name">Pen name</div></div></div></div></div>`;

const FIELDS: Record<string, string> = {
  "link-search": linkedField("link-search"),
  "link-search-none": linkedField("link-search-none"),
  "link-unmatched-input": linkedField("link-unmatched-input", { typed: "Ursula Le Guin" }),
  "link-on-input": linkedField("link-on-input", { picked: "Brandon Sanderson" }),
  "status-input": STATUS,
};

const page = globalThis as unknown as { document: unknown };
let standing: unknown;
beforeEach(() => {
  standing = page.document;
});
afterEach(() => {
  page.document = standing;
});

/** The field, mounted on a document of its own, with every `listbox:change` it says. */
function mounted(id: string) {
  const doc = new Doc();
  page.document = doc;
  parseHtml(`<form>${FIELDS[id]}</form>`, doc);
  mountListboxes(doc as never);
  const control = doc.getElementById(id) as El;
  const root = control.closest("[data-listbox]") as El;
  const changes: unknown[] = [];
  doc.addEventListener("listbox:change", (event) => {
    changes.push((event as unknown as CustomEvent).detail);
  });
  return {
    doc,
    control,
    root,
    changes,
    kept: () =>
      root
        .querySelectorAll('[role="option"]')
        .filter((option) => !option.hidden)
        .map((option) => option.textContent.trim()),
    type: (text: string) => {
      control.value = text;
      doc.fire("input", control);
    },
    key: (key: string, extra: Record<string, unknown> = {}) =>
      doc.fire("keydown", control, { key, ...extra }),
  };
}

describe("a linked field searches as the desk's does", () => {
  test("typing keeps the names holding every word, and Enter picks the first", () => {
    const field = mounted("link-search");
    field.type("le");
    expect(field.kept()).toEqual(["Ann Leckie", "Octavia E. Butler", "Ursula K. Le Guin"]);
    expect(field.key("Enter").prevented).toBe(true);
    expect(field.control.value).toBe("Ann Leckie");
    expect(field.changes).toEqual([{ value: "Ann Leckie", label: "Ann Leckie" }]);
  });

  test("a search that keeps nothing says so, outside the list", () => {
    const field = mounted("link-search-none");
    field.type("Tolkien");
    const sentence = field.root.querySelector(".listbox__empty") as El;
    expect(sentence.textContent).toBe(NO_RESULTS);
    expect(sentence.closest('[role="listbox"]')).toBeNull();
  });

  test("Escape puts back what the field held, unmatched text included", () => {
    const field = mounted("link-unmatched-input");
    field.type("zzz");
    field.key("Escape");
    expect(field.control.value).toBe("Ursula Le Guin");
    expect(field.changes).toEqual([]);
  });

  test("emptied and left, it stays empty and says so", () => {
    const field = mounted("link-on-input");
    expect(field.control.value).toBe("Brandon Sanderson");
    field.type("");
    field.key("Tab");
    expect(field.control.value).toBe("");
    expect(field.changes).toEqual([{ value: null, label: "" }]);
  });

  test("a required field emptied and left keeps its name", () => {
    const field = mounted("link-on-input");
    field.control.setAttribute("aria-required", "true");
    field.type("");
    field.key("Tab");
    expect(field.control.value).toBe("Brandon Sanderson");
    expect(field.changes).toEqual([]);
  });

  test("the Enter that ends an input method's composition picks nothing", () => {
    const field = mounted("link-search");
    field.type("le");
    expect(field.key("Enter", { isComposing: true }).prevented).toBe(false);
    expect(field.changes).toEqual([]);
  });
});

describe("a choice picker searches too, and posts its value", () => {
  test("typing narrows, a note is never searched, and a pick writes the carrier", () => {
    const field = mounted("status-input");
    field.type("closes");
    expect(field.kept()).toEqual([]);
    field.type("pai");
    field.key("Enter");
    expect(field.control.value).toBe("Paid");
    // The carrier the listbox appends for `data-name`: the root's last child.
    const carrier = field.root.children.at(-1) as El;
    expect(carrier.tag).toBe("input");
    expect(carrier.value).toBe("paid");
  });
});

describe("the chooser keeps the select-only keyboard", () => {
  test("a typed letter jumps, and nothing is hidden", () => {
    const doc = new Doc();
    page.document = doc;
    const root = parseHtml(CHOOSER, doc).firstElementChild as El;
    mountListboxes(doc as never);
    const button = root.querySelector(".listbox__button") as El;
    doc.fire("keydown", button, { key: "ArrowDown" });
    const options = root.querySelectorAll('[role="option"]');
    const first = button.getAttribute("aria-activedescendant");
    const letter = (options[1]?.textContent.trim() ?? "").charAt(0).toLowerCase();
    doc.fire("keydown", button, { key: letter });
    expect(button.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(options.every((option) => !option.hidden)).toBe(true);
  });
});
