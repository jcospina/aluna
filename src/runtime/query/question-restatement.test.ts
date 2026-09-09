// Aluna says what she looked at before she says what she found (PLAN decisions 3, 16 and 29).
//
// The order is not asked for and then hoped for. These fixtures prove that a finding on its own
// does not parse, and that the halves assemble looked-at first whatever they happen to say.
//
// The mis-scoped fixture: a desk filed under food, cheese and vegetables, a question asking about
// groceries, and a statement counting only the first of the three. What it proves is that the
// material the sentence is written from names the one category she used and the collection she
// read. The sentence itself is the model's, so what a rule-breaking model would say is not proved
// here and cannot be — see the issue's findings.
//
// No fixture here can judge whether the words read as speech; the sign-off gate does.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { zodSchema } from "ai";

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
  SCRIPTED_ANSWER,
  SCRIPTED_ANSWER_WRITTEN,
  scriptedProviderSaying,
} from "./question.test-support.ts";
import {
  ANSWER_STEP_IN,
  ANSWER_STEP_UNDER,
  QUESTION_ANSWER_RULES,
  questionAnswerSchema,
  questionAnswerSentence,
} from "./question-answer.ts";
import { QUESTION_NAMING_RULES } from "./question-turn.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

let platforms: ScratchPlatforms;

/** What this desk really calls its food shopping, and not one of them is the question's word. */
const CATEGORIES = [
  { text: "food", amount: 4 },
  { text: "cheese", amount: 7 },
  { text: "vegetables", amount: 9 },
] as const;
const NARROW_CATEGORY = CATEGORIES[0];
const GROCERIES = "groceries";
const GROCERIES_QUESTION = `how much did I spend on ${GROCERIES}?`;
const EVERY_CATEGORY = `SELECT DISTINCT text FROM ${EXPENSES_TABLE}`;
const ONE_CATEGORY_TOTAL = `SELECT sum(amount) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`;

/** Two halves that could not be mistaken for each other, whichever order they come out in. Put
 * through the schema, so what the fixture holds is what a generation of those words would be. */
const OUT_OF_ORDER = questionAnswerSchema.parse({ looked_at: "second", found: "first" });

/**
 * Expenses categorised the person's way. What `catalogueWithRecords` writes goes first, because
 * one of those rows is filed under the very word the question uses.
 */
function seedCategories(database: Database): void {
  database.run(`DELETE FROM ${EXPENSES_TABLE}`);
  const insert = database.prepare(
    `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, text, amount) VALUES (?, ?, '{}', ?, ?)`,
  );
  CATEGORIES.forEach(({ text, amount }, index) => {
    insert.run(`shop-${index}`, "2026-07-08 09:00:00", text, amount);
  });
  insert.finalize();
}

function categoriesDesk(): QuestionDesk {
  return questionDesk(platforms, seedCategories);
}

/** The run that gets it wrong: she reads the categories, then counts only the first of them. */
function askUnderOneCategory(desk: QuestionDesk, said: { looked_at: string; found: string }) {
  return desk.run(
    scriptedProviderSaying(
      said,
      reads(EVERY_CATEGORY, [], "naming"),
      reads(ONE_CATEGORY_TOTAL, [NARROW_CATEGORY.text], "totalling"),
      answers(),
    ),
    GROCERIES_QUESTION,
  );
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("what she looked at reaches the words she writes", () => {
  test("the collections a statement opened cross, by the name the person gave them", async () => {
    const { answerPrompts } = await askUnderOneCategory(categoriesDesk(), SCRIPTED_ANSWER_WRITTEN);
    const prompt = answerPrompts[0] as string;

    expect(prompt).toContain(`${ANSWER_STEP_IN} ${EXPENSES_CAPABILITY.label}`);
    // The label is the person's own word for their things; the table name is the machinery
    // under it, and it does not cross.
    expect(prompt).not.toContain(EXPENSES_TABLE);
    // Nor the collection she never opened, which is what makes the restatement worth reading.
    expect(prompt).not.toContain(NOTES_CAPABILITY.label);
  });

  test("and so do the values she narrowed to, which are her pick out of the data", async () => {
    const { answerPrompts } = await askUnderOneCategory(categoriesDesk(), SCRIPTED_ANSWER_WRITTEN);

    expect(answerPrompts[0]).toContain(
      `${ANSWER_STEP_UNDER} ${JSON.stringify([NARROW_CATEGORY.text])}`,
    );
  });
});

describe("which collections she names is read off the plan, not off the words", () => {
  test("a statement across two collections names both, in one settled order", async () => {
    // Joined on what differs rather than on what matches: nothing on this desk is filed under
    // both, and a join matching nothing would end the question before an answer is written.
    const both = `SELECT n.id FROM ${NOTES_TABLE} n JOIN ${EXPENSES_TABLE} e ON n.text <> e.text`;
    const { answerPrompts } = await categoriesDesk().run(
      scriptedProviderSaying(SCRIPTED_ANSWER_WRITTEN, reads(both, [], "listing"), answers()),
      GROCERIES_QUESTION,
    );

    // The scope's own order rather than the plan's, so one statement asked twice names them the
    // same way round. Neither order means anything, and an unstable one would look like it did.
    expect(answerPrompts[0]).toContain(
      `${ANSWER_STEP_IN} ${EXPENSES_CAPABILITY.label}, ${NOTES_CAPABILITY.label}`,
    );
  });

  test("a statement that only mentions a collection does not claim to have read it", async () => {
    // The whole reason the tables come off an `EXPLAIN`: a name inside a string is a word, and
    // a sweep over the statement's text would restate a collection nothing opened.
    const namesOne = `SELECT count(*) AS n FROM ${EXPENSES_TABLE} WHERE text <> '${NOTES_TABLE}'`;
    const { answerPrompts } = await categoriesDesk().run(
      scriptedProviderSaying(SCRIPTED_ANSWER_WRITTEN, reads(namesOne, [], "counting"), answers()),
      GROCERIES_QUESTION,
    );

    expect(answerPrompts[0]).toContain(`${ANSWER_STEP_IN} ${EXPENSES_CAPABILITY.label}`);
    expect(answerPrompts[0]).not.toContain(`${ANSWER_STEP_IN} ${NOTES_CAPABILITY.label}`);
  });

  test("and no operator can ride in as a column name, because every turn asks for AS", async () => {
    // The one machinery word that can still reach the answer's prompt is a column key, and an
    // unaliased `count(*)` is one. The turn asks for a name; nothing downstream can add one.
    const desk = categoriesDesk();

    expect(nextPrompt(GROCERIES_QUESTION, registeredSpecs(desk.database.readonly), [])).toContain(
      QUESTION_NAMING_RULES[0] as string,
    );
  });

  test("a statement that opens nothing claims nothing, and is never written from", async () => {
    const { result, answerPrompts } = await categoriesDesk().run(
      scriptedProviderSaying(
        SCRIPTED_ANSWER_WRITTEN,
        reads("SELECT 1 AS n", [], "other"),
        answers(),
      ),
      GROCERIES_QUESTION,
    );

    // There would be no line to write a restatement from, and `looked_at` is required. 6.4/04
    // closes it: a row nothing was scanned into matched nothing, so no generation runs at all
    // and the rule below is what holds a question that read something else as well.
    expect(answerPrompts).toEqual([]);
    expect(result.ending).toBe("nothing_found");
    expect(QUESTION_ANSWER_RULES.join("\n")).toContain("Where nothing is listed");
  });
});

describe("the order she says them in is the platform's", () => {
  test("the two halves are joined one way round, whatever they say", async () => {
    // Deliberately named the wrong way round: the order a person reads is not the model's to
    // choose, so halves that argue about which came first are still assembled looked-at first.
    const { result } = await askUnderOneCategory(categoriesDesk(), OUT_OF_ORDER);

    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(result.answer).toBe(questionAnswerSentence(OUT_OF_ORDER));
    expect(result.answer.indexOf(OUT_OF_ORDER.looked_at)).toBeLessThan(
      result.answer.indexOf(OUT_OF_ORDER.found),
    );
  });

  test("both halves are asked for in the shape a strict provider accepts", () => {
    // The second field is what carries the order, so it is also a second way to emit a schema
    // OpenAI's strict mode refuses. `question-tool.ts` says why an absent key is not an option.
    const emitted = zodSchema(questionAnswerSchema).jsonSchema as Record<string, unknown>;

    expect(emitted.required).toEqual(["looked_at", "found"]);
    expect(emitted.additionalProperties).toBe(false);
    for (const keyword of ["oneOf", "minLength", "maxLength", "pattern", "format", "default"]) {
      expect({ keyword, present: JSON.stringify(emitted).includes(keyword) }).toEqual({
        keyword,
        present: false,
      });
    }
  });

  test("a finding with nothing in front of it is not an answer at all", () => {
    const { looked_at, found } = SCRIPTED_ANSWER_WRITTEN;

    expect(questionAnswerSchema.safeParse({ found }).success).toBe(false);
    expect(questionAnswerSchema.safeParse({ looked_at }).success).toBe(false);
    // Including the shape the answer used to have, before there was an order to keep.
    expect(questionAnswerSchema.safeParse({ answer: `${looked_at}, ${found}` }).success).toBe(
      false,
    );
  });

  test("a finding that did not stop itself is stopped, and one that did is left alone", () => {
    const { looked_at } = SCRIPTED_ANSWER_WRITTEN;
    const finish = (found: string) => questionAnswerSchema.parse({ looked_at, found }).found;

    expect(finish("six are finished")).toBe("six are finished.");
    for (const ended of ["you have 22.", "was it?", "none at all!"]) {
      expect(finish(ended)).toBe(ended);
    }
  });

  test("and neither is a blank half, while a half with room round it is trimmed", () => {
    const { looked_at, found } = SCRIPTED_ANSWER_WRITTEN;

    for (const half of [
      { looked_at: "   ", found },
      { looked_at, found: " " },
    ]) {
      expect(questionAnswerSchema.safeParse(half).success).toBe(false);
    }
    expect(
      questionAnswerSchema.parse({ looked_at: `\n  ${looked_at}  `, found: `${found}  ` })
        .looked_at,
    ).toBe(looked_at);
  });

  test("a half that was only punctuation is not a restatement once the punctuation is gone", () => {
    const { found } = SCRIPTED_ANSWER_WRITTEN;

    expect(questionAnswerSchema.safeParse({ looked_at: ".", found }).success).toBe(false);
  });

  test("a clause that punctuated itself is still one sentence once it is joined", () => {
    const { looked_at, found } = SCRIPTED_ANSWER_WRITTEN;

    for (const stop of [",", ".", ";"]) {
      expect(
        questionAnswerSentence(
          questionAnswerSchema.parse({ looked_at: `${looked_at}${stop}`, found }),
        ),
      ).toBe(SCRIPTED_ANSWER);
    }
  });
});

describe("a restatement that is wrong is wrong where a person can see it", () => {
  test("she names the category she counted, ahead of the figure that is only right for it", async () => {
    const said = {
      looked_at: `Looking through your ${EXPENSES_CAPABILITY.label.toLowerCase()} under ${NARROW_CATEGORY.text}`,
      found: `you have spent ${NARROW_CATEGORY.amount}.`,
    };
    const { result } = await askUnderOneCategory(categoriesDesk(), said);

    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(result.answer).toContain(NARROW_CATEGORY.text);
    expect(result.answer.indexOf(NARROW_CATEGORY.text)).toBeLessThan(
      result.answer.indexOf(String(NARROW_CATEGORY.amount)),
    );
    // And never in the question's own word, which is what she would have had to invent to hide it.
    expect(result.answer).not.toContain(GROCERIES);
    for (const { text } of CATEGORIES.slice(1)) expect(result.answer).not.toContain(text);
  });

  test("and the desk really did hold the two she left out", async () => {
    // Without this the fixture above would pass over a desk holding one category, where there is
    // no mistake to catch and nothing for the restatement to expose.
    const { steps } = await askUnderOneCategory(categoriesDesk(), SCRIPTED_ANSWER_WRITTEN);

    expect(steps[0]?.result).toEqual({
      outcome: "rows",
      rows: CATEGORIES.map(({ text }) => ({ text })),
    });
    expect(steps[1]?.result).toEqual({
      outcome: "rows",
      rows: [{ total: NARROW_CATEGORY.amount }],
    });
  });
});

describe("the answer is prose and it is disposable", () => {
  test("a finding that is a list is introduced, never spliced onto the clause above it", () => {
    // Decision 3 asks for bullets where a sentence would be a list, and a comma in front of a
    // bullet is neither. The list is also left to stop itself.
    const listed = questionAnswerSchema.parse({
      looked_at: "Looking at your expenses month by month",
      found: "- July: 120\n- August: 98",
    });

    expect(questionAnswerSentence(listed)).toBe(
      "Looking at your expenses month by month:\n- July: 120\n- August: 98",
    );
  });

  test("and there is nothing on this path to render one as a grid instead", () => {
    // The module renders one string out of two, and holds nothing it could render a grid with.
    const text = readFileSync(join(import.meta.dir, "question-answer.ts"), "utf8");
    for (const surface of ["<table", "<tr", "<th", "<td", "chart", "csv", ".xlsx", "download"]) {
      expect({ surface, present: text.includes(surface) }).toEqual({ surface, present: false });
    }
  });

  test("the same question asked twice reads again and speaks again", async () => {
    const desk = categoriesDesk();
    const first = await askUnderOneCategory(desk, SCRIPTED_ANSWER_WRITTEN);
    const second = await askUnderOneCategory(desk, OUT_OF_ORDER);

    // Nothing is memoized (decision 2): both statements ran twice, and the words were written
    // twice, so correcting her costs a question and never an edit to something kept.
    expect(desk.statements()).toEqual([
      EVERY_CATEGORY,
      ONE_CATEGORY_TOTAL,
      EVERY_CATEGORY,
      ONE_CATEGORY_TOTAL,
    ]);
    expect(first.answerPrompts).toHaveLength(1);
    expect(second.answerPrompts).toHaveLength(1);
    if (first.result.ending !== "answered" || second.result.ending !== "answered") {
      throw new Error("both fixtures answer");
    }
    expect(first.result.answer).toBe(SCRIPTED_ANSWER);
    expect(second.result.answer).toBe(questionAnswerSentence(OUT_OF_ORDER));
  });
});
