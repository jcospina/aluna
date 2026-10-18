// The records linking to a record, on the record's own view in a window, run through the real
// `public/records/record-view.js`: a listed card opens its own capability's record, never the
// window's, and "Show all" fetches the rest of a section into it, or leaves the section as it was.

import { afterEach, describe, expect, test } from "bun:test";
import { releaseRegionContent } from "#shell/core/region-scope.js";
import { recordAddress } from "#shell/core/routes.js";
import { OPEN_THE_RECORD_EVENT, RECORD_NOT_THERE } from "#shell/desk/desk-address.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import { REST_UNREAD } from "#shell/records/record-view.js";
import { GETTING_REST_LABEL } from "../../controls/busy-label.ts";
import type { El } from "../../controls/double/choice-picker.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { DEFAULT_COLLECTION_LAYOUT, renderItemWrapper } from "../collection/list-container.ts";
import { answerPresses, recordDesk } from "../record-view/record-view.test-support.ts";
import { renderRecordView } from "../record-view/record-view.ts";
import { renderLinkingSection, SHOW_ALL_LABEL } from "./record-links.ts";

const AUTHORS: RenderableCapability = {
  id: "authors",
  label: "Authors",
  noun: "author",
  schema: {
    fields: [{ name: "name", label: "Name", type: "string", required: true, lifecycle: "active" }],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete"],
};

const AUTHOR = {
  id: "5a1d3c7e-2b4f-4e6a-8c90-1f2e3d4c5b6a",
  created_at: "2026-10-01T00:00:00.000Z",
  name: "Brandon Sanderson",
};

/** A book's id, as its record id spells one. */
const book = (n: number) => `b00c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A Books card listed on the author's record, as Books' own adapter draws one. */
const listedBook = (n: number) =>
  renderItemWrapper(
    `<span>Book ${n}</span>`,
    { id: book(n) },
    { capabilityId: "books", listed: true },
  );

/** Where the section's "Show all" fetches the rest: the client reads it as the server wrote it. */
const REST = "/the-rest-of-the-section";

/** The author's record view with a Books section of `shown` cards, and "Show all" when asked. */
function authorView(shown: number, more = true): string {
  const linking = renderLinkingSection({
    capability: { id: "books", label: "Books" },
    layout: DEFAULT_COLLECTION_LAYOUT,
    field: "author",
    count: shown + (more ? 2 : 0),
    cards: Array.from({ length: shown }, (_, n) => listedBook(n + 1)).join(""),
    ...(more ? { rest: REST } : {}),
  });
  return renderRecordView(AUTHORS, AUTHOR, undefined, linking);
}

type Desk = Awaited<ReturnType<typeof recordDesk>>;
let desk: Desk;
const globals = globalThis as { fetch: unknown };
const fetched = globals.fetch;
afterEach(() => {
  globals.fetch = fetched;
  desk.restore();
});

/** An Authors window open on the author's record, as the record address draws it. */
async function authorsWindow(html = authorView(5)) {
  desk = await recordDesk(html, { capabilityId: AUTHORS.id });
  const asked: unknown[] = [];
  desk.doc.addEventListener(OPEN_THE_RECORD_EVENT, (event) => {
    asked.push({ ...(event as unknown as CustomEvent<object>).detail });
  });
  const said: unknown[] = [];
  desk.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent).detail);
  });
  const list = desk.doc.querySelector(".record-links__records") as El;
  const ids = () => list.children.map((card) => card.getAttribute("data-card-record"));
  return { asked, said, list, ids, section: desk.doc.querySelector(".record-links") as El };
}

describe("a card listed on a record of another capability", () => {
  test("asks for its own capability's record, never the window's", async () => {
    const page = await authorsWindow();
    const card = page.list.children[1] as El;
    desk.press(card.querySelector("span") as El);
    expect(page.asked).toEqual([{ capability: "books", record: book(2) }]);
    // Nothing moves until the desk draws the address it asked for.
    expect(desk.doc.querySelector("[data-record-view]")).not.toBeNull();
  });

  test("is opened by the desk at its own record address, under an entry of its own", async () => {
    await authorsWindow();
    const drawn = answerPresses(desk, () => "<p>The book</p>");
    desk.press(desk.doc.querySelector(".record-links .capability-item") as El);
    expect(drawn).toEqual([recordAddress("books", book(1))]);
    expect(desk.tab.entries().at(-1)).toBe(recordAddress("books", book(1)));
    expect(desk.region.querySelector('[data-active-capability-id="books"]')).not.toBeNull();
  });

  test("whose capability has left the desk since it was drawn says the record is not there", async () => {
    const page = await authorsWindow();
    const drawn = answerPresses(desk, () => "<p>The book</p>", { knows: () => false });
    desk.press(page.list.children[0] as El);
    expect(page.said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
    expect(drawn).toEqual([]);
    expect(desk.tab.entries()).toHaveLength(1);
    expect(desk.doc.querySelector("[data-record-view]")).not.toBeNull();
  });
});

/** Answer every fetch with `reply`, writing down what was asked. */
function answering(reply: (signal?: AbortSignal) => Promise<Response>) {
  const asked: { url: string; headers: unknown }[] = [];
  globals.fetch = (url: string, init?: RequestInit) => {
    asked.push({ url, headers: init?.headers });
    return reply(init?.signal ?? undefined);
  };
  return asked;
}

/** Answer every fetch with one more card once `land` is called, writing down what was asked. */
function answeringLater() {
  let land = () => {};
  const asked = answering(
    () =>
      new Promise<Response>((done) => {
        land = () => done(new Response(listedBook(6)));
      }),
  );
  return { asked, land: () => land() };
}

const more = () => desk.doc.querySelector("[data-record-links-rest]") as El | null;
const heading = () => desk.doc.querySelector(".record-links__heading") as El;

describe("Show all, once the rest arrives", () => {
  test("fetches the rest into the section, goes, and hands its focus to the first card it brought", async () => {
    const page = await authorsWindow();
    const asked = answering(async () => new Response(listedBook(6) + listedBook(7)));
    const button = more() as El;
    expect(button.textContent).toBe(SHOW_ALL_LABEL);
    expect(button.getAttribute("aria-describedby")).toBe(heading().id);
    button.focus();
    desk.press(button);
    // Held busy, not disabled, which would take the focus off it, and saying so in its words.
    expect([button.getAttribute("aria-busy"), button.disabled]).toEqual(["true", false]);
    expect(button.textContent).toBe(GETTING_REST_LABEL);
    expect(desk.doc.activeElement).toBe(button);
    await desk.settled();
    expect(asked).toEqual([{ url: REST, headers: { "HX-Request": "true" } }]);
    expect(page.ids()).toEqual([1, 2, 3, 4, 5, 6, 7].map(book));
    expect(more()).toBeNull();
    expect(desk.doc.activeElement).toBe(page.list.children[5] as El);
  });

  test("a press it did not hold the focus for leaves the focus where it was", async () => {
    const page = await authorsWindow();
    answering(async () => new Response(listedBook(6)));
    const name = desk.doc.querySelector('[name="name"]') as El;
    name.focus();
    desk.press(more() as El);
    await desk.settled();
    expect(page.ids()).toEqual([1, 2, 3, 4, 5, 6].map(book));
    expect(desk.doc.activeElement).toBe(name);
  });

  test("an answer with no cards in it still goes, its focus to the section's heading", async () => {
    // The records past the ones shown went since the section was drawn: the rest is nothing.
    const page = await authorsWindow();
    answering(async () => new Response(""));
    (more() as El).focus();
    desk.press(more() as El);
    await desk.settled();
    expect(page.ids()).toEqual([1, 2, 3, 4, 5].map(book));
    expect(more()).toBeNull();
    expect(desk.doc.activeElement).toBe(heading());
  });

  test("cards it brought that open nothing hand its focus to the heading instead", async () => {
    // A linking capability that cannot update draws cards a press opens nothing for.
    const page = await authorsWindow();
    const card = renderItemWrapper("<span>Book 6</span>", { id: book(6) });
    answering(async () => new Response(card));
    (more() as El).focus();
    desk.press(more() as El);
    await desk.settled();
    expect(page.list.children.map((child) => child.tag).at(-1)).toBe("article");
    expect(desk.doc.activeElement).toBe(heading());
  });

  test("a card it brought opens its own record like the rest", async () => {
    const page = await authorsWindow();
    answering(async () => new Response(listedBook(6)));
    desk.press(more() as El);
    await desk.settled();
    desk.press(page.list.children[5] as El);
    expect(page.asked).toEqual([{ capability: "books", record: book(6) }]);
  });

  test("a section with every card shown has no Show all to press", async () => {
    await authorsWindow(authorView(3, false));
    expect(more()).toBeNull();
  });
});

describe("Show all, while the rest is on its way, or when it does not come", () => {
  const failures: Record<string, () => Promise<Response>> = {
    "a refusal": async () => new Response(listedBook(6), { status: 404 }),
    "a failure": async () => new Response(listedBook(6), { status: 500 }),
    "a broken connection": () => Promise.reject(new TypeError("Failed to fetch")),
  };
  for (const [what, reply] of Object.entries(failures)) {
    test(`${what} leaves the section exactly as it was, says so, and Show all works again`, async () => {
      const page = await authorsWindow();
      const asked = answering(reply);
      const button = more() as El;
      button.focus();
      desk.press(button);
      await desk.settled();
      expect(page.ids()).toEqual([1, 2, 3, 4, 5].map(book));
      expect(more()).toBe(button);
      expect(button.hasAttribute("aria-busy")).toBe(false);
      expect(button.textContent).toBe(SHOW_ALL_LABEL);
      expect(page.said).toEqual([{ sentence: REST_UNREAD, refused: true }]);
      expect(desk.doc.activeElement).toBe(button);
      expect(page.section.children.at(-1)).toBe(button);
      desk.press(button);
      await desk.settled();
      expect(asked).toHaveLength(2);
    });
  }

  test("focus the person moved while the rest was on its way stays where they put it", async () => {
    await authorsWindow();
    const { land } = answeringLater();
    (more() as El).focus();
    desk.press(more() as El);
    const name = desk.doc.querySelector('[name="name"]') as El;
    name.focus();
    land();
    await desk.settled();
    expect(more()).toBeNull();
    expect(desk.doc.activeElement).toBe(name);
  });

  test("a second press while the rest is on its way asks for nothing more", async () => {
    await authorsWindow();
    const { asked, land } = answeringLater();
    const button = more() as El;
    desk.press(button);
    desk.press(button);
    expect(asked).toHaveLength(1);
    land();
    await desk.settled();
    expect(more()).toBeNull();
  });

  test("the window letting go of the record ends the fetch, and nothing lands", async () => {
    const page = await authorsWindow();
    let ended: AbortSignal | undefined;
    answering(
      (signal) =>
        new Promise<Response>((_done, fail) => {
          ended = signal;
          signal?.addEventListener("abort", () => fail(signal.reason));
        }),
    );
    desk.press(more() as El);
    releaseRegionContent(desk.region as never);
    await desk.settled();
    expect(ended?.aborted).toBe(true);
    expect(page.ids()).toEqual([1, 2, 3, 4, 5].map(book));
    expect(more()?.hasAttribute("aria-busy")).toBe(false);
    // The record has gone from under it, so there is nothing to say about the rest.
    expect(page.said).toEqual([]);
  });
});
