// Where the subject would live is the loop's first step (PLAN decision 30; ADR-0008).
//
// A claim about a decision rather than about one module, which is why it is here: half of it is a
// headed block of `question-turn.ts`'s prompt, the other half two checks in `question-no-home.ts`,
// and what the decision promises is only visible through a whole loop. The promise is that
// 6.4/05's gap is earned — a model that shrugs at an unfamiliar word would be wrong most of the
// time, because the thing asked about is so often a value inside a collection.
//
// What the platform can carry alone is a name. *Vegetables* filed under *Greens* is caught here;
// *groceries* filed under *food* is not, and never will be without the looking. That half is
// 6.4/01's vocabulary step, exercised by `question-vocabulary.test.ts`.
//
// No classifier and no second resolver pass is the other claim, pinned by counting generations.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { CapabilitySpec, SpecField } from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import {
  A_QUESTION_WITH_NO_HOME,
  answers,
  EXPENSES_CAPABILITY,
  EXPENSES_TABLE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  noHome,
  notesSpec,
  type QuestionDesk,
  questionDesk,
  reads,
  registerCapability,
  SCRIPTED_ANSWER,
  SCRIPTED_SUBJECT,
  scriptedProvider,
  scriptedProviderNaming,
} from "./question.test-support.ts";
import { QUESTION_NO_HOME_FOR_THAT, questionNoHomeSentence } from "./question-narration.ts";
import {
  QUESTION_COLLECTIONS_HEADING,
  QUESTION_WHERE_IT_LIVES_HEADING,
  QUESTION_WHERE_IT_LIVES_RULES,
} from "./question-turn-prompt.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

/** What this person calls what they spent it on. None of them is a collection, which is the case
 * decision 30 exists for: *vegetables* is a value in a column, filed under the label *Greens*. */
const CATEGORY: SpecField = {
  name: "category",
  label: "Category",
  type: "choice",
  required: true,
  lifecycle: "active",
  values: [
    { value: "food", label: "Food" },
    { value: "vegetables", label: "Greens" },
  ],
  groups: [],
};

const SPENDING = [
  ["food", 12.5],
  ["vegetables", 7.25],
] as const;

/** A question whose words name nothing of their own, which is what the window standing open is
 * there to resolve (decision 28). */
const THE_ONES_I_ADDED = "how many did I add this month?";

function expensesWithCategories(): CapabilitySpec {
  return validSpec({
    id: EXPENSES_CAPABILITY.id,
    label: EXPENSES_CAPABILITY.label,
    noun: "expense",
    plural_noun: "expenses",
    schema: {
      fields: [
        CATEGORY,
        { name: "amount", label: "Amount", type: "number", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores what the user spent.",
  });
}

let platforms: ScratchPlatforms;

/**
 * The living demo's desk. Expenses is bespoke because the shared fixture declares no choice field
 * and this decision is about a column's own values; Notes is the shared spec. Both hold rows,
 * because a question that matched none would end in `questionFoundNothing`'s weaker sentence
 * before the gap was ever weighed.
 */
function desk(): QuestionDesk {
  return questionDesk(platforms, undefined, (database: Database) => {
    const specs = [notesSpec(), expensesWithCategories()];
    registerCapability(database, specs[0] as CapabilitySpec, NOTES_CAPABILITY.incarnationId);
    registerCapability(database, specs[1] as CapabilitySpec, EXPENSES_CAPABILITY.incarnationId);

    const note = database.prepare(
      `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, ?, '{}', ?)`,
    );
    note.run("note-1", "2026-07-01 09:00:00", "a thought");
    note.finalize();

    const expense = database.prepare(
      `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, category, amount) VALUES (?, ?, '{}', ?, ?)`,
    );
    for (const [index, [category, amount]] of SPENDING.entries()) {
      expense.run(`expense-${index}`, "2026-07-03 09:00:00", category, amount);
    }
    expense.finalize();

    return specs;
  });
}

/** One read that opens a collection and matches rows, which is what the turn asks for before it
 * will hear a gap at all. */
function looksAtNotes() {
  return reads(`SELECT text FROM ${NOTES_TABLE}`, [], "naming");
}

function looksAtCategories() {
  return reads(`SELECT DISTINCT category FROM ${EXPENSES_TABLE}`, [], "naming");
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("the first step is where this would live", () => {
  test("every turn asks for it, immediately above the collections it names", async () => {
    const { prompts } = await desk().run(scriptedProvider(answers()), A_QUESTION_WITH_NO_HOME);
    const prompt = prompts[0] ?? "";

    // Adjacency, not order: the block and the catalog it sends her to weigh arrive together, so
    // nothing can drift between the instruction and the list it is about.
    expect(prompt).toContain(
      [
        QUESTION_WHERE_IT_LIVES_HEADING,
        ...QUESTION_WHERE_IT_LIVES_RULES,
        "",
        QUESTION_COLLECTIONS_HEADING,
      ].join("\n"),
    );
    for (const { label } of [NOTES_CAPABILITY, EXPENSES_CAPABILITY])
      expect(prompt).toContain(label);
  });

  test("and costs no classifier and no second pass of anything", async () => {
    // A negative claim, so this passes before the change as well as after: what it guards is a
    // later generation being added here. One per turn, one for what she says, and no more.
    const scratch = desk();
    const run = await scratch.run(
      scriptedProvider(looksAtCategories(), answers()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.prompts).toHaveLength(2);
    expect(run.answerPrompts).toHaveLength(1);
    expect(run.subjectPrompts).toHaveLength(0);
    expect(scratch.executed()).toBe(1);
  });
});

describe("a value inside a collection is found there, never reported as a gap", () => {
  test("a subject that is one of a column's own values is held by that column", async () => {
    // *Greens* is what this person calls them, so nothing but the declared value catches this.
    const run = await desk().run(
      scriptedProviderNaming("vegetables", looksAtCategories(), noHome()),
      "how much did I spend on vegetables?",
    );

    expect(run.result).toMatchObject({ ending: "answered", answer: SCRIPTED_ANSWER });
    // She looked and she named, and the naming came back to a desk that had it after all.
    expect(run.subjectPrompts).toHaveLength(1);
  });

  test("and a subject that is a column rather than a value in one", async () => {
    const run = await desk().run(
      scriptedProviderNaming("category", looksAtCategories(), noHome()),
      "which category did I spend the most on?",
    );

    expect(run.result).toMatchObject({ ending: "answered" });
  });
});

describe("a question the open window could answer is answered from it", () => {
  test("words naming nothing of their own are about the collection standing there", async () => {
    // The naming call comes back with something they never wrote, which is all it can do for a
    // question like this one: there is no subject in it to copy. The window is the home.
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      THE_ONES_I_ADDED,
      undefined,
      NOTES_CAPABILITY.id,
    );

    expect(run.result).toMatchObject({ ending: "answered", answer: SCRIPTED_ANSWER });
  });

  test("while the same question asked in front of nothing keeps the unnamed gap", async () => {
    // The control the test above needs rather than a pin of its own: both ran the same script and
    // the same words, and the window standing open is the whole of what differed.
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      THE_ONES_I_ADDED,
    );

    expect(run.result).toMatchObject({ ending: "no_home", answer: QUESTION_NO_HOME_FOR_THAT });
  });
});

describe("the gap is what is left when neither check can hold it", () => {
  test("it is named, and only after a statement of hers opened a collection", async () => {
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.result).toMatchObject({
      ending: "no_home",
      answer: questionNoHomeSentence(SCRIPTED_SUBJECT),
    });
    // The ordering decision 30 is about: the looking happened, and the naming came after it.
    expect(run.steps.map((step) => step.collections)).toEqual([[NOTES_CAPABILITY.label]]);
    expect(run.subjectPrompts).toHaveLength(1);
  });
});
