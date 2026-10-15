// The design page's own listbox, `design/scripts/controls/listbox.js`, run on fields cut from
// `design/controls.html` itself: a linked field and a choice picker search as the desk's do, and
// the chooser drawn on a button keeps its jump to a typed letter.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mountListboxes } from "#design/controls/listbox.js";
import { NO_RESULTS } from "#design/controls/listbox-search.js";
import { readSource } from "../../safety/source.test-support.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";

installDomGlobals();

const PAGE = readSource("design/controls.html");

/** The `.field` whose input or button carries `id`, cut whole from the page. */
function fieldHolding(id: string): string {
  const at = PAGE.indexOf(`id="${id}"`);
  const start = PAGE.lastIndexOf('<div class="field', at);
  let depth = 0;
  for (const match of PAGE.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return PAGE.slice(start, start + (match.index ?? 0) + "</div>".length);
  }
  throw new Error(`no field holds ${id}`);
}

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
  parseHtml(`<form>${fieldHolding(id)}</form>`, doc);
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

describe("a linked field on the page searches as the desk's does", () => {
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

describe("a choice picker on the page searches too, and posts its value", () => {
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
    const chooser = PAGE.slice(PAGE.indexOf('<div class="listbox link-control" data-listbox'));
    const root = parseHtml(chooser.slice(0, fieldEnd(chooser)), doc).firstElementChild as El;
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

/** Where the `<div>` that opens `html` closes. */
function fieldEnd(html: string): number {
  let depth = 0;
  for (const match of html.matchAll(/<div\b|<\/div>/g)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return (match.index ?? 0) + "</div>".length;
  }
  return html.length;
}
