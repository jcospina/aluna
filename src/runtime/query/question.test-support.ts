// The two things every question suite needs and neither should invent twice: a desk with
// real capability tables holding real rows, and a provider that answers with the decisions
// the test chose.
//
// The tables are physical on purpose. A question's whole claim is that a statement runs in
// the read-only worker against the one documented database file, and a fake worker over a
// fixed row set can prove none of it — not that a write fails at the SQLite seam, not that
// an unknown column comes back as words the model can read, and not that a bound parameter
// is bound rather than pasted. This module is not run as a test by bun.

import type { Database } from "bun:sqlite";

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../platform/provider/index.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../registry/incarnations.test-support.ts";
import {
  type CapabilitySpec,
  capabilitySpecFromRow,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import { insertCapability } from "../../registry/store/store.ts";
import { applyCapabilityTableDdl } from "../data/index.ts";
import { createQueryWorker, type QueryWorkerValue } from "./query-worker.ts";
import {
  QUESTION_ANSWER_PROMPT_PREFIX,
  type QuestionAnswerWritten,
  questionAnswerSchema,
} from "./question-answer.ts";
import { QUESTION_STEP_BUDGET, type QuestionLoopResult, runQuestionLoop } from "./question-loop.ts";
import { QUESTION_NO_HOME_PROMPT_PREFIX } from "./question-no-home.ts";
import { NO_PLAN } from "./question-nothing-found.ts";
import {
  QUESTION_STEP_FALLBACK_LABEL,
  type QuestionDecision,
  type QuestionStepLabel,
  type QuestionToolCall,
  READ_ONLY_QUERY_TOOL,
} from "./question-tool.ts";
import {
  buildQuestionTurnPrompt,
  type QuestionStep,
  type QuestionTurnDeps,
  type QuestionTurnInput,
  runQuestionTurn,
  UNREADABLE_DECISION,
} from "./question-turn.ts";
import { gatesFor, readerCounts, type ScratchPlatforms } from "./read-scope.test-support.ts";
import {
  type WholeCatalogReadScope,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";

/** The label is here rather than in the spec below because a suite about what Aluna calls a
 * collection reads it, and a second copy would let the two drift. */
export const NOTES_CAPABILITY = {
  id: "notes",
  incarnationId: FIRST_INCARNATION_ID,
  label: "Notes",
};
export const EXPENSES_CAPABILITY = {
  id: "expenses",
  incarnationId: SECOND_INCARNATION_ID,
  label: "Expenses",
};

export const NOTES_TABLE = "cap_notes";
export const EXPENSES_TABLE = "cap_expenses";

function notesSpec(): CapabilitySpec {
  return validSpec({
    id: NOTES_CAPABILITY.id,
    label: NOTES_CAPABILITY.label,
    noun: "note",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores the user's text notes.",
  });
}

function expensesSpec(): CapabilitySpec {
  return validSpec({
    id: EXPENSES_CAPABILITY.id,
    label: EXPENSES_CAPABILITY.label,
    noun: "expense",
    schema: {
      fields: [
        { name: "text", label: "What", type: "string", required: true, lifecycle: "active" },
        { name: "amount", label: "Amount", type: "number", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores what the user spent.",
  });
}

/** One capability, registered and given its table — the whole of it, unlike
 * `read-scope.test-support.ts`'s `addCapability`, which stands up a registry row and no table. */
export function registerCapability(
  database: Database,
  spec: CapabilitySpec,
  incarnationId: string,
): void {
  insertCapability(
    {
      ...spec,
      incarnation_id: incarnationId,
      version: 1,
      artifacts_path: `capabilities/${spec.id}/${incarnationId}/v1/`,
      seed: 184206,
    },
    database,
  );
  applyCapabilityTableDdl(spec, database);
}

/**
 * Two registered capabilities with their tables and a few rows each: three notes, and two expenses
 * whose `text` matches one of the notes, so a statement joining the collections finds something.
 */
export function catalogueWithRecords(database: Database): readonly CapabilitySpec[] {
  const specs = [notesSpec(), expensesSpec()];
  registerCapability(database, specs[0] as CapabilitySpec, NOTES_CAPABILITY.incarnationId);
  registerCapability(database, specs[1] as CapabilitySpec, EXPENSES_CAPABILITY.incarnationId);

  const note = database.prepare(
    `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, ?, '{}', ?)`,
  );
  note.run("note-1", "2026-07-01 09:00:00", "groceries");
  note.run("note-2", "2026-07-02 09:00:00", "rent");
  note.run("note-3", "2026-08-01 09:00:00", "groceries");
  note.finalize();

  const expense = database.prepare(
    `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, text, amount) VALUES (?, ?, '{}', ?, ?)`,
  );
  expense.run("expense-1", "2026-07-03 09:00:00", "groceries", 12.5);
  expense.run("expense-2", "2026-07-04 09:00:00", "rent", 900);
  expense.finalize();

  return specs;
}

/** The specs the registry holds, in the order `readActiveRegistryCatalog` returns them. */
export function registeredSpecs(database: Database): readonly CapabilitySpec[] {
  return readActiveRegistryCatalog(database).capabilities.map(capabilitySpecFromRow);
}

/**
 * A decision to run one statement. The label defaults to decision 14's generic member, because
 * most suites here are about what a statement does rather than what Aluna says while it runs.
 */
export function reads(
  sql: string,
  parameters: QuestionToolCall["parameters"] = [],
  label: QuestionStepLabel = QUESTION_STEP_FALLBACK_LABEL,
): QuestionDecision {
  return { next: "read", read: { tool: READ_ONLY_QUERY_TOOL, sql, parameters, label } };
}

/** A decision to stop reading. The answer step then writes what she says, out of the steps. */
export function answers(): QuestionDecision {
  return { next: "answer", read: null };
}

/** A decision that this desk holds nowhere for what was asked about (6.4/05). The turn refuses
 * it until a statement has opened a collection, so most suites script a read in front of it. */
export function noHome(): QuestionDecision {
  return { next: "no_home", read: null };
}

/**
 * The step a decision the turn will not take becomes: no call, no plan read off one, and the
 * turn's own words back to the model. Here because four suites assert one, and a fourth copy of
 * a shape is a fourth thing to keep in step with the turn.
 */
export function toldAgainStep(message: string): QuestionStep {
  return Object.freeze({
    call: null,
    collections: [],
    plan: NO_PLAN,
    result: { outcome: "failed", message } as const,
  });
}

export const UNREADABLE_STEP: QuestionStep = toldAgainStep(UNREADABLE_DECISION);

/**
 * What a fake provider says when the loop asks for the answer. Put through the real schema, so a
 * fixture that stopped being an answer fails here rather than in whichever suite happened to read
 * it — and it names where she looked, which is what the prompt asks a real one for.
 */
export const SCRIPTED_ANSWER_WRITTEN: QuestionAnswerWritten = questionAnswerSchema.parse({
  answer: "I had a look through what you have saved, and here is what I found.",
});

/** The one sentence that fixture is, which is the whole of what she says. */
export const SCRIPTED_ANSWER = SCRIPTED_ANSWER_WRITTEN.answer;

/** What a fake provider names when the loop asks what there is nowhere for. Words the default
 * question does not hold, so a suite naming it has to choose a question that does. */
export const SCRIPTED_SUBJECT = "hiking trips";

/**
 * One turn that ran a statement, for a suite that scripts only `read` decisions: a turn coming
 * back as an answer there is the fixture having drifted rather than a case to handle.
 */
export async function oneTurn(
  deps: QuestionTurnDeps,
  input: Omit<QuestionTurnInput, "budget" | "steps"> & {
    /** Defaulted here and required on the real input: a question is bounded by its steps. */
    readonly steps?: readonly QuestionStep[];
  },
): Promise<QuestionStep> {
  const turn = await runQuestionTurn(deps, {
    ...input,
    steps: input.steps ?? [],
    budget: QUESTION_STEP_BUDGET,
  });
  if (turn.kind !== "step") throw new Error("the scripted decision was a read; the turn was not");
  return turn.step;
}

/** The prompt the next turn of a question would be built from, at a fresh budget. */
export function nextPrompt(
  question: string,
  specs: readonly CapabilitySpec[],
  steps: readonly QuestionStep[],
): string {
  return buildQuestionTurnPrompt({ question, specs, steps, budget: QUESTION_STEP_BUDGET });
}

/**
 * A provider that resolves `object` to whatever the test chose, in order, *without* parsing it —
 * the only way to exercise the turn's own re-validation. The last value repeats once exhausted.
 */
export function providerResolving(...values: readonly unknown[]): Provider {
  let next = 0;
  return {
    generate<T>(prompt: string): GenerateResult<T> {
      // The answer is a second generation against a schema of its own, and a suite about a rogue
      // *decision* is not about a rogue answer. It gets the ordinary one.
      if (prompt.startsWith(QUESTION_ANSWER_PROMPT_PREFIX))
        return resolving(SCRIPTED_ANSWER_WRITTEN);
      if (prompt.startsWith(QUESTION_NO_HOME_PROMPT_PREFIX))
        return resolving({ subject: SCRIPTED_SUBJECT });
      const value = values[Math.min(next, values.length - 1)];
      next += 1;
      return resolving(value);
    },
  };
}

/** No usage figures: nothing on this path reads them, and a number here would be invented. */
export const NO_USAGE = Object.freeze({
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
});

/** A generation that resolves to exactly this value, without validating it against the schema. */
function resolving<T>(value: unknown): GenerateResult<T> {
  return {
    partialStream: (async function* () {
      yield value as DeepPartial<T>;
    })(),
    object: Promise.resolve(value as T),
    usage: Promise.resolve(NO_USAGE),
  };
}

/** A provider whose generation faults, the way a connection that is not there does. */
export function providerFaulting(error: Error): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      const object = Promise.reject(error) as Promise<T>;
      object.catch(() => {});
      return {
        partialStream: (async function* () {})(),
        object,
        usage: Promise.resolve(NO_USAGE),
      };
    },
  };
}

export interface ScriptedProvider extends Provider {
  /** Every prompt a *turn* built, in order. The other two are kept apart: neither is a decision,
   * and every suite counting turns was written before there was a second kind of prompt. */
  readonly prompts: string[];
  readonly answerPrompts: string[];
  /** Every prompt the gap's own call built (6.4/05), which carries no rows and no collections. */
  readonly subjectPrompts: string[];
}

/**
 * A provider answering each `generate` with the next scripted decision, validated through the real
 * spine's schema. A script that runs out repeats its last, which never converges.
 */
export function scriptedProvider(...decisions: readonly QuestionDecision[]): ScriptedProvider {
  return scriptedProviderSpeaking({}, ...decisions);
}

/**
 * The same, with what she says at the end chosen too — for a suite about her words rather than
 * about what she read.
 */
export function scriptedProviderSaying(
  written: QuestionAnswerWritten,
  ...decisions: readonly QuestionDecision[]
): ScriptedProvider {
  return scriptedProviderSpeaking({ written }, ...decisions);
}

/** The same, with the subject the gap's call comes back with chosen — for a suite about the one
 * ending whose sentence is written around words this person wrote. */
export function scriptedProviderNaming(
  subject: string,
  ...decisions: readonly QuestionDecision[]
): ScriptedProvider {
  return scriptedProviderSpeaking({ subject }, ...decisions);
}

/** What this provider says when the loop stops reading, whichever way it stops. */
interface ScriptedSpeech {
  readonly written?: QuestionAnswerWritten;
  readonly subject?: string;
}

function scriptedProviderSpeaking(
  spoken: ScriptedSpeech,
  ...decisions: readonly QuestionDecision[]
): ScriptedProvider {
  const prompts: string[] = [];
  const answerPrompts: string[] = [];
  const subjectPrompts: string[] = [];
  let next = 0;

  /** Which of the three calls this prompt is, where it is kept, and what is said back to it. */
  const staged = (prompt: string): { kept: string[]; scripted: unknown } => {
    if (prompt.startsWith(QUESTION_ANSWER_PROMPT_PREFIX)) {
      return { kept: answerPrompts, scripted: spoken.written ?? SCRIPTED_ANSWER_WRITTEN };
    }
    if (prompt.startsWith(QUESTION_NO_HOME_PROMPT_PREFIX)) {
      return { kept: subjectPrompts, scripted: { subject: spoken.subject ?? SCRIPTED_SUBJECT } };
    }
    const decided = decisions[Math.min(next, decisions.length - 1)];
    next += 1;
    return { kept: prompts, scripted: decided };
  };

  return {
    prompts,
    answerPrompts,
    subjectPrompts,
    generate<T>(prompt: string, schema: Parameters<Provider["generate"]>[1]): GenerateResult<T> {
      const { kept, scripted } = staged(prompt);
      kept.push(prompt);
      const object = (async () => (schema as { parse(value: unknown): T }).parse(scripted))();
      // A rejected object with nothing awaiting it yet is an unhandled rejection, and the
      // turn awaits it one microtask later.
      object.catch(() => {});
      return {
        partialStream: (async function* () {
          yield scripted as DeepPartial<T>;
        })(),
        object,
        usage: Promise.resolve(NO_USAGE),
      };
    },
  };
}

/**
 * More notes than `catalogueWithRecords` writes, so a suite can ask for a payload of a chosen
 * size. Written straight to the table: only their size in a prompt matters.
 */
export function addNotes(database: Database, count: number, text: string, prefix = "bulk"): void {
  const insert = database.prepare(
    `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, ?, '{}', ?)`,
  );
  for (let index = 0; index < count; index += 1) {
    insert.run(`${prefix}-${String(index).padStart(5, "0")}`, "2026-07-05 09:00:00", text);
  }
  insert.finalize();
}

export interface LoopRun {
  readonly result: QuestionLoopResult;
  /** Every step, watched through `onStep` — the only way a caller sees a spent budget's. */
  readonly steps: readonly QuestionStep[];
  readonly prompts: readonly string[];
  /** The one prompt the answer was written from, or none when the budget ran out first. */
  readonly answerPrompts: readonly string[];
  /** The one prompt the gap's subject was named from, or none for every other ending. */
  readonly subjectPrompts: readonly string[];
}

export interface QuestionDesk {
  readonly path: string;
  readonly database: PlatformDatabase;
  readonly readerCounts: () => readonly number[];
  /** Statements that actually reached the worker, which is not the same as steps recorded. */
  readonly statements: () => readonly string[];
  /** How many of them, which is what most suites here are asking. */
  readonly executed: () => number;
  run(
    provider: ScriptedProvider,
    question?: string,
    onStep?: (step: QuestionStep) => void,
  ): Promise<LoopRun>;
  inScope<T>(body: (scope: WholeCatalogReadScope) => Promise<T>): Promise<T>;
}

/**
 * A migrated throwaway desk holding Notes and Expenses, with the real worker wired in and the loop
 * run in one scope. `seed` is called with the read-write connection before the first read, and
 * `catalogue` replaces the two capabilities outright for a suite that needs a different desk.
 */
export function questionDesk(
  platforms: ScratchPlatforms,
  seed?: (database: Database) => void,
  catalogue: (database: Database) => readonly CapabilitySpec[] = catalogueWithRecords,
): QuestionDesk {
  const platform = platforms.migrated();
  catalogue(platform.database.readwrite);
  seed?.(platform.database.readwrite);
  const readGates = gatesFor(platform.database);
  const statements: string[] = [];
  const scopeDeps = {
    readGates,
    database: platform.database.readonly,
    createWorker: () => {
      const worker = createQueryWorker(platform.path);
      return {
        ...worker,
        read: (sql: string, parameters?: readonly QueryWorkerValue[]) => {
          statements.push(sql);
          return worker.read(sql, parameters);
        },
      };
    },
  };

  return {
    path: platform.path,
    database: platform.database,
    readerCounts: () => readerCounts(readGates),
    statements: () => statements,
    executed: () => statements.length,
    inScope: (body) => withWholeCatalogReadScope(scopeDeps, body),
    async run(provider, question = "how much did I spend on groceries?", onStep) {
      const steps: QuestionStep[] = [];
      const result = await withWholeCatalogReadScope(scopeDeps, (scope) =>
        runQuestionLoop(
          { provider, scope, database: platform.database.readonly },
          {
            question,
            onStep: (step) => {
              steps.push(step);
              onStep?.(step);
            },
          },
        ),
      );
      return {
        result,
        steps,
        prompts: provider.prompts,
        answerPrompts: provider.answerPrompts,
        subjectPrompts: provider.subjectPrompts,
      };
    },
  };
}
