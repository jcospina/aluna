// Nothing-found and found-nothing are two endings, not one (PLAN decision 17; ADR-0008). The
// platform tells them apart here, before an answer is written, out of what SQLite returned and
// what its plan said — never out of anything the model wrote about either.
//
// A returned value cannot be read on its own: `0` is what an empty `count` answers and also what
// `coalesce(sum(x), 0)` and `? AS category` hand back out of thin air. So the plan is read first,
// and only a plan whose result columns arrive from an aggregate or a column through plain moves
// is one the platform will read a result off. Anything that can put a value where a null belongs
// — a null test, a literal, a bound value, arithmetic — makes it unreadable, and an unreadable
// plan promises nothing: its step matched nothing, which is the side decision 17 protects.
//
// Every aggregate then answers `NULL` over no rows, except the four below. So the empty row is
// nulls plus those answers, and a value beyond them is one a row was scanned into.
//
// A leaf: type imports only. `whole-catalog-query-scope.ts` reads the plan through it.

import type { QueryWorkerRow, QueryWorkerValue } from "./query-worker.ts";
import type { QuestionStep } from "./question-turn.ts";

/** What an aggregate answers when there is nothing to aggregate, where that is not `NULL`. */
const EMPTY_ANSWERS: Readonly<Record<string, string | number>> = Object.freeze({
  count: 0,
  total: 0,
  json_group_array: "[]",
  json_group_object: "{}",
});

/**
 * What may stand between an aggregate and the result row. Moves carry a value, comparisons only
 * jump, and a function propagates the null it is handed. Everything else — `NotNull` for a
 * `coalesce`, `String8` for a literal, `Variable` for a bound value, `Add` for arithmetic — can
 * answer where SQLite would have answered nothing, and the plan stops being readable.
 */
const READABLE = new Set([
  "AggFinal",
  "Cast",
  "Close",
  "Copy",
  "Count",
  "Function",
  "Move",
  "RealAffinity",
  "SCopy",
  "Eq",
  "Ge",
  "Gt",
  "Le",
  "Lt",
  "Ne",
]);

/** The opcodes that carry a plan back round its own loop, so its rows come one per scanned row. */
const ADVANCES_A_LOOP = new Set(["Next", "Prev", "SorterNext", "VNext"]);

/** What a register holds when it came off a row of the data rather than out of an aggregate. */
const OFF_A_ROW = "a column";

/** One line of an `EXPLAIN`, which is where every fact below is read from. */
export interface PlannedOpcode {
  readonly addr: number;
  readonly opcode: string;
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: unknown;
}

/** What a statement's plan says it would hand back having matched nothing at all. */
export type QuestionStepPlan =
  /** It aggregates nothing, so it hands back a row only for a row it matched. */
  | { readonly empty: "no rows" }
  /** It aggregates, and these are the answers of its figures that are not `NULL` over nothing. */
  | { readonly empty: "one row"; readonly answers: readonly (string | number)[] }
  /** Nothing the platform can read a result against, so it makes no promise about a zero. */
  | { readonly empty: "unreadable" };

/** The plan of a statement that never reached one, and of a read the bound refused outright. */
export const NO_PLAN: QuestionStepPlan = Object.freeze({ empty: "unreadable" });

/** The aggregate this `p4` names, which SQLite renders as `name(arity)`. */
function aggregateName(p4: unknown): string | undefined {
  if (typeof p4 !== "string") return undefined;
  return /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(p4)?.[1]?.toLowerCase();
}

/** Where an aggregate leaves its answer: `AggFinal` names it, and `Count` is a bare `count(*)`. */
function finalizedAggregate(op: PlannedOpcode): { register: number; name: string } | undefined {
  if (op.opcode === "Count") return { register: op.p2, name: "count" };
  if (op.opcode !== "AggFinal") return undefined;
  const name = aggregateName(op.p4);
  return name === undefined ? undefined : { register: op.p1, name };
}

/**
 * Which registers this opcode writes, and where each takes its value from — `undefined` for a
 * write out of something the trace does not follow. A function's output is one of those: it
 * answers for itself, and what it answers over a null is its own business.
 */
function writesRegisters(
  op: PlannedOpcode,
): { readonly from: number | undefined; readonly to: number; readonly span: number } | undefined {
  if (op.opcode === "Copy" || op.opcode === "Move") return { from: op.p1, to: op.p2, span: op.p3 };
  if (op.opcode === "SCopy") return { from: op.p1, to: op.p2, span: 0 };
  if (op.opcode === "Function") return { from: undefined, to: op.p3, span: 0 };
  return undefined;
}

/** What this opcode leaves behind in the trace: an aggregate's answer, a value off a row, a
 * value carried from another register, or a value the trace does not follow. */
function traceOpcode(op: PlannedOpcode, held: Map<number, string>): void {
  const put = (register: number, name: string | undefined): void => {
    if (name === undefined) held.delete(register);
    else held.set(register, name);
  };
  const aggregate = finalizedAggregate(op);
  if (aggregate) {
    put(aggregate.register, aggregate.name);
    return;
  }
  if (op.opcode === "Column") {
    put(op.p3, OFF_A_ROW);
    return;
  }
  const written = writesRegisters(op);
  if (written === undefined) return;
  const { from, to, span } = written;
  for (let index = 0; index <= span; index += 1) {
    put(to + index, from === undefined ? undefined : held.get(from + index));
  }
}

/** What each register holds by the time the result row is read. */
function heldByRegister(opcodes: readonly PlannedOpcode[]): ReadonlyMap<number, string> {
  const held = new Map<number, string>();
  for (const op of opcodes) traceOpcode(op, held);
  return held;
}

/** What the result row is built out of, column by column. */
function resultHolds(
  opcodes: readonly PlannedOpcode[],
  resultRow: PlannedOpcode,
): readonly (string | undefined)[] {
  const held = heldByRegister(opcodes.filter((op) => op.addr <= resultRow.addr));
  return Array.from({ length: resultRow.p2 }, (_, column) => held.get(resultRow.p1 + column));
}

/**
 * Whether this plan's rows come one per row it scanned. Either it loops back over them, or it
 * carries one of their columns out — `EXISTS (…)` and `SELECT 1` do neither, and hand back their
 * one row whether anything matched or not.
 */
function rowsComeFromRows(
  opcodes: readonly PlannedOpcode[],
  resultRow: PlannedOpcode,
  holds: readonly (string | undefined)[],
): boolean {
  if (holds.includes(OFF_A_ROW)) return true;
  return opcodes.some((op) => op.addr > resultRow.addr && ADVANCES_A_LOOP.has(op.opcode));
}

/**
 * Read what this statement would hand back having matched nothing. Every fact is the plan's:
 * which aggregates it finalizes, which registers carry them into the result row, and whether
 * anything between the two could answer where SQLite would not have.
 */
export function readQuestionPlan(opcodes: readonly PlannedOpcode[]): QuestionStepPlan {
  const finalized = opcodes.filter(finalizedAggregate);
  const last = finalized.at(-1);
  const resultRow = opcodes.find(
    (op) => op.opcode === "ResultRow" && (last === undefined || op.addr > last.addr),
  );
  if (resultRow === undefined) return { empty: "no rows" };
  const holds = resultHolds(opcodes, resultRow);
  if (last === undefined) {
    return rowsComeFromRows(opcodes, resultRow, holds) ? { empty: "no rows" } : NO_PLAN;
  }
  const between = opcodes.filter((op) => op.addr > last.addr && op.addr < resultRow.addr);
  if (between.some((op) => !READABLE.has(op.opcode))) return NO_PLAN;
  const answers = holds
    .map((name) => (name === undefined ? undefined : EMPTY_ANSWERS[name]))
    .filter((answer): answer is string | number => answer !== undefined);
  return { empty: "one row", answers };
}

/**
 * Whether these rows are the row an aggregating plan hands back over nothing: nulls, and no value
 * its figures could not have answered. Each answer is spent once, so a second zero against one
 * count is a row that was scanned.
 */
function isTheEmptyRow(
  rows: readonly QueryWorkerRow[],
  answers: readonly (string | number)[],
): boolean {
  const unspent = [...answers];
  for (const row of rows) {
    for (const value of Object.values(row) as QueryWorkerValue[]) {
      if (value === null) continue;
      const spend = unspent.indexOf(value as string | number);
      if (spend < 0) return false;
      unspent.splice(spend, 1);
    }
  }
  return true;
}

/**
 * Whether this step's read matched any rows. A failed step matched none, and so did a read that
 * came back with no rows at all. Past that the plan decides: one that aggregates nothing matched
 * a row for every row it returned, one the platform cannot read promises nothing, and an
 * aggregating one matched something the moment its result is not the empty row.
 */
export function questionStepMatchedRows(step: QuestionStep): boolean {
  if (step.result.outcome === "failed") return false;
  const rows = step.result.rows;
  if (rows.length === 0) return false;
  if (step.plan.empty === "no rows") return true;
  if (step.plan.empty === "unreadable") return false;
  return !isTheEmptyRow(rows, step.plan.answers);
}

/** Whether any step of this question read something back, matched or not. */
export function questionReadSomething(steps: readonly QuestionStep[]): boolean {
  return steps.some((step) => step.result.outcome === "rows");
}

/**
 * Whether this question searched and found nothing — which a question whose every statement
 * failed did not do, and `question-narration.ts` has its own words for.
 */
export function questionFoundNothing(steps: readonly QuestionStep[]): boolean {
  return questionReadSomething(steps) && !steps.some(questionStepMatchedRows);
}
