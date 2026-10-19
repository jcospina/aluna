// Questions follow links, against the real worker and a real file.
//
// The desk holds Authors, Books linked to them by author, Reading Log linked to Books by title, and
// Memos whose link went dormant when its field was hidden. Le Guin was entered twice in Authors and
// her books picked the first, so a join guessed on the names counts each of her books twice.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import { UNKNOWN_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  type CapabilitySpec,
  type Relation,
  readActiveRegistryCatalog,
} from "../../../registry/index.ts";
import { insertCapability } from "../../../registry/store/store.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  MEMOS,
  READING_LOG,
  storeRelations,
  textField,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { applyCapabilityTableDdl, capabilityTableName } from "../../data/index.ts";
import { BOOK_AUTHOR, MEMO_SUBJECT } from "../../data/links/linked-text.test-support.ts";
import { rowSpec } from "../../router/dispatch/router.test-support.ts";
import {
  answers,
  nextPrompt,
  type QuestionDesk,
  questionDesk,
  reads,
  registeredSpecs,
  scriptedProvider,
} from "../question.test-support.ts";
import { QUESTION_LINK_COLUMNS, questionRelations } from "../scope/question-views.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "../scope/read-scope.test-support.ts";
import type { QuestionStep } from "../step/question-step.ts";
import { QUESTION_LINK_RULES, QUESTION_LINKS_HEADING } from "../turn/question-turn-prompt.ts";

const LE_GUIN = "Ursula K. Le Guin";

const ENTRY_TITLE: Relation = {
  field: "title",
  to: { capability: "books", incarnation: BOOKS_INCARNATION, field: "title" },
};

/** Memos with its linked field hidden, and a column of its own named as the link table's hidden one. */
const HIDDEN_MEMOS = {
  ...MEMOS,
  fields: [
    textField("subject", "Subject", { lifecycle: "inactive" }),
    textField("target_incarnation", "Target incarnation"),
  ],
};

const AUTHOR_ROWS = [
  ["author-le-guin", LE_GUIN],
  ["author-le-guin-again", LE_GUIN],
  ["author-butler", "Octavia E. Butler"],
  ["author-sanderson", "Brandon Sanderson"],
] as const;

/** Each book's id, title, author as typed, and the author record it picked, if it picked one. */
const BOOK_ROWS = [
  ["book-left-hand", "The Left Hand of Darkness", LE_GUIN, "author-le-guin"],
  ["book-earthsea", "A Wizard of Earthsea", LE_GUIN, "author-le-guin"],
  ["book-kindred", "Kindred", "Octavia E. Butler", "author-butler"],
  ["book-mistborn", "Mistborn", "Brandon Sanderson", "author-sanderson"],
  ["book-dazai", "Indigno de ser humano", "Osamu Dazai", null],
] as const;

const ENTRY_ROWS = [
  ["entry-left-hand", "The Left Hand of Darkness", "book-left-hand"],
  ["entry-earthsea", "A Wizard of Earthsea", "book-earthsea"],
  ["entry-mistborn", "Mistborn", "book-mistborn"],
] as const;

const RELATIONS: Readonly<Record<string, readonly Relation[]>> = {
  books: [BOOK_AUTHOR],
  reading_log: [ENTRY_TITLE],
  memos: [MEMO_SUBJECT],
};

function catalogue(database: Database): readonly CapabilitySpec[] {
  const rows = [AUTHORS, BOOKS, READING_LOG, HIDDEN_MEMOS].map(deskRow);
  for (const row of rows) {
    insertCapability(row, database);
    applyCapabilityTableDdl(rowSpec(row), database);
  }
  for (const [id, relations] of Object.entries(RELATIONS)) {
    storeRelations({ readwrite: database }, id, relations);
  }
  return rows.map(rowSpec);
}

function seed(database: Database): void {
  const insert = (table: string, column: string, id: string, text: string) =>
    database.run(`INSERT INTO "${table}" ("id", "${column}") VALUES (?, ?)`, [id, text]);
  const toAuthor = (record: string) => ({
    capability: "authors",
    incarnation: AUTHORS_INCARNATION,
    record,
  });
  for (const [id, name] of AUTHOR_ROWS) insert("cap_authors", "name", id, name);
  for (const [id, title, author, picked] of BOOK_ROWS) {
    database.run('INSERT INTO "cap_books" ("id", "title", "author") VALUES (?, ?, ?)', [
      id,
      title,
      author,
    ]);
    if (picked)
      writeLinkRow(
        database,
        { capability: "books", record: id, field: "author" },
        toAuthor(picked),
      );
  }
  for (const [id, title, picked] of ENTRY_ROWS) {
    insert("cap_reading_log", "title", id, title);
    writeLinkRow(
      database,
      { capability: "reading_log", record: id, field: "title" },
      { capability: "books", incarnation: BOOKS_INCARNATION, record: picked },
    );
  }
  insert("cap_memos", "subject", "memo-1", LE_GUIN);
  writeLinkRow(
    database,
    { capability: "memos", record: "memo-1", field: "subject" },
    { capability: "books", incarnation: BOOKS_INCARNATION, record: "book-left-hand" },
  );
  // A capability no longer on the desk, a book no longer in Books, and a pick of a record from
  // another incarnation of Authors.
  writeLinkRow(
    database,
    { capability: "gone", record: "gone-1", field: "name" },
    toAuthor("author-le-guin"),
  );
  writeLinkRow(
    database,
    { capability: "books", record: "book-gone", field: "author" },
    toAuthor("author-le-guin"),
  );
  writeLinkRow(
    database,
    { capability: "books", record: "book-dazai", field: "author" },
    { capability: "authors", incarnation: UNKNOWN_INCARNATION_ID, record: "author-earlier" },
  );
}

let platforms: ScratchPlatforms;

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => platforms.disposeAll());

function linkedDesk(): QuestionDesk {
  return questionDesk(platforms, seed, catalogue);
}

/** The prompt a question's first turn on `desk` is built from. */
function firstPrompt(desk: QuestionDesk, question: string): string {
  const catalog = readActiveRegistryCatalog(desk.database.readonly);
  const specs = registeredSpecs(desk.database.readonly);
  return nextPrompt(question, specs, [], null, questionRelations(catalog));
}

/** The join the catalog says follows one linked column, as the catalog wrote it. */
function joinFrom(prompt: string, capability: string, field: string): string {
  const line = prompt
    .split("\n")
    .find(
      (each) =>
        each.includes(`source_capability = '${capability}'`) &&
        each.includes(`source_field = '${field}'`),
    );
  if (line === undefined) throw new Error(`the catalog shows no join for ${capability}.${field}`);
  return line.slice(line.indexOf("JOIN "));
}

function rowsOf(step: QuestionStep | undefined) {
  if (step?.result.outcome !== "rows") throw new Error(`the step failed: ${JSON.stringify(step)}`);
  return step.result.rows;
}

describe("a question follows links", () => {
  test("through one: Le Guin's books come to two, where a join on the names counts four", async () => {
    const desk = linkedDesk();
    const question = "how many books by Le Guin do I have?";
    const join = joinFrom(firstPrompt(desk, question), "books", "author");

    const { result, steps, prompts } = await desk.run(
      scriptedProvider(
        reads(`SELECT count(*) AS books FROM cap_books ${join} WHERE cap_authors.name = ?`, [
          LE_GUIN,
        ]),
        reads(
          "SELECT count(*) AS books FROM cap_books JOIN cap_authors ON cap_authors.name = cap_books.author WHERE cap_authors.name = ?",
          [LE_GUIN],
        ),
        answers(),
      ),
      question,
    );

    expect(result.ending).toBe("answered");
    expect(prompts[0]).toContain(join);
    expect(rowsOf(steps[0])).toEqual([{ books: 2 }]);
    expect(rowsOf(steps[1])).toEqual([{ books: 4 }]);
    expect([...(steps[0]?.collections ?? [])].sort()).toEqual([AUTHORS.label, BOOKS.label]);
  });

  test("through two: Le Guin's books in the reading log come to two", async () => {
    const desk = linkedDesk();
    const question = "how many of Le Guin's books are in my reading log?";
    const prompt = firstPrompt(desk, question);
    const toBooks = joinFrom(prompt, "reading_log", "title");
    const toAuthors = joinFrom(prompt, "books", "author");

    const { result, steps } = await desk.run(
      scriptedProvider(
        reads(
          `SELECT count(*) AS entries FROM cap_reading_log ${toBooks} ${toAuthors} WHERE cap_authors.name = ?`,
          [LE_GUIN],
        ),
        answers(),
      ),
      question,
    );

    expect(result.ending).toBe("answered");
    expect(rowsOf(steps[0])).toEqual([{ entries: 2 }]);
    expect([...(steps[0]?.collections ?? [])].sort()).toEqual(
      [AUTHORS.label, BOOKS.label, READING_LOG.label].sort(),
    );
  });
});

describe("the link table, as a question reads it", () => {
  test("holds the rows of relations that hold, and nothing of a dormant one", async () => {
    const desk = linkedDesk();
    const linked = [
      ...BOOK_ROWS.filter(([, , , picked]) => picked !== null).map(([record]) => ({
        capability: "books",
        record,
      })),
      ...ENTRY_ROWS.map(([record]) => ({ capability: "reading_log", record })),
    ];

    const { steps } = await desk.run(
      scriptedProvider(
        reads(
          `SELECT source_capability AS capability, source_record AS record FROM ${LINK_TABLE} ORDER BY 1, 2`,
        ),
        answers(),
      ),
    );

    const stored = desk.database.readonly.query(`SELECT count(*) AS n FROM ${LINK_TABLE}`).get();
    expect(stored).toEqual({ n: linked.length + 4 });
    const key = ({ capability, record }: (typeof linked)[number]) => `${capability} ${record}`;
    expect(rowsOf(steps[0])).toEqual(
      linked.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
    );
  });

  test("is read through its view alone, which names no incarnation", async () => {
    const desk = linkedDesk();
    const countIn = (schema: string) => `SELECT count(*) AS links FROM ${schema}.${LINK_TABLE}`;
    const ofAuthors = `SELECT count(*) AS links FROM ${LINK_TABLE} WHERE target_capability = 'authors'`;
    // Each but the read of `main` is refused before it reaches the worker, as `extra` is: an index
    // seek compares the column unread, and the view would read the quoted name as a string.
    const refused: [string, string[]][] = [
      [`SELECT target_incarnation AS incarnation FROM ${LINK_TABLE}`, []],
      [`SELECT * FROM ${LINK_TABLE}`, []],
      [`${ofAuthors} AND target_incarnation = ?`, [AUTHORS_INCARNATION]],
      [`${ofAuthors} AND "target_incarnation" = ?`, ["target_incarnation"]],
      [`${ofAuthors} AND TARGET_INCARNATION = ?`, [AUTHORS_INCARNATION]],
      [`SELECT extra AS extra FROM ${capabilityTableName(BOOKS.id)}`, []],
      [countIn("question_desk"), []],
    ];

    const ownColumn = `SELECT target_incarnation AS incarnation FROM ${capabilityTableName(MEMOS.id)}`;

    const { steps } = await desk.run(
      scriptedProvider(
        ...refused.map(([sql, parameters]) => reads(sql, parameters)),
        reads(countIn("main")),
        reads(ownColumn),
        answers(),
      ),
    );

    expect(steps.map((step) => step.result.outcome)).toEqual([
      ...refused.map(() => "failed" as const),
      "failed",
      "rows",
    ]);
    expect(desk.statements()).toEqual([countIn("main"), ownColumn]);
    expect(desk.shadows()).toHaveLength(1);
    const told = JSON.stringify(desk.shadows());
    for (const incarnation of [AUTHORS_INCARNATION, BOOKS_INCARNATION, UNKNOWN_INCARNATION_ID]) {
      expect(told).not.toContain(incarnation);
    }
  });
});

describe("the catalog a question turn reads", () => {
  test("names each relation that holds and how to join through it, and no incarnation", async () => {
    const desk = linkedDesk();
    const { prompts } = await desk.run(scriptedProvider(answers()), "who wrote Kindred?");
    const [prompt = ""] = prompts;
    const holding = [
      { source: "books", relation: BOOK_AUTHOR },
      { source: "reading_log", relation: ENTRY_TITLE },
    ];

    for (const { source, relation } of holding) {
      expect(joinFrom(prompt, source, relation.field)).toContain(
        capabilityTableName(relation.to.capability),
      );
      // Each column a link copies is named once, by its linked column: the joins name only tables.
      const picked = `${capabilityTableName(relation.to.capability)}.${relation.to.field}`;
      expect(prompt.split(picked)).toHaveLength(2);
    }
    expect(() => joinFrom(prompt, "memos", MEMO_SUBJECT.field)).toThrow();
    for (const column of QUESTION_LINK_COLUMNS) expect(prompt).toContain(column);
    for (const rule of QUESTION_LINK_RULES) expect(prompt).toContain(rule);
    for (const incarnation of [AUTHORS_INCARNATION, BOOKS_INCARNATION]) {
      expect(prompt).not.toContain(incarnation);
    }
  });

  test("says nothing of links on a desk where no relation holds, and shows no link row", async () => {
    const strayLink = (database: Database) =>
      writeLinkRow(
        database,
        { capability: "notes", record: "note-1", field: "text" },
        { capability: "expenses", incarnation: UNKNOWN_INCARNATION_ID, record: "expense-1" },
      );
    const { prompts, steps } = await questionDesk(platforms, strayLink).run(
      scriptedProvider(reads(`SELECT count(*) AS links FROM ${LINK_TABLE}`), answers()),
    );

    expect(prompts[0]).not.toContain(QUESTION_LINKS_HEADING);
    expect(prompts[0]).not.toContain(LINK_TABLE);
    expect(rowsOf(steps[0])).toEqual([{ links: 0 }]);
  });
});
