// The records an answer names (7.5/04, ADR-0010), over the real loop, the real worker and a desk
// whose records carry the ids `randomUUID()` writes. The model is scripted throughout: what is
// proved is what the platform keeps of a nomination, never what a model would nominate.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ActiveRegistryCatalog } from "../../../registry/index.ts";
import {
  MOST_ANSWER_RECORDS,
  QUESTION_ANSWER_RECORD_RULES,
  QuestionAnswerUnreadableError,
  questionAnswerSchema,
} from "../endings/question-answer.ts";
import {
  answers,
  EXPENSES_CAPABILITY,
  EXPENSES_TABLE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  nextPrompt,
  type QuestionDesk,
  questionDesk,
  reads,
  registeredSpecs,
  scriptedProviderSaying,
} from "../question.test-support.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "../scope/read-scope.test-support.ts";
import type { QuestionStep } from "../step/question-step.ts";
import { QUESTION_RECORD_ID_RULES } from "../turn/question-turn-prompt.ts";
import { idDigits } from "./answer-record-ids.ts";
import { linkTheRecordsNamed } from "./answer-records.ts";

let platforms: ScratchPlatforms;

const MILK_RUN = { id: randomUUID(), text: "Milk run" };
const WEEKLY_SHOP = { id: randomUUID(), text: "Weekly shop" };
const RENT_DAY = { id: randomUUID(), text: "Rent day" };
/** An expense whose id a note's own text repeats: words a person saved, pointing elsewhere. */
const BOOKS = { id: randomUUID(), text: "Books" };
const POINTING_NOTE = { id: randomUUID(), text: BOOKS.id };
/** One id written into both collections, which `randomUUID()` never does and a hand can. */
const TWICE = { id: randomUUID(), text: "Twice over" };
/** Two records under one name, which a person can easily have. */
const OOLONG = { id: randomUUID(), text: "Oolong" };
const OOLONG_AGAIN = { id: randomUUID(), text: "Oolong" };
const PICNIC = { id: randomUUID(), text: "\u{1F600} Picnic" };
/** A note whose name is the start of another's. */
const MILK = { id: randomUUID(), text: "Milk" };
/** Names spelled in ways a model may not echo exactly: a joiner, decomposed, an apostrophe, han. */
const GREEN_TEA = { id: randomUUID(), text: "\u0686\u0627\u06CC\u200C\u0633\u0628\u0632" };
const CAFE = { id: randomUUID(), text: "Cafe\u0301 Noir" };
const GRANDMA = { id: randomUUID(), text: "Grandma's Blend" };
const LONGJING = { id: randomUUID(), text: "\u9F99\u4E95\u8336" };
/** A mark no precomposed letter stands for, so it stays a letter of its own after composing. */
const DOTTED = { id: randomUUID(), text: "Ziq\u0307 Noir" };
/** A note holding an id-shaped key that is no record's. */
const LICENSE = { id: randomUUID(), text: `License key ${randomUUID()}` };

const LISTING = `SELECT id AS id, text AS note FROM ${NOTES_TABLE} WHERE text IN (?, ?)`;
const COUNTING = `SELECT count(*) AS notes FROM ${NOTES_TABLE}`;
const BOTH = `SELECT id AS id, text AS name FROM ${NOTES_TABLE} UNION ALL SELECT id, text FROM ${EXPENSES_TABLE}`;
const QUESTION = "which of my notes are about shopping?";

function seedNamedRecords(database: Database): void {
  const note = database.prepare(
    `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, '2026-09-01 09:00:00', '{}', ?)`,
  );
  for (const { id, text } of [
    MILK_RUN,
    WEEKLY_SHOP,
    RENT_DAY,
    POINTING_NOTE,
    TWICE,
    OOLONG,
    OOLONG_AGAIN,
    PICNIC,
    LICENSE,
    MILK,
    GREEN_TEA,
    CAFE,
    GRANDMA,
    LONGJING,
    DOTTED,
  ]) {
    note.run(id, text);
  }
  note.finalize();
  const expense = database.prepare(
    `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, text, amount) VALUES (?, '2026-09-01 09:00:00', '{}', ?, 1)`,
  );
  for (const { id, text } of [BOOKS, TWICE]) expense.run(id, text);
  expense.finalize();
}

function namedDesk(): QuestionDesk {
  return questionDesk(platforms, seedNamedRecords);
}

/** What the model writes back, through the real schema. */
function written(answer: string, records: readonly { says: string; id: string }[] = []) {
  return questionAnswerSchema.parse({ answer, records });
}

const SHOPPING = written(`Two of them: ${MILK_RUN.text} and ${WEEKLY_SHOP.text}.`, [
  { says: MILK_RUN.text, id: MILK_RUN.id },
  { says: WEEKLY_SHOP.text, id: WEEKLY_SHOP.id },
]);

/** Ask with one scripted statement, and hand back how the question ended. */
async function ask(
  said: ReturnType<typeof written>,
  sql = LISTING,
  parameters: readonly string[] = [MILK_RUN.text, WEEKLY_SHOP.text],
) {
  const run = await namedDesk().run(
    scriptedProviderSaying(said, reads(sql, [...parameters], "listing"), answers()),
    QUESTION,
  );
  if (run.result.ending !== "answered") throw new Error("the fixture answers");
  return { ...run.result, answerPrompts: run.answerPrompts };
}

/** The words each link covers, and the record it opens. */
function linked(answer: string, links: readonly { from: number; to: number; record: string }[]) {
  return links.map(({ from, to, record }) => ({ says: answer.slice(from, to), record }));
}

/** A finished listing's desk and steps, for a suite that runs the checks against them itself. */
async function stepsOf(said: ReturnType<typeof written>) {
  const desk = namedDesk();
  const { steps } = await desk.run(
    scriptedProviderSaying(said, reads(LISTING, [MILK_RUN.text, WEEKLY_SHOP.text]), answers()),
    QUESTION,
  );
  return { desk, steps: steps as readonly QuestionStep[] };
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("the turn reads the id only beside particular records", () => {
  test("the turn's prompt asks for it, and the answer's asks for the nominations", async () => {
    const desk = namedDesk();
    const prompt = nextPrompt(QUESTION, registeredSpecs(desk.database.readonly), []);
    const { answerPrompts } = await ask(SHOPPING);

    expect(prompt).toContain(QUESTION_RECORD_ID_RULES.join("\n"));
    expect(answerPrompts[0]).toContain(QUESTION_ANSWER_RECORD_RULES.join("\n"));
  });

  test("a listing that selects id links each record it names", async () => {
    const { answer, links } = await ask(SHOPPING);

    expect(answer).toBe(SHOPPING.answer);
    expect(linked(answer, links)).toEqual([
      { says: MILK_RUN.text, record: MILK_RUN.id },
      { says: WEEKLY_SHOP.text, record: WEEKLY_SHOP.id },
    ]);
    expect(links.map((link) => link.capability)).toEqual([
      NOTES_CAPABILITY.id,
      NOTES_CAPABILITY.id,
    ]);
  });

  test("a count selects no id, so a record it nominates anyway links nothing", async () => {
    const said = written("You have six notes.", [{ says: "six notes", id: MILK_RUN.id }]);
    const { answer, links, answerPrompts } = await ask(said, COUNTING, []);

    expect(answerPrompts[0]).not.toContain(MILK_RUN.id);
    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });
});

describe("a nomination that fails a check is dropped, and the answer is still spoken", () => {
  test("an id no step returned", async () => {
    const said = written(`${MILK_RUN.text} and ${RENT_DAY.text}.`, [
      { says: MILK_RUN.text, id: MILK_RUN.id },
      { says: RENT_DAY.text, id: RENT_DAY.id },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(said.answer);
    expect(linked(answer, links)).toEqual([{ says: MILK_RUN.text, record: MILK_RUN.id }]);
  });

  test("an id that is no record's at all, in any spelling", async () => {
    const forged = randomUUID();
    const said = written(`${MILK_RUN.text}.`, [
      { says: MILK_RUN.text, id: forged },
      { says: MILK_RUN.text, id: "note-1" },
      { says: MILK_RUN.text, id: "" },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("an id held by two of the capabilities the step read", async () => {
    const said = written(`${TWICE.text} and ${BOOKS.text}.`, [
      { says: TWICE.text, id: TWICE.id },
      { says: BOOKS.text, id: BOOKS.id },
    ]);
    const { answer, links } = await ask(said, BOTH, []);

    expect(answer).toBe(said.answer);
    expect(linked(answer, links)).toEqual([{ says: BOOKS.text, record: BOOKS.id }]);
    expect(links[0]?.capability).toBe(EXPENSES_CAPABILITY.id);
  });

  test("an id a person's own text carries, pointing into a collection the step never read", async () => {
    const said = written(`${MILK_RUN.text} is the one.`, [{ says: MILK_RUN.text, id: BOOKS.id }]);
    const { answer, links } = await ask(said, LISTING, [MILK_RUN.text, POINTING_NOTE.text]);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("words the answer does not hold, or that say nothing", async () => {
    const said = written(`${MILK_RUN.text}.`, [
      { says: WEEKLY_SHOP.text, id: WEEKLY_SHOP.id },
      { says: " ", id: WEEKLY_SHOP.id },
      { says: "", id: WEEKLY_SHOP.id },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("words that occur only inside another link", async () => {
    const said = written(`${WEEKLY_SHOP.text} is the one.`, [
      { says: WEEKLY_SHOP.text, id: WEEKLY_SHOP.id },
      { says: "shop", id: WEEKLY_SHOP.id },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(said.answer);
    expect(linked(answer, links)).toEqual([{ says: WEEKLY_SHOP.text, record: WEEKLY_SHOP.id }]);
  });

  test("words its own record does not hold, beside an id a statement echoed", async () => {
    // The statement returns one record's id beside another's name; the name is not that record's.
    const echoing = `SELECT ? AS id, text AS note FROM ${NOTES_TABLE} WHERE text = ?`;
    const said = written(`${MILK_RUN.text} is the one.`, [
      { says: MILK_RUN.text, id: RENT_DAY.id },
    ]);
    const { answer, links } = await ask(said, echoing, [RENT_DAY.id, MILK_RUN.text]);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("words that name another record, returned beside this one's id by a join", async () => {
    const joined = `SELECT r.id AS id, n.text AS note FROM ${NOTES_TABLE} AS n, ${NOTES_TABLE} AS r WHERE n.text = ? AND r.text = ?`;
    const said = written(`${MILK.text} is the one.`, [{ says: MILK.text, id: MILK_RUN.id }]);
    const { answer, links } = await ask(said, joined, [MILK.text, MILK_RUN.text]);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("words that are a letter of a name, or a date the record was saved on", async () => {
    const dated = `SELECT id AS id, text AS note, created_at AS saved FROM ${NOTES_TABLE} WHERE text IN (?, ?)`;
    const said = written(`${WEEKLY_SHOP.text}, saved 2026-09-01 09:00:00.`, [
      { says: "e", id: WEEKLY_SHOP.id },
      { says: "2026-09-01 09:00:00", id: WEEKLY_SHOP.id },
    ]);
    const { answer, links } = await ask(said, dated);

    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("words far longer than the answer are dropped before any id is looked for in them", async () => {
    // A held id wrapped round itself: a scan that went looking would take a pass per layer.
    let onion = MILK_RUN.id;
    for (let layer = 0; layer < 1500; layer += 1) {
      onion = `${MILK_RUN.id.slice(0, 18)}${onion}${MILK_RUN.id.slice(18)}`;
    }
    const said = written(`${MILK_RUN.text}.`, [{ says: `Milk ${onion}`, id: MILK_RUN.id }]);
    const started = performance.now();
    const { links } = await ask(said);

    expect(links).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("words that would cut a character in two", async () => {
    const [high, low] = [...PICNIC.text][0]?.split("") ?? [];
    const said = written(`Look ${PICNIC.text} here.`, [
      { says: `${low}${PICNIC.text.slice(2)}`, id: PICNIC.id },
    ]);
    const { answer, links } = await ask(said, LISTING, [PICNIC.text, MILK_RUN.text]);

    expect(high).toBeDefined();
    expect(answer).toBe(said.answer);
    expect(links).toEqual([]);
  });

  test("a capability with no record view", async () => {
    const steps = await stepsOf(SHOPPING);
    const withoutUpdate = (catalog: ActiveRegistryCatalog): ActiveRegistryCatalog => ({
      ...catalog,
      capabilities: catalog.capabilities.map((row) => ({
        ...row,
        tools: row.tools.filter((tool) => tool !== "update") as typeof row.tools,
      })),
    });

    const spoken = await steps.desk.inScope((scope) =>
      linkTheRecordsNamed(
        { scope: { ...scope, read: scope.read, catalog: withoutUpdate(scope.catalog) } },
        steps.steps,
        SHOPPING,
      ),
    );

    expect(spoken).toEqual({ answer: SHOPPING.answer, links: [] });
  });
});

describe("a check that cannot be read", () => {
  const failing = () => Promise.reject(new Error("the worker went away"));

  test("costs the links and takes every id out, and the answer is still spoken", async () => {
    const steps = await stepsOf(SHOPPING);
    const said = written(`${MILK_RUN.text} (${MILK_RUN.id}).`, [
      { says: MILK_RUN.text, id: MILK_RUN.id },
    ]);

    const spoken = await steps.desk.inScope((scope) =>
      linkTheRecordsNamed({ scope: { ...scope, read: failing } }, steps.steps, said),
    );

    expect(spoken).toEqual({ answer: `${MILK_RUN.text}.`, links: [] });
  });

  test("but a question that was cancelled while it read stays cancelled", async () => {
    const steps = await stepsOf(SHOPPING);
    const over = new AbortController();
    over.abort();

    const spoken = steps.desk.inScope((scope) =>
      linkTheRecordsNamed(
        { scope: { ...scope, read: failing, signal: over.signal } },
        steps.steps,
        SHOPPING,
      ),
    );

    await expect(spoken).rejects.toThrow(Error);
  });
});

describe("where a link goes", () => {
  test("two records under one name link the first and then the next free occurrence", async () => {
    const said = written(`${OOLONG.text}, then another ${OOLONG.text}.`, [
      { says: OOLONG.text, id: OOLONG.id },
      { says: OOLONG_AGAIN.text, id: OOLONG_AGAIN.id },
    ]);
    const { answer, links } = await ask(said, LISTING, [OOLONG.text, MILK_RUN.text]);

    expect(links.map((link) => link.from)).toEqual([0, answer.lastIndexOf(OOLONG.text)]);
    expect(links.map((link) => link.record)).toEqual([OOLONG.id, OOLONG_AGAIN.id]);
  });

  test("words standing as their own word are linked before the same letters inside a longer one", async () => {
    const said = written("A workshop, and the shop itself.", [
      { says: "shop", id: WEEKLY_SHOP.id },
    ]);
    const { answer, links } = await ask(said);

    expect(links.map((link) => link.from)).toEqual([answer.indexOf("shop itself")]);
  });

  test("a short name inside a longer one does not take it", async () => {
    const said = written(`${MILK_RUN.text} and ${MILK.text}.`, [
      { says: MILK.text, id: MILK.id },
      { says: MILK_RUN.text, id: MILK_RUN.id },
    ]);
    const { answer, links } = await ask(said, LISTING, [MILK.text, MILK_RUN.text]);

    expect(linked(answer, links)).toEqual([
      { says: MILK_RUN.text, record: MILK_RUN.id },
      { says: MILK.text, record: MILK.id },
    ]);
  });

  test("a name written with a joiner keeps it, and links", async () => {
    const said = written(`${GREEN_TEA.text}.`, [{ says: GREEN_TEA.text, id: GREEN_TEA.id }]);
    const { answer, links } = await ask(said, LISTING, [GREEN_TEA.text, MILK.text]);

    expect(answer).toBe(said.answer);
    expect(answer).toContain("\u200C");
    expect(linked(answer, links)).toEqual([{ says: GREEN_TEA.text, record: GREEN_TEA.id }]);
  });

  test("a name saved decomposed or with a straight apostrophe still links her composed, curly one", async () => {
    const cafe = CAFE.text.normalize("NFC");
    const grandma = GRANDMA.text.replace("'", "\u2019");
    const said = written(`${cafe} and ${grandma}.`, [
      { says: cafe, id: CAFE.id },
      { says: grandma, id: GRANDMA.id },
    ]);
    const { answer, links } = await ask(said, LISTING, [CAFE.text, GRANDMA.text]);

    expect(linked(answer, links)).toEqual([
      { says: cafe, record: CAFE.id },
      { says: grandma, record: GRANDMA.id },
    ]);
  });

  test("a name never links the letters before a combining mark", async () => {
    const said = written(`${DOTTED.text}.`, [{ says: "Ziq", id: DOTTED.id }]);
    const { links } = await ask(said, LISTING, [DOTTED.text, MILK.text]);

    expect(links).toEqual([]);
  });

  test("a han name shortened inside its sentence still links", async () => {
    const short = LONGJING.text.slice(0, 2);
    const said = written(`\u6211\u6700\u559C\u6B22${short}\u3002`, [
      { says: short, id: LONGJING.id },
    ]);
    const { answer, links } = await ask(said, LISTING, [LONGJING.text, MILK.text]);

    expect(linked(answer, links)).toEqual([{ says: short, record: LONGJING.id }]);
  });

  test("words in any case link the record that holds them", async () => {
    const said = written(`Your ${MILK_RUN.text.toLowerCase()}.`, [
      { says: MILK_RUN.text.toLowerCase(), id: MILK_RUN.id },
    ]);
    const { answer, links } = await ask(said);

    expect(linked(answer, links)).toEqual([
      { says: MILK_RUN.text.toLowerCase(), record: MILK_RUN.id },
    ]);
  });

  test("links come back in the order they stand in the answer, whatever order she named them", async () => {
    const said = written(`${MILK_RUN.text} and ${WEEKLY_SHOP.text}.`, [
      { says: WEEKLY_SHOP.text, id: WEEKLY_SHOP.id },
      { says: MILK_RUN.text, id: MILK_RUN.id },
    ]);
    const { links } = await ask(said);

    expect(links.map((link) => link.record)).toEqual([MILK_RUN.id, WEEKLY_SHOP.id]);
  });
});

describe("the prose never shows an id", () => {
  test("an id she wrote is taken out, and the link beside it stays", async () => {
    const said = written(
      `${MILK_RUN.text} (${MILK_RUN.id}), ${WEEKLY_SHOP.text} ${WEEKLY_SHOP.id.toUpperCase()}.`,
      [{ says: MILK_RUN.text, id: MILK_RUN.id }],
    );
    const { answer, links } = await ask(said);

    expect(answer).toBe(`${MILK_RUN.text}, ${WEEKLY_SHOP.text}.`);
    expect(linked(answer, links)).toEqual([{ says: MILK_RUN.text, record: MILK_RUN.id }]);
  });

  test("an id a statement returned without its hyphens is still an id, and still links", async () => {
    const bare = `SELECT replace(id, '-', '') AS ref, text AS note FROM ${NOTES_TABLE} WHERE text IN (?, ?)`;
    const said = written(`${MILK_RUN.text} is ${idDigits(MILK_RUN.id)}.`, [
      { says: MILK_RUN.text, id: idDigits(MILK_RUN.id) },
    ]);
    const { answer, links } = await ask(said, bare);

    expect(answer).toBe(`${MILK_RUN.text} is.`);
    expect(linked(answer, links)).toEqual([{ says: MILK_RUN.text, record: MILK_RUN.id }]);
  });

  test("a key a person saved is no record's id, so she may still say it", async () => {
    const key = LICENSE.text.slice("License key ".length);
    const said = written(`Your license key is ${key}.`);
    const { answer } = await ask(said, LISTING, [LICENSE.text, MILK_RUN.text]);

    expect(answer).toBe(said.answer);
  });

  test("an id that ended the sentence leaves it stopped", async () => {
    const said = written(`${MILK_RUN.text}, ${MILK_RUN.id}`, [
      { says: MILK_RUN.text, id: MILK_RUN.id },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(`${MILK_RUN.text}.`);
    expect(linked(answer, links)).toEqual([{ says: MILK_RUN.text, record: MILK_RUN.id }]);
  });

  test("a bidi control cannot show digits in an order other than the one they were checked in", () => {
    const reversed = [...MILK_RUN.id].reverse().join("");
    const said = written(`${MILK_RUN.text} \u202E${reversed}.`);

    expect(said.answer).toBe(`${MILK_RUN.text} ${reversed}.`);
  });

  test("no bidi control reaches the window to reorder what was checked", () => {
    const controls = [
      "\u200E",
      "\u200F",
      "\u061C",
      "\u202A",
      "\u202B",
      "\u202C",
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
    ];
    const said = written(`${MILK_RUN.text} ${controls.join("")}is yours.`);

    expect(said.answer).toBe(`${MILK_RUN.text} is yours.`);
  });

  test("half a character either side of an id is not joined into one nobody wrote", () => {
    const said = written(`\uD800${MILK_RUN.id}\uDC00 ok`);

    expect(said.answer.isWellFormed()).toBe(true);
    expect(said.answer).not.toContain("\u{10000}");
  });

  test("words that would show an id are no link's text", async () => {
    const said = written(`${MILK_RUN.text} ${MILK_RUN.id}.`, [
      { says: `${MILK_RUN.text} ${MILK_RUN.id}`, id: MILK_RUN.id },
    ]);
    const { answer, links } = await ask(said);

    expect(answer).toBe(`${MILK_RUN.text}.`);
    expect(links).toEqual([]);
  });

  test("an answer that was nothing but an id is no answer", async () => {
    const said = written(MILK_RUN.id, [{ says: MILK_RUN.id, id: MILK_RUN.id }]);
    const asked = namedDesk().run(
      scriptedProviderSaying(said, reads(LISTING, [MILK_RUN.text, WEEKLY_SHOP.text]), answers()),
      QUESTION,
    );

    await expect(asked).rejects.toBeInstanceOf(QuestionAnswerUnreadableError);
  });
});

describe("how many records one answer may name", () => {
  test("only the first MOST_ANSWER_RECORDS nominations survive parsing", () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      says: `n${index}`,
      id: randomUUID(),
    }));
    const parsed = questionAnswerSchema.parse({ answer: "Plenty.", records: many });

    expect(parsed.records).toEqual(many.slice(0, MOST_ANSWER_RECORDS));
    expect(MOST_ANSWER_RECORDS).toBeLessThan(many.length);
  });
});
