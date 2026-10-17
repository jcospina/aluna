// A linked field's scene: the renderer's own forms for Books with Author linked to Authors · Name,
// the shipped `public/controls/linked-field.js` started on them, and a stand-in pick route answering
// with the platform's own words. The client reads `fetch` off the page, so it is put back after each
// test (`installLinkGlobals`). Not a test file.

import { startLinkedFields } from "#shell/controls/linked-field.js";
import { PROMPT_BAR_MESSAGE_EVENT, PROMPT_NOTICE_ID } from "#shell/desk/prompt-bar.js";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../../registry/incarnations.test-support.ts";
import type { Relation, SpecField } from "../../../../registry/index.ts";
import { probeField } from "../../../fields/field-renderer.test-support.ts";
import {
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "../../../fields/field-renderer.ts";
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import { type Reply, settle } from "../link-control.test-support.ts";
import {
  chooseTargetRecord,
  connectFieldName,
  disconnectDetail,
  disconnectFieldName,
  disconnectQuestion,
  unmatchedTargetLine,
} from "../link-copy.ts";

export const AUTHOR = probeField("string", { name: "author", label: "Author", required: false });
export const TITLE = probeField("string", { name: "title", label: "Title", required: false });

export const AUTHOR_TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: SECOND_INCARNATION_ID, field: "name" },
};

/** Authors' names, as the pick route orders them. */
export const NAMES = ["Brandon Sanderson", "Octavia E. Butler", "Ursula K. Le Guin"];

/** Books, its Author linked unless `relations` says otherwise. */
export function linkedBooks(
  fields: readonly SpecField[] = [AUTHOR, TITLE],
  relations: readonly Relation[] = [AUTHOR_TO_NAME],
): RenderableCapability {
  return {
    id: "books",
    label: "Books",
    noun: "book",
    relations,
    linkedFields: relations.map((relation) => relation.field),
    schema: { fields },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
    actions: ["create", "read", "update"],
  };
}

export const newBook = (capability = linkedBooks()) => renderCreateForm(capability);

/** Mistborn's Edit form, its Author holding `author` and, when `picked` names one, its pick. */
export const editBook = (author: string | null, capability = linkedBooks(), picked?: string) =>
  renderEditForm(
    capability,
    { id: "book-1", author, title: "Mistborn" },
    new Map(picked === undefined ? [] : [["author", picked]]),
  );

/** What the broken chain asks and posts, as the pick route writes it for Books · Author. */
export const UNLINKING = {
  lead: disconnectQuestion("books", "authors"),
  detail: disconnectDetail("books", AUTHOR),
  connect: connectFieldName("book", AUTHOR),
  press: {
    incarnation_id: FIRST_INCARNATION_ID,
    version: "1",
    target: AUTHOR_TO_NAME.to.capability,
    target_field: AUTHOR_TO_NAME.to.field,
    target_incarnation_id: AUTHOR_TO_NAME.to.incarnation,
    target_version: "1",
  },
};

/** The pick route's answer, written with the platform's own sentences, each record's id `idOf` it. */
export const records =
  (
    names: readonly string[] = NAMES,
    idOf: (index: number) => string = (index) => `author-${index}`,
  ): Reply =>
  () =>
    Response.json({
      placeholder: chooseTargetRecord("author"),
      unmatched: unmatchedTargetLine("author"),
      disconnect: disconnectFieldName("book", AUTHOR),
      unlinking: UNLINKING,
      target: AUTHOR_TO_NAME.to.capability,
      records: names.map((text, index) => ({ id: idOf(index), text })),
    });

const page = globalThis as unknown as { fetch: unknown };

/** A document holding `html`, the client started on it, and `replies` answering in order. */
export async function dropdownScene(replies: Reply[], html = newBook()) {
  const asked: string[] = [];
  page.fetch = async (url: string) => {
    asked.push(String(url));
    const reply = replies.shift();
    if (!reply) throw new Error(`nothing answers ${url}`);
    return reply({ url: String(url), method: "GET", body: "" });
  };
  const doc = new Doc();
  parseHtml(`${html}<p id="${PROMPT_NOTICE_ID}"></p>`, doc);
  const said: unknown[] = [];
  doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent).detail);
  });
  startLinkedFields(doc as never);
  await settle();
  // A field drawn plain again, or one still inside a record's template, has no parts yet.
  const drawn = doc.querySelector('[data-linked-field] [role="combobox"]') !== null;
  return {
    doc,
    asked,
    said,
    replies,
    ...(drawn ? partsOf(doc, "author") : ({} as ReturnType<typeof partsOf>)),
  };
}

/** One linked field's parts, found from the input that carries its search. */
export function partsOf(doc: Doc, name: string) {
  const carrier = doc.querySelector(`input[name="${name}"]`) as El;
  const root = carrier.closest("[data-linked-field]") as El;
  const input = root.querySelector('[role="combobox"]') as El;
  const field = root.closest(".field") as El;
  return {
    root,
    field,
    input,
    carrier,
    panel: root.querySelector(".listbox__panel") as El,
    list: root.querySelector('[role="listbox"]') as El,
    line: doc.getElementById(`${input.id}-unmatched`) as El,
    unlink: root.querySelector(".linked-field__unlink") as El,
    options: () => root.querySelectorAll('[role="option"]'),
    kept: () =>
      root
        .querySelectorAll('[role="option"]')
        .filter((option) => !option.hidden)
        .map((option) => option.textContent),
    active: () => input.getAttribute("aria-activedescendant"),
    type: (text: string) => {
      input.value = text;
      doc.fire("input", input);
    },
    key: (key: string) => doc.fire("keydown", input, { key }),
  };
}

/**
 * What the form posts: each named input's value that is not disabled, a checkbox or radio only
 * when checked.
 */
export function posted(form: El): [string, string][] {
  return form
    .querySelectorAll("input[name]")
    .filter((input) => !input.disabled)
    .filter(
      (input) => !["checkbox", "radio"].includes(input.getAttribute("type") ?? "") || input.checked,
    )
    .map((input) => [input.getAttribute("name") ?? "", input.value]);
}
