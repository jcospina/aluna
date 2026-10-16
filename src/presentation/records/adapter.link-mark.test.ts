// The broken-link mark: the item wrapper, never the generated card, marks each card whose linked
// field holds text and no pick, named for every target it asks.

import { describe, expect, test } from "bun:test";

import { LINK_MARK_CHAIN } from "#shell/controls/listbox-glyphs.js";
import { createCapabilityActionRecord } from "../../runtime/data/index.ts";
import { pickTargetMark } from "../controls/link/link-copy.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import { CARD_BODY_TAG } from "../safety/markup/contained-markup.ts";
import { createPresentationAdapter, type ItemRenderer } from "./adapter.ts";
import { ITEM_BODY_CLASS } from "./collection/list-container.ts";

const text = (name: string) =>
  ({ name, label: name, type: "string", required: false, lifecycle: "active" }) as const;

const BOOKS: RenderableCapability = {
  id: "books",
  label: "Books",
  noun: "book",
  linkedFields: ["author", "publisher"],
  schema: { fields: [text("title"), text("author"), text("publisher")] },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

const NOUNS = new Map([
  ["author", "author"],
  ["publisher", "publisher"],
]);

const CARD = `<div class="stack"><span>A card</span></div>`;
const renderCard: ItemRenderer = () => CARD;

/** A book as stored, holding `values`. */
const stored = (values: Record<string, string | null>) =>
  createCapabilityActionRecord({
    id: "book-1",
    created_at: "2026-10-15T00:00:00.000Z",
    title: "Kindred",
    ...values,
  });

/**
 * One book's card, with `picked` as what its linked fields picked, and `presented` as the fields a
 * Handler hands over in place of the stored ones.
 */
function card(
  values: Record<string, string | null>,
  picked: Record<string, string> = {},
  capability: RenderableCapability = BOOKS,
  presented?: Record<string, string | null>,
): string {
  const present = createPresentationAdapter({
    capability,
    renderItem: renderCard,
    links: () => new Map(Object.entries(picked)),
    linkNouns: NOUNS,
  });
  const record = stored(values);
  const html = present(presented ? { ...record, fields: presented } : record);
  const template = html.indexOf("<template");
  return template === -1 ? html : html.slice(0, template);
}

/** The mark's name, or null when the card carries none. */
function markOf(html: string): string | null {
  return /class="link-mark" role="img" aria-label="([^"]*)"/.exec(html)?.[1] ?? null;
}

describe("a card whose linked field holds text and no pick", () => {
  test("carries the mark ahead of its own markup, which the wrapper holds whole", () => {
    const html = card({ author: "Octavia E. Butler" });
    expect(markOf(html)).toBe(pickTargetMark(["author"]));
    expect(html).toContain(
      `${LINK_MARK_CHAIN}</span><${CARD_BODY_TAG} class="${ITEM_BODY_CLASS}">${CARD}</${CARD_BODY_TAG}></button>`,
    );
  });

  test("keeps its mark whole whatever tag the card's markup leaves open", () => {
    const open: ItemRenderer = () => `<div class="stack"><p>Kindred<div hidden>`;
    const present = createPresentationAdapter({
      capability: BOOKS,
      renderItem: open,
      links: () => new Map(),
      linkNouns: NOUNS,
    });
    const html = present(stored({ author: "Octavia E. Butler" }));
    const mark = html.indexOf('<span class="link-mark"');
    expect(mark).toBeGreaterThan(-1);
    expect(html.indexOf("</span>", html.indexOf("</svg>", mark))).toBeLessThan(
      html.indexOf("<div"),
    );
  });

  test("names every target it asks for, once each", () => {
    const html = card({ author: "Octavia E. Butler", publisher: "Doubleday" });
    expect(markOf(html)).toBe(pickTargetMark(["author", "publisher"]));
    expect(markOf(card({ author: "Butler", publisher: "Doubleday" }, { author: "a-1" }))).toBe(
      pickTargetMark(["publisher"]),
    );
  });
});

describe("a card carries no mark", () => {
  test("when its linked fields are picked or empty", () => {
    expect(markOf(card({ author: "Butler" }, { author: "a-1" }))).toBeNull();
    for (const empty of ["", "  \u00a0", "\u200b", null]) {
      expect(markOf(card({ author: empty, publisher: empty }))).toBeNull();
    }
  });

  test("by what is stored, whatever the Handler presents in its place", () => {
    expect(markOf(card({ author: null }, {}, BOOKS, { author: "Unknown" }))).toBeNull();
    expect(markOf(card({ author: "Octavia E. Butler" }, {}, BOOKS, {}))).toBe(
      pickTargetMark(["author"]),
    );
  });

  test("and draws its markup as it did, with no span around it", () => {
    expect(card({ author: "" })).toContain(`>${CARD}</button>`);
  });

  test("for text in a field that is not linked", () => {
    const unlinked = { ...BOOKS, linkedFields: ["publisher"] };
    expect(markOf(card({ title: "Kindred", author: "Butler" }, {}, unlinked))).toBeNull();
  });
});

describe("a card with no Edit form", () => {
  test("is marked all the same, the wrapper an article", () => {
    const readOnly: RenderableCapability = { ...BOOKS, actions: ["create", "read"] };
    const html = card({ author: "Octavia E. Butler" }, {}, readOnly);
    expect(markOf(html)).toBe(pickTargetMark(["author"]));
    expect(html).toContain(
      `${LINK_MARK_CHAIN}</span><${CARD_BODY_TAG} class="${ITEM_BODY_CLASS}">`,
    );
    expect(html.endsWith("</article>")).toBe(true);
  });
});
