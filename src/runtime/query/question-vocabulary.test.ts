// The vocabulary of the data is supplied, not stored (PLAN decisions 18 and 19; ADR-0008).
//
// A claim about a decision rather than about one module, which is why it is here and not in
// `question-turn.test.ts`: the supply is a few lines of that file's prompt builder, and the
// decline it is half of is not in any file at all.
//
// "We built no embedding" stays true right up until somebody adds one as a convenience, so the
// decline is pinned by absence: the desk after a whole vocabulary loop, the modules a record
// write passes through, and the inventory of derived artifacts a capability publishes.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DERIVED_UNIT_FILES } from "../../builder/artifacts/inventory/artifact-provenance.ts";
import { ITEM_RENDERER_UNIT_NAME } from "../../builder/units/generation/units.ts";
import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import {
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  type SpecField,
} from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import {
  answers,
  EXPENSES_TABLE,
  type QuestionDesk,
  questionDesk,
  reads,
  registerCapability,
  scriptedProvider,
} from "./question.test-support.ts";
import { QUESTION_STEP_RESULT_TOO_LARGE } from "./question-payload.ts";
import { QUESTION_VOCABULARY_RULES } from "./question-turn-prompt.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";
import { addedPaths, sweepPlatformStores } from "./store-sweep.test-support.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Everywhere a record write goes: the router that admits and dispatches it, the ports that
 * execute it, and the coordinator that serializes them. Where an embedding computed on save,
 * recomputed on edit and deleted on delete would have to live.
 */
const WRITE_PATH_ROOTS = ["src/runtime/router", "src/runtime/data", "src/runtime/concurrency"];

const GROCERIES = "how much did I spend on groceries?";
const DISTINCT_CATEGORIES = `SELECT DISTINCT category FROM ${EXPENSES_TABLE} ORDER BY category`;

/**
 * What this person calls groceries. Not one of them is the word they will ask with, which is the
 * whole case: the answer is reachable only by looking at what things are called first.
 */
const SPENDING = [
  ["food", 12.5],
  ["cheese", 4],
  ["vegetables", 7.25],
  ["food", 9.75],
] as const;

const GROCERIES_TOTAL = SPENDING.reduce((total, [, amount]) => total + amount, 0);

/**
 * The same column twice over, since a choice field declares its vocabulary and every other field
 * keeps it only in the rows. `cheese` is labelled as it is stored, so the prompt's collapsed
 * spelling is pinned beside two labels that appear in no row at all.
 */
const CHOICE_CATEGORY: SpecField = {
  name: "category",
  label: "Category",
  type: "choice",
  required: true,
  lifecycle: "active",
  values: [
    { value: "food", label: "Food" },
    { value: "cheese", label: "cheese" },
    { value: "vegetables", label: "Greens" },
  ],
  groups: [],
};

const STRING_CATEGORY: SpecField = {
  name: "category",
  label: "Category",
  type: "string",
  required: true,
  lifecycle: "active",
};

function expensesSpec(category: SpecField): CapabilitySpec {
  return validSpec({
    id: "expenses",
    label: "Expenses",
    noun: "expense",
    schema: {
      fields: [
        category,
        { name: "amount", label: "Amount", type: "number", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores what the user spent.",
  });
}

/**
 * One Expenses capability and its rows. The catalog is bespoke rather than `catalogueWithRecords`:
 * the shared fixture saves rows that read "groceries", and the case here is a desk where that word
 * appears nowhere at all.
 */
function desk(category: SpecField, seed?: (database: Database) => void): QuestionDesk {
  return questionDesk(platforms, seed, (database) => {
    const spec = expensesSpec(category);
    registerCapability(database, spec, FIRST_INCARNATION_ID);
    const insert = database.prepare(
      `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, category, amount) VALUES (?, ?, '{}', ?, ?)`,
    );
    for (const [index, [value, amount]] of SPENDING.entries()) {
      insert.run(`expense-${index}`, "2026-07-03 09:00:00", value, amount);
    }
    insert.finalize();
    return [spec];
  });
}

let platforms: ScratchPlatforms;

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("a choice field's vocabulary arrives with the catalog", () => {
  test("the declared values are in the prompt the first step is decided from", async () => {
    const scratch = desk(CHOICE_CATEGORY);
    const { prompts } = await scratch.run(scriptedProvider(answers()), GROCERIES);

    // `Food` and `Greens` are stored in no row, so no statement could have produced them: they
    // reached the prompt off the registry row, and no statement ran at all.
    expect(rowsMatching(scratch, "Food")).toBe(0);
    expect(rowsMatching(scratch, "Greens")).toBe(0);
    expect(prompts[0]).toContain("one of: food (Food); cheese; vegetables (Greens)");
    expect(scratch.executed()).toBe(0);
  });

  test("a disabled option is listed too, because a row may still hold it", async () => {
    const retired: SpecField = {
      ...CHOICE_CATEGORY,
      values: [
        ...(CHOICE_CATEGORY.values ?? []),
        { value: "takeaway", label: "Takeaway", disabled: true },
      ],
    };
    const { prompts } = await desk(retired).run(scriptedProvider(answers()), GROCERIES);

    expect(prompts[0]).toContain("takeaway (Takeaway)");
  });
});

describe("every other field is left to the data to say", () => {
  test("its values are not declared, and the model is told to go and look", async () => {
    const { prompts } = await desk(STRING_CATEGORY).run(scriptedProvider(answers()), GROCERIES);

    for (const [value] of SPENDING) expect(prompts[0]).not.toContain(value);
    for (const rule of QUESTION_VOCABULARY_RULES) expect(prompts[0]).toContain(rule);
  });

  test("looking is an ordinary step that comes back with what things are called", async () => {
    const { result } = await desk(STRING_CATEGORY).run(
      scriptedProvider(reads(DISTINCT_CATEGORIES, [], "naming"), answers()),
      GROCERIES,
    );

    if (result.ending === "budget_spent") throw new Error("the fixture stops after one step");
    expect(result.steps[0]?.call?.label).toBe("naming");
    expect(result.steps[0]?.result).toEqual({
      outcome: "rows",
      rows: [{ category: "cheese" }, { category: "food" }, { category: "vegetables" }],
    });
  });

  test("a field whose values are not small is refused under the same cap as any other step", async () => {
    const scratch = desk(STRING_CATEGORY, (database) => {
      const insert = database.prepare(
        `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, category, amount) VALUES (?, ?, '{}', ?, 1)`,
      );
      for (let index = 0; index < 600; index += 1) {
        insert.run(`bulk-${index}`, "2026-07-05 09:00:00", `category-${index}-`.padEnd(64, "x"));
      }
      insert.finalize();
    });
    const { result } = await scratch.run(
      scriptedProvider(reads(DISTINCT_CATEGORIES, [], "naming"), answers()),
      GROCERIES,
    );

    // Refused, so nothing was read and the question found nothing; the cap is what is on trial.
    if (result.ending === "budget_spent") throw new Error("the fixture stops after one step");
    expect(result.steps[0]?.result).toEqual({
      outcome: "failed",
      message: QUESTION_STEP_RESULT_TOO_LARGE,
    });
  });
});

describe("a question whose words are nowhere in the data", () => {
  test("is answered by looking at what things are called first", async () => {
    const scratch = desk(STRING_CATEGORY);
    expect(rowsMatching(scratch, "grocer")).toBe(0);

    const { result } = await scratch.run(
      scriptedProvider(
        reads(DISTINCT_CATEGORIES, [], "naming"),
        reads(
          `SELECT sum(amount) AS total FROM ${EXPENSES_TABLE} WHERE category IN (?, ?, ?)`,
          ["food", "cheese", "vegetables"],
          "totalling",
        ),
        answers(),
      ),
      GROCERIES,
    );

    if (result.ending !== "answered") throw new Error("unreachable");
    expect(result.steps[1]?.result).toEqual({
      outcome: "rows",
      rows: [{ total: GROCERIES_TOTAL }],
    });
  });
});

describe("nothing is stored to make any of this work", () => {
  test("the desk after a vocabulary loop is the desk before it", async () => {
    const scratch = desk(STRING_CATEGORY);
    const before = sweepPlatformStores(scratch.database.readonly, scratch.path);
    await scratch.run(
      scriptedProvider(reads(DISTINCT_CATEGORIES, [], "naming"), answers()),
      GROCERIES,
    );
    const after = sweepPlatformStores(scratch.database.readonly, scratch.path);

    // Where an embedding column, a vector table or an FTS index would show up, with row counts
    // and content digests beside the schema so a cached row lands too.
    expect(after.stores).toEqual(before.stores);
    // Only what sits beside the desk: the platform's artifact roots are shared with every other
    // shard, and `question-turn.test.ts` already sweeps them around a read.
    expect(addedPaths(before, after).filter((path) => path.startsWith(scratch.path))).toEqual([]);
  });

  test("no module a record write passes through imports a provider", () => {
    const reaching = WRITE_PATH_ROOTS.flatMap((root) =>
      sourceFiles(join(REPO_ROOT, root))
        .filter((path) => specifiersIn(path).some((from) => from.includes("platform/provider")))
        .map((path) => path.slice(REPO_ROOT.length + 1)),
    );

    // An embedding recomputed on every save is an AI call on the write path. This catches the
    // import that would carry one into these roots, not one reached through a module they call.
    expect(reaching).toEqual([]);
  });

  test("the derived artifacts are still the item renderer and one Handler per Action", () => {
    expect(DERIVED_UNIT_FILES as readonly string[]).toEqual([
      `${ITEM_RENDERER_UNIT_NAME}.ts`,
      ...FULL_CAPABILITY_TOOLS.map((tool) => `${tool}.ts`),
    ]);
  });
});

/**
 * How many saved rows carry a word, for a fixture whose whole point is that none do. `instr`
 * rather than `LIKE`, which folds ASCII case and would find `food` under `Food`.
 */
function rowsMatching(scratch: QuestionDesk, text: string): number {
  const row = scratch.database.readonly
    .query(`SELECT count(*) AS matches FROM ${EXPENSES_TABLE} WHERE instr(category, ?) > 0`)
    .get(text) as { matches: number };
  return row.matches;
}

/** Every module under one root, tests and their support excluded: neither ships. */
function sourceFiles(root: string): readonly string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => join(root, String(entry)))
    .filter((path) => path.endsWith(".ts") && !path.includes(".test"));
}

/** What one module names, static and dynamic alike: a lazy `import()` is an import. */
function specifiersIn(path: string): readonly string[] {
  return [...readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}
