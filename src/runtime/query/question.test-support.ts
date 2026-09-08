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
import { QUESTION_STEP_BUDGET, type QuestionLoopResult, runQuestionLoop } from "./question-loop.ts";
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
} from "./question-turn.ts";
import { gatesFor, readerCounts, type ScratchPlatforms } from "./read-scope.test-support.ts";
import {
  type WholeCatalogReadScope,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";

export const NOTES_CAPABILITY = {
  id: "notes",
  incarnationId: FIRST_INCARNATION_ID,
};
export const EXPENSES_CAPABILITY = {
  id: "expenses",
  incarnationId: SECOND_INCARNATION_ID,
};

export const NOTES_TABLE = "cap_notes";
export const EXPENSES_TABLE = "cap_expenses";

function notesSpec(): CapabilitySpec {
  return validSpec({
    id: NOTES_CAPABILITY.id,
    label: "Notes",
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
    label: "Expenses",
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

function register(database: Database, spec: CapabilitySpec, incarnationId: string): void {
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
  register(database, specs[0] as CapabilitySpec, NOTES_CAPABILITY.incarnationId);
  register(database, specs[1] as CapabilitySpec, EXPENSES_CAPABILITY.incarnationId);

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

/** A decision to stop reading. What Aluna then says is 6.4's. */
export function answers(): QuestionDecision {
  return { next: "answer", read: null };
}

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
    generate<T>(): GenerateResult<T> {
      const value = values[Math.min(next, values.length - 1)];
      next += 1;
      return {
        partialStream: (async function* () {
          yield value as DeepPartial<T>;
        })(),
        object: Promise.resolve(value as T),
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      };
    },
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
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      };
    },
  };
}

export interface ScriptedProvider extends Provider {
  /** Every prompt the turn built, in order. */
  readonly prompts: string[];
}

/**
 * A provider answering each `generate` with the next scripted decision, validated through the real
 * spine's schema. A script that runs out repeats its last, which never converges.
 */
export function scriptedProvider(...decisions: readonly QuestionDecision[]): ScriptedProvider {
  const prompts: string[] = [];
  let next = 0;

  return {
    prompts,
    generate<T>(prompt: string, schema: Parameters<Provider["generate"]>[1]): GenerateResult<T> {
      prompts.push(prompt);
      const scripted = decisions[Math.min(next, decisions.length - 1)];
      next += 1;
      const object = (async () => (schema as { parse(value: unknown): T }).parse(scripted))();
      // A rejected object with nothing awaiting it yet is an unhandled rejection, and the
      // turn awaits it one microtask later.
      object.catch(() => {});
      return {
        partialStream: (async function* () {
          yield scripted as DeepPartial<T>;
        })(),
        object,
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
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
}

export interface QuestionDesk {
  readonly database: PlatformDatabase;
  readonly readerCounts: () => readonly number[];
  /** Statements that actually reached the worker, which is not the same as steps recorded. */
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
 * run in one scope. `seed` is called with the read-write connection before the first read.
 */
export function questionDesk(
  platforms: ScratchPlatforms,
  seed?: (database: Database) => void,
): QuestionDesk {
  const platform = platforms.migrated();
  catalogueWithRecords(platform.database.readwrite);
  seed?.(platform.database.readwrite);
  const readGates = gatesFor(platform.database);
  let executed = 0;
  const scopeDeps = {
    readGates,
    database: platform.database.readonly,
    createWorker: () => {
      const worker = createQueryWorker(platform.path);
      return {
        ...worker,
        read: (sql: string, parameters?: readonly QueryWorkerValue[]) => {
          executed += 1;
          return worker.read(sql, parameters);
        },
      };
    },
  };

  return {
    database: platform.database,
    readerCounts: () => readerCounts(readGates),
    executed: () => executed,
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
      return { result, steps, prompts: provider.prompts };
    },
  };
}
