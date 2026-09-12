// The material an answer is written from, and what the platform does to the words that come back.
//
// She used to say what she looked at before what she found: two fields the platform joined, which
// made every answer one shape. The owner rejected that shape, so the answer is one field of hers
// and the restatement is gone (2026-09-11, amending ADR-0008 rule 1). What the collections and the
// bound values are for now is the sentence itself — *7 coffees from Colombia* needs the value she
// searched on — so these fixtures still hold what reaches the prompt, and nothing else does.
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
  MOST_ANSWER_CHARACTERS,
  QUESTION_ANSWER_RULES,
  questionAnswerSchema,
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

/** A second answer, in words the first one could not be mistaken for. Put through the schema, so
 * what the fixture holds is what a generation of those words would be. */
const SAID_AGAIN = questionAnswerSchema.parse({ answer: "I looked again, and it says the same." });

/** The characters a fixture cannot carry as itself: written by code, so this file holds none. */
const character = (code: number) => String.fromCharCode(code);
const NUL = character(0);
const BELL = character(7);
const BREAK = character(10);
const CARRIAGE_RETURN = character(13);
const ESCAPE = character(27);
const ZERO_WIDTH = character(0x200b);
const LINE_SEPARATOR = character(0x2028);
const EM_DASH = character(0x2014);

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
function askUnderOneCategory(desk: QuestionDesk, said: { answer: string }) {
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

    // There would be no name of theirs in front of her at all. 6.4/04
    // closes it: a row nothing was scanned into matched nothing, so no generation runs at all
    // and the rule below is what holds a question that read something else as well.
    expect(answerPrompts).toEqual([]);
    expect(result.ending).toBe("nothing_found");
    expect(QUESTION_ANSWER_RULES.join("\n")).toContain(
      "The only names of theirs you may use are the ones listed with each result below.",
    );
  });
});

describe("what she says is one thing she says, and it is hers", () => {
  test("the words reach a person exactly as they were written", async () => {
    // Nothing is joined, spliced or cased on the way out any more. A second field was the order,
    // and it was also the shape every answer arrived in; the prompt asks for the order instead.
    const { result } = await askUnderOneCategory(categoriesDesk(), SAID_AGAIN);

    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(result.answer).toBe(SAID_AGAIN.answer);
  });

  test("and she is told not to narrate the looking, which is what the two fields made her do", () => {
    // The owner's decision, and the only place it is written down in the code that runs.
    expect(QUESTION_ANSWER_RULES.join("\n")).toContain("it is you narrating yourself");
  });

  test("and she is asked for the subject where the question left it out", () => {
    // Decision 29 after the reversal: the scope rides as the ordinary noun, never as a clause in
    // front. What was withdrawn is the preamble; *six of your recipes* was always the good shape,
    // and the example above it in the rules has been that shape since before the reversal.
    expect(QUESTION_ANSWER_RULES.join("\n")).toContain("never says what it is about");
  });

  test("the one field is asked for in the shape a strict provider accepts", () => {
    // `question-tool.ts` says why an absent key is not an option under OpenAI's strict mode.
    const emitted = zodSchema(questionAnswerSchema).jsonSchema as Record<string, unknown>;

    expect(emitted.required).toEqual(["answer"]);
    expect(emitted.additionalProperties).toBe(false);
    for (const keyword of ["oneOf", "minLength", "maxLength", "pattern", "format", "default"]) {
      expect({ keyword, present: JSON.stringify(emitted).includes(keyword) }).toEqual({
        keyword,
        present: false,
      });
    }
  });

  test("the two halves it used to take are not an answer, and neither is neither", () => {
    const said = SCRIPTED_ANSWER_WRITTEN.answer;

    expect(questionAnswerSchema.safeParse({ looked_at: "Looking at your expenses" }).success).toBe(
      false,
    );
    // Including the shape the answer used to have: a strict object refuses the extra key rather
    // than quietly speaking half of it.
    expect(questionAnswerSchema.safeParse({ answer: said, found: "six" }).success).toBe(false);
    expect(questionAnswerSchema.safeParse({}).success).toBe(false);
  });

  test("an answer that did not stop itself is stopped, and one that did is left alone", () => {
    const finish = (answer: string) => questionAnswerSchema.parse({ answer }).answer;

    expect(finish("Six are finished")).toBe("Six are finished.");
    for (const ended of ["You have 22.", "Was it?", "None at all!"]) {
      expect(finish(ended)).toBe(ended);
    }
  });

  test("a blank answer is not one, while an answer with room round it is trimmed", () => {
    const said = SCRIPTED_ANSWER_WRITTEN.answer;

    for (const blank of ["", "   ", "\n\t "]) {
      expect(questionAnswerSchema.safeParse({ answer: blank }).success).toBe(false);
    }
    expect(questionAnswerSchema.parse({ answer: `\n  ${said}  ` }).answer).toBe(said);
  });

  test("punctuation that joins is not doubled up, at either end of what she wrote", () => {
    // Nothing strips these on the way in any more: the two halves each had their own transform,
    // and the join between them was where a stray comma used to go.
    const said = (answer: string) => questionAnswerSchema.parse({ answer }).answer;

    for (const trailing of [",", ";", " -", ` ${EM_DASH}`]) {
      expect(said(`you spent 84.20${trailing}`)).toBe("you spent 84.20.");
    }
    expect(said(", you spent 84.20")).toBe("you spent 84.20.");
  });

  test("a list of one item is a list, and keeps its own shape", () => {
    expect(questionAnswerSchema.parse({ answer: `${BREAK}- July: 120` }).answer).toBe(
      "- July: 120",
    );
  });

  test("every way of breaking a line becomes the one the desk renders", () => {
    // `pre-wrap` breaks on all four, and the stream splits its frames on the first three, so a
    // line count taken here is the line count a person sees.
    for (const between of [CARRIAGE_RETURN, CARRIAGE_RETURN + BREAK, LINE_SEPARATOR]) {
      expect(
        questionAnswerSchema.parse({ answer: `July was quiet${between}August was not` }).answer,
      ).toBe(`July was quiet${BREAK}August was not.`);
    }
  });

  test("characters with no shape never reach the desk", () => {
    // They survive `escapeHtml` untouched and land in `textContent` unseen.
    const hidden = `${NUL}${BELL}${ESCAPE}[31m${ZERO_WIDTH}four are from Japan`;

    expect(questionAnswerSchema.parse({ answer: hidden }).answer).toBe("[31mfour are from Japan.");
  });

  test("an answer longer than she would ever say is a generation that failed", () => {
    // The one bound on what comes back: the payload budget weighs what goes into a prompt.
    const said = "x".repeat(MOST_ANSWER_CHARACTERS);

    expect(questionAnswerSchema.safeParse({ answer: said }).success).toBe(true);
    expect(questionAnswerSchema.safeParse({ answer: `${said}x` }).success).toBe(false);
  });

  test("an answer of nothing but punctuation says nothing, so it is not one", () => {
    for (const empty of [".", " — ", "…", "-"]) {
      expect(questionAnswerSchema.safeParse({ answer: empty }).success).toBe(false);
    }
  });
});

describe("the answer is prose and it is disposable", () => {
  test("a list she wrote reaches a person as the list she wrote", () => {
    // Decision 3 asks for bullets where a sentence would be a list. Nothing reshapes one now:
    // it runs over lines, so it stops itself and no full stop is put on the last item.
    const listed = "Month by month:\n- July: 120\n- August: 98";

    expect(questionAnswerSchema.parse({ answer: listed }).answer).toBe(listed);
  });

  test("and there is nothing on this path to render one as a grid instead", () => {
    // The module hands over one string and holds nothing it could render a grid with.
    const text = readFileSync(join(import.meta.dir, "question-answer.ts"), "utf8");
    for (const surface of ["<table", "<tr", "<th", "<td", "chart", "csv", ".xlsx", "download"]) {
      expect({ surface, present: text.includes(surface) }).toEqual({ surface, present: false });
    }
  });

  test("the same question asked twice reads again and speaks again", async () => {
    const desk = categoriesDesk();
    const first = await askUnderOneCategory(desk, SCRIPTED_ANSWER_WRITTEN);
    const second = await askUnderOneCategory(desk, SAID_AGAIN);

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
    expect(second.result.answer).toBe(SAID_AGAIN.answer);
  });
});
