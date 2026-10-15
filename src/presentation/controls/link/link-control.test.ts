// Where the renderer draws the chain, and what it draws. It sits in every unlinked single-line text
// field of both forms and nowhere else, carries its name and an empty panel but none of the chooser's
// words, and the Edit form's copy of it survives the scrub a Handler's fragment passes through. A
// linked field carries none: its shell stands in the wrapper its dropdown is drawn in.

import { describe, expect, test } from "bun:test";
import { capabilityLinkUrl, capabilityPickUrl } from "#shell/core/routes.js";
import { SECOND_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { FieldType, Relation, SpecField } from "../../../registry/index.ts";
import { probeField, sampleFieldValue } from "../../fields/field-renderer.test-support.ts";
import {
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "../../fields/field-renderer.ts";
import { enforceHandlerFragment } from "../../safety/fragment-safety.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { linkableShell } from "./link-control.ts";
import { CHOOSER_EMPTY, chooserHeading, chooserLine, connectFieldName } from "./link-copy.ts";

const text = (name: string, label: string, extra: Partial<SpecField> = {}) =>
  probeField("string", { name, label, required: false, ...extra });
const other = (type: FieldType, name: string) => probeField(type, { name, label: name });

/** Every kind of field a form draws, beside the two single-line text fields that are unlinked. */
const FIELDS: readonly SpecField[] = [
  text("title", "Title"),
  text("isbn", "ISBN number", { max_length: 20 }),
  text("summary", "Summary"),
  text("author", "Author"),
  text("retired", "Retired", { lifecycle: "inactive" }),
  other("number", "pages"),
  other("boolean", "owned"),
  other("date", "started"),
  other("datetime", "finished"),
  other("choice", "genre"),
  other("string[]", "tags"),
  other("string[]", "aliases"),
  other("file", "cover"),
  other("file[]", "scans"),
];

const AUTHOR_RELATION: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: SECOND_INCARNATION_ID, field: "name" },
};

/** Books with `relations`, each holding unless `dormant` names its field. */
function books(
  relations: readonly Relation[] | undefined,
  dormant: readonly string[] = [],
): RenderableCapability {
  const linkedFields = relations
    ?.map((relation) => relation.field)
    .filter((name) => !dormant.includes(name));
  return {
    id: "books",
    label: "Books",
    noun: "book",
    ...(relations === undefined ? {} : { relations, linkedFields }),
    schema: { fields: FIELDS },
    form: {
      list_inputs: [
        { field: "tags", mode: "repeatable" },
        { field: "aliases", mode: "comma_separated" },
      ],
      choice_inputs: [{ field: "genre", presentation: "picker" }],
      long_text: ["summary"],
      guidance: [],
    },
    actions: ["create", "read", "update", "delete"],
  };
}

const RECORD = Object.fromEntries([
  ["id", "book-1"],
  ...FIELDS.map((field) => [field.name, sampleFieldValue(field.type)]),
]);

const FORMS = {
  create: (capability: RenderableCapability) => renderCreateForm(capability),
  edit: (capability: RenderableCapability) => renderEditForm(capability, RECORD),
};

const parsed = (html: string) => parseHtml(html, new Doc());

/** The field each drawn chain belongs to, read off the input its control holds. */
const chained = (root: El) =>
  root
    .querySelectorAll("[data-link-control]")
    .map((control) => control.querySelector(".field__input")?.getAttribute("name"));

const field = (name: string) => FIELDS.find((one) => one.name === name) as SpecField;

describe("which fields carry the chain", () => {
  for (const [mode, render] of Object.entries(FORMS)) {
    test(`${mode}: every unlinked single-line text field, and nothing else`, () => {
      expect(chained(parsed(render(books([AUTHOR_RELATION]))))).toEqual(["title", "isbn"]);
    });

    test(`${mode}: an unlinked field that is linked elsewhere still has one`, () => {
      expect(chained(parsed(render(books([]))))).toEqual(["title", "isbn", "author"]);
    });

    test(`${mode}: none at all where the form is only inspected, with no relations read`, () => {
      const root = parsed(render(books(undefined)));
      expect(chained(root)).toEqual([]);
      expect(root.querySelectorAll(".link-control__button")).toEqual([]);
    });

    test(`${mode}: a linked field's shell stands in its dropdown's wrapper, which reads its records`, () => {
      const root = parsed(render(books([AUTHOR_RELATION])));
      const input = root.querySelector('[name="author"]') as El;
      expect(input.parent?.className).toBe("field__control");
      expect(input.parent?.children).toEqual([input]);
      const wrapper = input.parent?.parent as El;
      expect(wrapper.hasAttribute("data-linked-field")).toBe(true);
      expect(wrapper.getAttribute("data-pick-url")).toBe(capabilityPickUrl("books", "author"));
      expect(wrapper.children).toEqual([input.parent as El]);
      expect(root.querySelectorAll("[data-linked-field]")).toEqual([wrapper]);
    });

    test(`${mode}: an unlinked field, and a form only inspected, draw no dropdown`, () => {
      for (const relations of [[], undefined]) {
        expect(parsed(render(books(relations))).querySelectorAll("[data-linked-field]")).toEqual(
          [],
        );
      }
    });

    test(`${mode}: a relation on a field that is no longer single-line text draws no dropdown`, () => {
      const summary: Relation = { ...AUTHOR_RELATION, field: "summary" };
      const retired: Relation = { ...AUTHOR_RELATION, field: "retired" };
      const root = parsed(render(books([summary, retired])));
      expect(root.querySelectorAll("[data-linked-field]")).toEqual([]);
    });

    test(`${mode}: a dormant relation draws neither a dropdown nor a chain, only the plain field`, () => {
      const root = parsed(render(books([AUTHOR_RELATION], ["author"])));
      const input = root.querySelector('[name="author"]') as El;
      expect(root.querySelectorAll("[data-linked-field]")).toEqual([]);
      expect(chained(root)).toEqual(["title", "isbn"]);
      expect(input.parent?.className).toBe("field__control");
      expect(input.parent?.children).toEqual([input]);
    });
  }
});

describe("what the chain draws", () => {
  for (const [mode, render] of Object.entries(FORMS)) {
    test(`${mode}: its name, the field's own address, and an empty panel the chain points at`, () => {
      const root = parsed(render(books([])));
      for (const control of root.querySelectorAll("[data-link-control]")) {
        const input = control.querySelector(".field__input") as El;
        const linked = field(input.getAttribute("name") as string);
        const button = control.querySelector(".link-control__button") as El;
        const panel = control.querySelector(".listbox__panel") as El;
        const scroll = panel.querySelector(".listbox__scroll") as El;

        expect(control.getAttribute("data-link-url")).toBe(capabilityLinkUrl("books", linked.name));
        expect(input.parent?.className).toBe("field__control");
        expect(button.parent).toBe(input.parent);
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBe(connectFieldName("book", linked));
        expect(button.getAttribute("aria-haspopup")).toBe("listbox");
        expect(button.getAttribute("aria-expanded")).toBe("false");
        expect(root.querySelector(`#${button.getAttribute("aria-controls")}`)).toBe(scroll);
        expect(scroll.id).toBe(`${input.id}-link-list`);
        expect(panel.hidden).toBe(true);
        expect(panel.children).toEqual([scroll]);
        expect(scroll.children).toEqual([]);
        expect(scroll.textContent).toBe("");
      }
    });

    test(`${mode}: none of the chooser's words ride in the form; they arrive when it opens`, () => {
      const root = parsed(render(books([])));
      const words = root.textContent;
      expect(
        root.querySelectorAll(".link-control__head, .link-control__line, .listbox__empty"),
      ).toEqual([]);
      for (const name of ["title", "isbn", "author"]) {
        expect(words).not.toContain(chooserHeading("book", field(name)));
        expect(words).not.toContain(chooserLine("book", field(name)));
      }
      expect(words).not.toContain(CHOOSER_EMPTY);
    });
  }

  test("a label written in capitals is named as written", () => {
    const control = parsed(renderCreateForm(books([])))
      .querySelectorAll("[data-link-control]")
      .find((one) => one.querySelector('[name="isbn"]') !== null);
    const name = control?.querySelector(".link-control__button")?.getAttribute("aria-label");
    expect(name).toBe(connectFieldName("book", field("isbn")));
    expect(name).toContain(field("isbn").label);
  });
});

describe("the Edit form's chain inside a Handler's fragment", () => {
  test("the control carries nothing the fragment scrub takes out", () => {
    const shell = linkableShell(books([]), field("title"), "edit-books-title", "<input>");
    const scrubbed = enforceHandlerFragment(shell);
    expect(scrubbed.neutralized).toBe(false);
    expect(scrubbed.html).toBe(shell);
  });

  test("every chain in a scrubbed Edit form is the one the renderer drew", () => {
    const html = renderEditForm(books([]), RECORD);
    const before = parsed(html).querySelectorAll("[data-link-control]");
    const after = parsed(enforceHandlerFragment(html).html).querySelectorAll("[data-link-control]");
    expect(after.map(drawing)).toEqual(before.map(drawing));
    expect(after.map((control) => control.getAttribute("data-link-url"))).toEqual([
      capabilityLinkUrl("books", "title"),
      capabilityLinkUrl("books", "isbn"),
      capabilityLinkUrl("books", "author"),
    ]);
    for (const control of after) {
      const button = control.querySelector(".link-control__button") as El;
      const panel = control.querySelector(".listbox__panel") as El;
      expect(panel.querySelector(`#${button.getAttribute("aria-controls")}`)).not.toBeNull();
    }
  });
});

/** An element as a script would meet it: its tag, its attributes, its text and its children. */
function drawing(node: El): unknown {
  return {
    tag: node.tag,
    attributes: { ...node.attributes },
    text: node.ownText,
    children: node.children.map(drawing),
  };
}
