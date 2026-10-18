import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  CARD_CAPABILITY_ATTRIBUTE,
  CARD_RECORD_ATTRIBUTE,
  RECORD_LINKS_REST_ATTRIBUTE,
} from "#shell/core/shell-dom.js";
import { writeLinkRow } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  Doc,
  type El,
  parseHtml,
} from "../../../../presentation/controls/double/choice-picker.test-support.ts";
import { LISTED_AT_FIRST } from "../../../../presentation/index.ts";
import { type Relation, readActiveRegistryCatalog } from "../../../../registry/index.ts";
import {
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  installDesk,
  MEMOS,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  capabilityIncarnation,
  createReadGateCoordinator,
  type ReadGateCoordinator,
} from "../../../concurrency/read-gates.ts";
import type { ItemRendererLoader } from "../generated-code.ts";
import { BOOK_AUTHOR, routerApp } from "../links/router.links.test-support.ts";
import { setupRouterTest, teardownRouterTest } from "../router.test-support.ts";
import type { CapabilityRouterDeps } from "../router.ts";

// The records linking to the record an address names: drawn by the linking capability's own card
// renderer, under its own read token, and left out, never the record, when drawing them fails.

const SANDERSON = "0b0b0b0b-0000-4000-8000-000000000001";
const LE_GUIN = "0b0b0b0b-0000-4000-8000-000000000002";
const BOOKS_PATH = deskRow(BOOKS).artifacts_path;
const MEMOS_PATH = deskRow(MEMOS).artifacts_path;
const BOOKS_GATE = { capabilityId: "books", incarnationId: BOOKS_INCARNATION };
const BOOK_TITLE: Relation = {
  field: "title",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};
const MEMO_SUBJECT: Relation = {
  field: "subject",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

const scratch: { dir?: string; conns?: PlatformDatabase } = {};
const conns = () => scratch.conns as PlatformDatabase;

beforeEach(() => {
  Object.assign(scratch, setupRouterTest());
  installDesk(conns());
  for (const [id, name] of [
    [SANDERSON, "Brandon Sanderson"],
    [LE_GUIN, "Ursula K. Le Guin"],
  ] as const) {
    conns().readwrite.run('INSERT INTO "cap_authors" ("id", "name") VALUES (?, ?)', [id, name]);
  }
  storeRelations(conns(), "books", [BOOK_AUTHOR]);
});

afterEach(() => {
  if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
});

/** A book by Sanderson, its author picked, written on day `day` so its age is its order. */
function book(id: string, title: string, day: number, field = "author", at?: string): void {
  const created = at ?? `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  conns().readwrite.run(
    'INSERT INTO "cap_books" ("id", "title", "author", "isbn", "created_at") VALUES (?, ?, ?, ?, ?)',
    [id, title, "Brandon Sanderson", "978-hidden", created],
  );
  link("books", id, field);
}

function link(capability: string, record: string, field: string, author = SANDERSON): void {
  writeLinkRow(
    conns().readwrite,
    { capability, record, field },
    { capability: "authors", incarnation: AUTHORS_INCARNATION, record: author },
  );
}

/** Books' card, as its renderer draws one: the title in bold. */
const booksCard: ItemRendererLoader = async (path) => {
  if (path === BOOKS_PATH) return (record) => `<b>${String(record.title)}</b>`;
  if (path === MEMOS_PATH) return (record) => `<i>${String(record.subject)}</i>`;
  throw new Error(`no renderer at ${path}`);
};

const app = (deps: CapabilityRouterDeps = {}) =>
  routerApp(conns(), { loadItemRenderer: booksCard, ...deps });

const inPage = { headers: { "HX-Request": "true" } };

/** The record view an address draws, parsed. */
async function opened(author = SANDERSON, deps: CapabilityRouterDeps = {}) {
  const response = await app(deps).request(`/capability/authors/${author}`, inPage);
  expect(response.status).toBe(200);
  const doc = new Doc();
  parseHtml(await response.text(), doc);
  const view = doc.querySelector("[data-record-view]") as El;
  expect(view).not.toBeNull();
  return { doc, view, sections: view.querySelectorAll(".record-links") };
}

const titles = (section: El) =>
  section.querySelectorAll(".capability-item b").map((b) => b.textContent);
const heading = (section: El) => section.querySelector(".record-links__heading")?.textContent ?? "";
const restOf = (section: El) =>
  section
    .querySelector(`[${RECORD_LINKS_REST_ATTRIBUTE}]`)
    ?.getAttribute(RECORD_LINKS_REST_ATTRIBUTE) ?? "";

/** A read-gate coordinator that has seen the whole desk. */
function gates(): ReadGateCoordinator {
  const readGates = createReadGateCoordinator();
  readGates.synchronizeCatalog(
    readActiveRegistryCatalog(conns().readonly).capabilities.map(capabilityIncarnation),
  );
  return readGates;
}

const readers = (readGates: ReadGateCoordinator) =>
  Object.fromEntries(readGates.snapshot().map((entry) => [entry.capabilityId, entry.readerCount]));

/** Run `body` with `console.error` held, and say what it was told. */
async function quietly(body: () => Promise<void>): Promise<unknown[][]> {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    await body();
    return errors.mock.calls;
  } finally {
    errors.mockRestore();
  }
}

/** A renderer's answer after `ms`, which a synchronous renderer cannot be interrupted out of. */
const spin = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Measured, not interrupted.
  }
  return "<b>late</b>";
};

/** A memo linking to Sanderson through its subject, its relation stored. */
function memo(id: string, subject: string): void {
  storeRelations(conns(), "memos", [MEMO_SUBJECT]);
  conns().readwrite.run('INSERT INTO "cap_memos" ("id", "subject") VALUES (?, ?)', [id, subject]);
  link("memos", id, "subject");
}

const AUTHORS_GATE = { capabilityId: "authors", incarnationId: AUTHORS_INCARNATION };

describe("a record lists the records that link to it", () => {
  test("in a section headed with the linking capability and its count, between its fields and its actions", async () => {
    book("book-1", "Mistborn", 1);
    book("book-2", "Elantris", 2);
    book("book-3", "Warbreaker", 3);
    const { view, sections } = await opened();
    expect(sections).toHaveLength(1);
    const [section] = sections as [El];
    expect(heading(section).startsWith(BOOKS.label)).toBe(true);
    expect(heading(section).endsWith(" 3")).toBe(true);
    // Outside the edit form, after its fields, and the action row after it, the window's last.
    const body = section.parentElement as El;
    expect(body.classList.contains("capability-record-view__body")).toBe(true);
    expect(view.querySelector("form")?.nextElementSibling).toBe(section);
    expect(body.nextElementSibling?.classList.contains("capability-edit-form__actions")).toBe(true);
    expect(section.querySelector(`[${RECORD_LINKS_REST_ATTRIBUTE}]`)).toBeNull();
  });

  test("each card is the linking capability's own, newest first, opening its own record", async () => {
    book("book-1", "Mistborn", 1);
    book("book-2", "Elantris", 2);
    const [section] = (await opened()).sections as [El];
    expect(titles(section)).toEqual(["Elantris", "Mistborn"]);
    for (const card of section.querySelectorAll(".capability-item")) {
      expect(card.tag).toBe("button");
      expect(card.getAttribute(CARD_CAPABILITY_ATTRIBUTE)).toBe("books");
      expect(card.getAttribute("id")).toBeNull();
    }
    const records = section
      .querySelectorAll(".capability-item")
      .map((card) => card.getAttribute(CARD_RECORD_ATTRIBUTE));
    expect(records).toEqual(["book-2", "book-1"]);
  });

  test("a card is narrowed as its collection's is: no inactive field reaches it", async () => {
    book("book-1", "Mistborn", 1);
    const [section] = (await opened()).sections as [El];
    const card = section.querySelector(".capability-item") as El;
    const payload = JSON.parse(card.getAttribute("data-item") ?? "{}") as Record<string, unknown>;
    expect(payload.title).toBe("Mistborn");
    expect(Object.keys(payload)).not.toContain("isbn");
    expect(Object.keys(payload)).not.toContain("extra");
  });

  test("the first five show, and Show all fetches the rest, newest first", async () => {
    const all = ["A", "B", "C", "D", "E", "F", "G"];
    for (const [index, title] of all.entries()) book(`book-${index}`, title, index + 1);
    const [section] = (await opened()).sections as [El];
    expect(heading(section).endsWith(` ${all.length}`)).toBe(true);
    const newestFirst = [...all].reverse();
    expect(titles(section)).toEqual(newestFirst.slice(0, LISTED_AT_FIRST));
    const rest = restOf(section);
    expect(rest).not.toBe("");
    const response = await app().request(rest, inPage);
    expect(response.status).toBe(200);
    const doc = new Doc();
    parseHtml(await response.text(), doc);
    const more = doc.querySelectorAll(".capability-item b").map((b) => b.textContent);
    expect(more).toEqual(newestFirst.slice(LISTED_AT_FIRST));
  });

  test("Show all goes on after the last card shown, so a record linked since repeats none", async () => {
    const all = ["A", "B", "C", "D", "E", "F", "G"];
    for (const [index, title] of all.entries()) book(`book-${index}`, title, index + 1);
    const [section] = (await opened()).sections as [El];
    book("book-new", "Newest", 28);
    const response = await app().request(restOf(section), inPage);
    const doc = new Doc();
    parseHtml(await response.text(), doc);
    expect(doc.querySelectorAll(".capability-item b").map((b) => b.textContent)).toEqual([
      "B",
      "A",
    ]);
  });

  test("Show all goes on inside a second shared by many, as the database stamps a time", async () => {
    // `datetime('now')`: a space in it, and one second for every book saved in it.
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    for (const [index, title] of names.entries()) {
      book(`book-${index}`, title, 1, "author", "2026-10-15 00:14:10");
    }
    const [section] = (await opened()).sections as [El];
    const byId = [...names].reverse();
    expect(titles(section)).toEqual(byId.slice(0, LISTED_AT_FIRST));
    const response = await app().request(restOf(section), inPage);
    const doc = new Doc();
    parseHtml(await response.text(), doc);
    const rest = doc.querySelectorAll(".capability-item b").map((b) => b.textContent);
    expect(rest).toEqual(byId.slice(LISTED_AT_FIRST));
  });

  test("Show all asked outside the window, or without where to go on from, answers nothing", async () => {
    for (let index = 0; index < LISTED_AT_FIRST + 1; index += 1)
      book(`book-${index}`, "T", index + 1);
    const [section] = (await opened()).sections as [El];
    const rest = restOf(section);
    expect((await app().request(rest)).status).toBe(404);
    expect((await app().request(rest.split("?")[0] as string, inPage)).status).toBe(404);
  });
});

describe("which relations get a section", () => {
  test("a capability linking here through two fields gets two sections, headed alike", async () => {
    storeRelations(conns(), "books", [BOOK_AUTHOR, BOOK_TITLE]);
    book("book-1", "Mistborn", 1);
    link("books", "book-1", "title");
    const { sections } = await opened();
    expect(sections).toHaveLength(2);
    expect(heading(sections[0] as El)).toBe(heading(sections[1] as El));
    const ids = sections.map((section) => section.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
  });

  test("a relation with no record linking here has no section, and a record nothing links to has none", async () => {
    storeRelations(conns(), "memos", [MEMO_SUBJECT]);
    book("book-1", "Mistborn", 1);
    const { sections } = await opened();
    expect(sections.map(heading).every((text) => text.startsWith(BOOKS.label))).toBe(true);
    expect((await opened(LE_GUIN)).sections).toHaveLength(0);
  });

  test("a link row naming a record its capability no longer holds is not counted", async () => {
    book("book-1", "Mistborn", 1);
    link("books", "book-gone", "author");
    const [section] = (await opened()).sections as [El];
    expect(heading(section).endsWith(" 1")).toBe(true);
    expect(titles(section)).toEqual(["Mistborn"]);
  });

  test("a dormant relation has no section", async () => {
    // A source that can no longer hold the target's longest name puts the relation to sleep.
    book("book-1", "Mistborn", 1);
    const shorter = deskRow({
      ...BOOKS,
      fields: BOOKS.fields.map((field) =>
        field.name === "author" ? { ...field, max_length: 80 } : field,
      ),
    });
    conns().readwrite.run("UPDATE capability_registry SET schema = ? WHERE id = 'books'", [
      JSON.stringify(shorter.schema),
    ]);
    expect((await opened()).sections).toHaveLength(0);
  });
});

describe("the record address's route and its read tokens", () => {
  test("holds a read token for each linking incarnation apart from the record's, and gives every one back", async () => {
    book("book-1", "Mistborn", 1);
    const readGates = gates();
    const during: Record<string, number>[] = [];
    const loadItemRenderer: ItemRendererLoader = async (path) => {
      const card = await booksCard(path);
      return (record) => {
        during.push(readers(readGates));
        return card(record);
      };
    };
    await opened(SANDERSON, { readGates, loadItemRenderer });
    expect(during[0]).toMatchObject({ authors: 1, books: 1 });
    expect(readers(readGates)).toMatchObject({ authors: 0, books: 0 });
  });

  test("lets each linking capability's token go once its sections are drawn", async () => {
    book("book-1", "Mistborn", 1);
    memo("memo-1", "Talk");
    const readGates = gates();
    const during: Record<string, number>[] = [];
    const loadItemRenderer: ItemRendererLoader = async (path) => {
      const card = await booksCard(path);
      if (path !== MEMOS_PATH) return card;
      return (record) => {
        during.push(readers(readGates));
        return card(record);
      };
    };
    await opened(SANDERSON, { readGates, loadItemRenderer });
    expect(during[0]).toMatchObject({ authors: 1, books: 0, memos: 1 });
  });

  test("draws no section after the record's own capability begins closing, and refuses the read", async () => {
    book("book-1", "Mistborn", 1);
    memo("memo-1", "Talk");
    const readGates = gates();
    const loaded: string[] = [];
    const loadItemRenderer: ItemRendererLoader = async (path) => {
      loaded.push(path);
      const card = await booksCard(path);
      return (record) => {
        void readGates.closeAndDrain(AUTHORS_GATE);
        return card(record);
      };
    };
    const response = await app({ readGates, loadItemRenderer }).request(
      `/capability/authors/${SANDERSON}`,
      inPage,
    );
    expect(response.status).toBe(409);
    expect(loaded).toEqual([BOOKS_PATH]);
    expect(readers(readGates)).toMatchObject({ authors: 0, books: 0, memos: 0 });
  });

  test("one closed while its renderer loads runs none of it, quietly", async () => {
    book("book-1", "Mistborn", 1);
    const readGates = gates();
    const drawn: unknown[] = [];
    const loadItemRenderer: ItemRendererLoader = async () => {
      void readGates.closeAndDrain(BOOKS_GATE);
      await Promise.resolve();
      return (record) => {
        drawn.push(record);
        return "<b>card</b>";
      };
    };
    const said = await quietly(async () => {
      const { sections } = await opened(SANDERSON, { readGates, loadItemRenderer });
      expect(sections).toHaveLength(0);
    });
    expect(drawn).toEqual([]);
    expect(said).toEqual([]);
  });

  test("one closed while its renderer is still loading hands its token back at once", async () => {
    book("book-1", "Mistborn", 1);
    const readGates = gates();
    const loadItemRenderer: ItemRendererLoader = () => {
      setTimeout(() => void readGates.closeAndDrain(BOOKS_GATE), 5);
      return new Promise(() => {});
    };
    const started = performance.now();
    const { sections } = await opened(SANDERSON, { readGates, loadItemRenderer });
    expect(sections).toHaveLength(0);
    // Long before the time limit, which a load that ignored the close would wait out.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("a linking capability closed by its own deletion leaves its section out, and the record opens", async () => {
    book("book-1", "Mistborn", 1);
    const readGates = gates();
    await readGates.closeAndDrain(BOOKS_GATE);
    const { view, sections } = await opened(SANDERSON, { readGates });
    expect(sections).toHaveLength(0);
    expect(view.querySelector("form[data-record-edit-form]")).not.toBeNull();
  });

  test("one closed while its cards are drawn leaves its section out, quietly, and gives its token back", async () => {
    book("book-1", "Mistborn", 1);
    const readGates = gates();
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const loadItemRenderer: ItemRendererLoader = async (path) => {
      const card = await booksCard(path);
      return (record) => {
        void readGates.closeAndDrain(BOOKS_GATE);
        return card(record);
      };
    };
    try {
      const { sections } = await opened(SANDERSON, { readGates, loadItemRenderer });
      expect(sections).toHaveLength(0);
      expect(errors).not.toHaveBeenCalled();
      expect(readers(readGates)).toMatchObject({ authors: 0, books: 0 });
    } finally {
      errors.mockRestore();
    }
  });
});

describe("a card renderer that fails", () => {
  /** A renderer for Books that does `draw` instead of drawing a card. */
  const failing =
    (draw: () => string): ItemRendererLoader =>
    async (path) =>
      path === BOOKS_PATH ? () => draw() : booksCard(path);

  test("a throw leaves its section out and the record opens, and says why", async () => {
    book("book-1", "Mistborn", 1);
    const said = await quietly(async () => {
      const loadItemRenderer = failing(() => {
        throw new Error("the card broke");
      });
      const { view, sections } = await opened(SANDERSON, { loadItemRenderer });
      expect(sections).toHaveLength(0);
      expect(view.querySelector("form[data-record-edit-form]")).not.toBeNull();
    });
    expect(said).toHaveLength(1);
  });

  test("a return after the Handler time limit leaves its section out and the record opens", async () => {
    book("book-1", "Mistborn", 1);
    await quietly(async () => {
      const deps = { loadItemRenderer: failing(() => spin(30)), handlerTimeoutMs: 10 };
      const { view, sections } = await opened(SANDERSON, deps);
      expect(sections).toHaveLength(0);
      expect(view.querySelector("form[data-record-edit-form]")).not.toBeNull();
    });
  });

  test("a slow section leaves only itself out: the next capability's has a time limit of its own", async () => {
    book("book-1", "Mistborn", 1);
    memo("memo-1", "Talk");
    await quietly(async () => {
      const loadItemRenderer: ItemRendererLoader = async (path) =>
        path === BOOKS_PATH ? () => spin(400) : booksCard(path);
      const { sections } = await opened(SANDERSON, { loadItemRenderer, handlerTimeoutMs: 300 });
      expect(sections.map((section) => section.querySelector("i")?.textContent)).toEqual(["Talk"]);
    });
  });

  test("a renderer that never loads leaves its section out when the time limit ends", async () => {
    book("book-1", "Mistborn", 1);
    await quietly(async () => {
      const loadItemRenderer: ItemRendererLoader = () => new Promise(() => {});
      const { view, sections } = await opened(SANDERSON, {
        loadItemRenderer,
        handlerTimeoutMs: 30,
      });
      expect(sections).toHaveLength(0);
      expect(view.querySelector("form[data-record-edit-form]")).not.toBeNull();
    });
  });

  test("on Show all, a throw or a late return answers nothing, which leaves the section as it was", async () => {
    for (let index = 0; index < LISTED_AT_FIRST + 1; index += 1)
      book(`book-${index}`, "T", index + 1);
    const [section] = (await opened()).sections as [El];
    const rest = restOf(section);
    await quietly(async () => {
      const throwing = failing(() => {
        throw new Error("the card broke");
      });
      for (const deps of [
        { loadItemRenderer: throwing },
        { loadItemRenderer: failing(() => spin(30)), handlerTimeoutMs: 10 },
      ]) {
        const response = await app(deps).request(rest, inPage);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("");
      }
    });
  });

  test("Show all for a relation that does not point here, or a record that is gone, answers nothing", async () => {
    book("book-1", "Mistborn", 1);
    const record = `/capability/authors/${SANDERSON}`;
    const from = "?after=2026-09-02T00%3A00%3A00.000Z&last=book-9";
    for (const section of ["books/title", "memos/subject"]) {
      const response = await app().request(`${record}/listed/${section}${from}`, inPage);
      expect(response.status).toBe(404);
    }
    expect((await app().request(`${record}/listed/books/author${from}`, inPage)).status).toBe(200);
    conns().readwrite.run('DELETE FROM "cap_authors" WHERE "id" = ?', [SANDERSON]);
    expect((await app().request(`${record}/listed/books/author${from}`, inPage)).status).toBe(404);
  });
});
