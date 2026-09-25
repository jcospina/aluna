// One turn: the model decides, and a read runs in the worker and comes back to it (PLAN decisions
// 5, 8, 9, 18; ADR-0008). `question-loop.ts` repeats it and holds the budget — a turn is told how
// many reads are left and enforces nothing. A failed statement is a turn, not an ending; only a
// cancellation and a closed worker end the question, since neither leaves anybody to answer.
//
// A turn creates nothing (decision 2); its statement compiles three times: shape, `EXPLAIN`, run.
// It also refuses 6.4/05's ending until she has opened a collection: a gap is earned by looking.
//
// What the prompt says and what a step costs the next one are `question-turn-prompt.ts`; the
// shapes both sides pass around are `question-step.ts`.

import { assertNever } from "../../platform/errors.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import type { CapabilitySpec } from "../../registry/index.ts";
import type { QueryWorkerRow } from "./query-worker.ts";
import {
  type QuestionLedger,
  readQuestionLedger,
  scrubQuestionRows,
  scrubQuestionText,
  scrubQuestionValues,
} from "./question-file-scrub.ts";
import { questionOpenedACollection } from "./question-nothing-found.ts";
import {
  QUESTION_STATEMENT_TOO_LARGE,
  QUESTION_STEP_RESULT_TOO_LARGE,
  questionPayloadBytes,
  questionPayloadRefusal,
  questionRowsTooLargeToScrub,
  questionStatementRefusal,
} from "./question-payload.ts";
import { questionStatementFault } from "./question-statement-fault.ts";
import {
  NO_STATEMENT_FACTS,
  type QuestionStep,
  type QuestionTurn,
  type StatementFacts,
} from "./question-step.ts";
import {
  QUESTION_STEP_LABELS,
  type QuestionDecision,
  type QuestionToolCall,
  questionDecisionSchema,
} from "./question-tool.ts";
import {
  buildQuestionTurnPrompt,
  questionPayloadSpent,
  questionStepBytes,
} from "./question-turn-prompt.ts";
import { assertWholeCatalogQuery, scopedCapabilitySpecs } from "./whole-catalog-query-scope.ts";
import type { WholeCatalogReadScope } from "./whole-catalog-read-scope.ts";

export interface QuestionTurnDeps {
  readonly provider: Provider;
  /** The question's ownership and its one read entry point (6.2/02). */
  readonly scope: WholeCatalogReadScope;
  /**
   * Where the table bound's `EXPLAIN` is prepared. The main thread's read-only connection,
   * and never the worker's: the worker is handed statements, not authority (decision 11).
   */
  readonly database: PlatformDatabase["readonly"];
}

export interface QuestionTurnInput {
  /** What the user asked, in their own words. */
  readonly question: string;
  /**
   * Every step this question has already taken, oldest first. Required rather than optional: the
   * payload budget is measured from these, and an optional field is a bound a caller can drop.
   */
  readonly steps: readonly QuestionStep[];
  /**
   * How many reads this question gets in total (decision 8). Supplied by the caller because the
   * loop holds the budget, and a turn reaching for it would be importing its own enforcer.
   */
  readonly budget: number;
  /**
   * What the window standing open is, threaded from the intent the resolver returned. Required
   * rather than optional for the reason `signal` is: nothing but the compiler notices it go.
   */
  readonly openCapability: string | null;
}

/**
 * What the model is told when what it produced was not a decision this turn can run. It reads the
 * vocabulary off `QUESTION_STEP_LABELS` rather than restating it, since a bad label lands here.
 */
export const UNREADABLE_DECISION = [
  "That was not the shape this tool takes.",
  "Send one object: next set to read with the statement in read,",
  "or next set to answer or no_home with read set to null.",
  `A read also carries label, which is one of: ${QUESTION_STEP_LABELS.join(", ")}.`,
].join(" ");

/**
 * What the model is told when it says there is nowhere for something before it has opened
 * anything of this person's. The ending is earned by looking, never by shrugging (decision 30).
 */
export const LOOK_BEFORE_NO_HOME = [
  "You have not opened any of these collections yet, so you cannot know there is nowhere for this.",
  "Read one first. What they asked about is often a value inside a collection rather than a",
  "collection of its own, and only what the rows say can rule that out.",
].join(" ");

/** Whether this step is the refusal above, which is what makes a second gap a model that will
 * not look rather than one that has not looked yet. */
function toldToLookFirst(step: QuestionStep): boolean {
  return step.result.outcome === "failed" && step.result.message === LOOK_BEFORE_NO_HOME;
}

const NOTHING_READ = Object.freeze({ outcome: "rows", rows: [] } as const);

function refused(call: QuestionToolCall, facts: StatementFacts, message: string): QuestionTurn {
  return { kind: "step", step: { call, ...facts, result: { outcome: "failed", message } } };
}

/**
 * The question's two weighings of one step (decision 12): `beforeReading` weighs the statement and
 * its bound values alone, `afterReading` the step the worker produced, its rows scrubbed first so
 * what is weighed is what every later prompt carries. The words are the payload's.
 */
function payloadRefusal(
  steps: readonly QuestionStep[],
  call: QuestionToolCall,
  facts: StatementFacts,
): {
  /** Refused for its own size, and recorded without the call that could not be carried. */
  readonly statement: string | null;
  readonly beforeReading: string | null;
  afterReading(
    rows: readonly QueryWorkerRow[],
    ledger: QuestionLedger,
  ): {
    readonly step: QuestionStep;
    readonly refusal: string | null;
  };
} {
  const spent = questionPayloadSpent(steps);
  const asked: QuestionStep = { call, ...facts, result: NOTHING_READ };
  const askedBytes = questionStepBytes(asked, steps.length);
  return {
    statement: questionStatementRefusal(askedBytes),
    beforeReading: questionPayloadRefusal(0, askedBytes, spent),
    afterReading(rows, ledger) {
      const scrubbed = scrubQuestionRows(rows, ledger);
      const step: QuestionStep = { call, ...facts, result: { outcome: "rows", rows: scrubbed } };
      return {
        step,
        refusal: questionPayloadRefusal(
          questionPayloadBytes(scrubbed),
          questionStepBytes(step, steps.length),
          spent,
        ),
      };
    },
  };
}

/** A turn the model is told to take again: no statement ran, and the words go back as its step. */
function toldAgain(message: string): QuestionTurn {
  return {
    kind: "step",
    step: { call: null, ...NO_STATEMENT_FACTS, result: { outcome: "failed", message } },
  };
}

/**
 * A statement this turn will run, tagged so it is told from an ending by what it carries rather
 * than by what it lacks: `QuestionToolCall`'s shape is the model's wire schema, and the day one of
 * its fields is called `kind` a read would be returned as an ending with no statement run.
 */
interface QuestionStatementToRun {
  readonly kind: "run";
  readonly call: QuestionToolCall;
}

/**
 * What a decision comes to before anything runs: the statement to run, an ending, or the model
 * told to take the turn again. A gap is refused here until she has opened a collection.
 */
function decided(
  decision: QuestionDecision | null,
  steps: readonly QuestionStep[],
): QuestionTurn | QuestionStatementToRun {
  if (decision === null) return toldAgain(UNREADABLE_DECISION);
  switch (decision.next) {
    case "answer":
      return { kind: "answer" };
    case "no_home":
      if (questionOpenedACollection(steps)) return { kind: "no_home" };
      // Told once, and once only: a second gap claimed with nothing opened is a model that will
      // not look, and eight more turns of telling it so loses the question's ending altogether.
      return steps.some(toldToLookFirst) ? { kind: "answer" } : toldAgain(LOOK_BEFORE_NO_HOME);
    case "read":
      return decision.read === null
        ? toldAgain(UNREADABLE_DECISION)
        : { kind: "run", call: decision.read };
    default:
      return assertNever(decision.next, "question decision");
  }
}

/**
 * Run one turn. A decision that will not parse is a turn, not an ending; a generation that
 * *faulted* rejects the awaited handle and ends the question, where a bad shape resolves it.
 */
export async function runQuestionTurn(
  deps: QuestionTurnDeps,
  input: QuestionTurnInput,
): Promise<QuestionTurn> {
  const steps = input.steps;
  const specs = scopedCapabilitySpecs(deps.scope.catalog, deps.scope.incarnations);
  const prompt = buildQuestionTurnPrompt({
    question: input.question,
    specs,
    steps,
    budget: input.budget,
    openCapability: input.openCapability,
  });
  // Wrapped so the scope can end a generation (decision 10): unwrapped, a call that never settles
  // parks the turn for ever with the whole catalog held (6.2/02). No clock bounds a stuck one.
  const provider = abortableProvider(deps.provider, deps.scope.signal);
  const generated = provider.generate(prompt, questionDecisionSchema);
  const decision = questionDecisionSchema.safeParse(await generated.object);
  const outcome = decided(decision.success ? decision.data : null, steps);
  if (outcome.kind !== "run") return outcome;
  const call = outcome.call;
  // The budget is spent *before* the statement: running it first would report ten reads while
  // eleven ran, and with no deadline the eleventh is an unbounded wait nobody sees the rows of.
  if (steps.length >= input.budget) return { kind: "spent" };

  // Scrubbed before it is weighed, so the statement the budget counts is the one later prompts
  // carry; the worker runs what the model wrote. One too large as written is refused before the
  // scrub reads it, keeping no call. A key saved while the statement runs is not in this ledger
  // read; the worker's views check the ledger as they read.
  const written: QuestionStep = { call, ...NO_STATEMENT_FACTS, result: NOTHING_READ };
  const ledger = readQuestionLedger(deps.database);
  const shown: QuestionToolCall | null =
    questionStatementRefusal(questionStepBytes(written, steps.length)) === null
      ? {
          ...call,
          sql: scrubQuestionText(call.sql, ledger),
          parameters: scrubQuestionValues(call.parameters, ledger),
        }
      : null;
  const ran = await ranStatement(deps, { steps, specs, call, shown, ledger });
  if (ran.kind !== "step" || ran.step.result.outcome !== "failed") return ran;
  const message = scrubQuestionText(ran.step.result.message, ledger);
  return { kind: "step", step: { ...ran.step, result: { outcome: "failed", message } } };
}

interface StatementToRun {
  readonly steps: readonly QuestionStep[];
  readonly specs: readonly CapabilitySpec[];
  /** What runs. */
  readonly call: QuestionToolCall;
  /** What is weighed and recorded (Module 7 decision 37), or `null` for one too large to scrub. */
  readonly shown: QuestionToolCall | null;
  readonly ledger: QuestionLedger;
}

async function ranStatement(
  deps: QuestionTurnDeps,
  { steps, specs, call, shown, ledger }: StatementToRun,
): Promise<QuestionTurn> {
  // Declared out here so a statement that was admitted and then failed in the worker still
  // records what its plan said; a statement refused by the bound itself never had one read.
  let facts: StatementFacts = NO_STATEMENT_FACTS;
  try {
    const explained = assertWholeCatalogQuery(deps.database, specs, call.sql, call.parameters);
    facts = {
      // `scopedCapabilitySpecs` already resolved these to the names the person gave them.
      collections: explained.collections.map((spec) => spec.label),
      plan: explained.plan,
    };
    const refusal = payloadRefusal(steps, shown ?? call, facts);
    // Weighed before it runs: a statement that fails has no rows to weigh, and its text is
    // re-rendered into every later prompt all the same.
    if (shown === null || refusal.statement !== null) {
      // The one refusal that keeps no call: quoting an unquotable statement back into the
      // prompt that refuses it would be the failure it is refusing.
      return {
        kind: "step",
        step: {
          call: null,
          ...facts,
          result: { outcome: "failed", message: refusal.statement ?? QUESTION_STATEMENT_TOO_LARGE },
        },
      };
    }
    if (refusal.beforeReading !== null) return refused(shown, facts, refusal.beforeReading);
    const rows = await deps.scope.read(call.sql, call.parameters);
    // Far past the cap before any scrub reads it: scanning what nobody will be sent is the cost.
    if (questionRowsTooLargeToScrub(rows)) {
      return refused(shown, facts, QUESTION_STEP_RESULT_TOO_LARGE);
    }
    // Weighed again with its rows, between the worker and the step, so an over-size result is
    // never something a later reader has to remember not to use. The rows are dropped whole.
    const read = refusal.afterReading(rows, ledger);
    if (read.refusal !== null) return refused(shown, facts, read.refusal);
    return { kind: "step", step: read.step };
  } catch (error) {
    const message = questionStatementFault(error);
    if (message === undefined) throw error;
    return {
      kind: "step",
      step: { call: shown, ...facts, result: { outcome: "failed", message } },
    };
  }
}
