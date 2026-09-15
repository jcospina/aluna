// Nothing-found and found-nothing are two endings, not one (PLAN decision 17; ADR-0008). The
// platform tells them apart here, before an answer is written, out of what SQLite returned and
// what its plan said — never out of anything the model wrote about either.
//
// A returned value cannot be read on its own: `0` is what an empty `count` answers and also what
// `coalesce(sum(x), 0)` and `? AS category` hand back out of thin air. So the plan is read first,
// and only one whose result columns arrive from an aggregate or a column through plain moves is
// read a result off. Anything that can put a value where a null belongs — a null test, a literal,
// a bound value, arithmetic, a reshaping whose answer over nothing this cannot work out, a second
// arm of a compound — makes it unreadable, and an unreadable plan promises nothing: its step
// matched nothing, the side decision 17 protects. Two shapes need no value read at all: one that
// carries a scanned column out, and one that groups, since a group exists only because a row was
// scanned. Every aggregate answers `NULL` over no rows bar the four below.

//
// A leaf but for the plan shape it reads into, which is part of what a step is and lives with
// the rest of one. `whole-catalog-query-scope.ts` reads the plan through this module.

import type { QueryWorkerRow, QueryWorkerValue } from "./query-worker.ts";
import { NO_PLAN, type QuestionStep, type QuestionStepPlan } from "./question-step.ts";

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
 * answer where SQLite would have answered nothing, and the plan stops being readable. `Cast` and
 * `Function` are here on the condition {@link answersSurviveTheTail} then checks.
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

/**
 * Whether this row is a line of an `EXPLAIN`. Checked rather than asserted: the two fields read
 * below drive every branch here, and a shape that stopped matching would read as a plan holding
 * no result row — the one reading that lets a zero be spoken as a fact about this person.
 */
export function isPlannedOpcode(row: unknown): row is PlannedOpcode {
  const line = row as Partial<PlannedOpcode> | null;
  return typeof line?.opcode === "string" && typeof line.addr === "number";
}

/** The function this `p4` names, which SQLite renders as `name(arity)`. An aggregate's and a
 * scalar's are written the same way. */
function namedFunction(p4: unknown): string | undefined {
  if (typeof p4 !== "string") return undefined;
  return /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(p4)?.[1]?.toLowerCase();
}

/** Where an aggregate leaves its answer: `AggFinal` names it, and `Count` is a bare `count(*)`. */
function finalizedAggregate(op: PlannedOpcode): { register: number; name: string } | undefined {
  if (op.opcode === "Count") return { register: op.p2, name: "count" };
  if (op.opcode !== "AggFinal") return undefined;
  const name = namedFunction(op.p4);
  return name === undefined ? undefined : { register: op.p1, name };
}

/**
 * Which registers this opcode writes, and where each takes its value from — `undefined` for a
 * write out of something the trace does not follow. A function's output is one of those: what it
 * answers over a null is its own business, which {@link answersSurviveTheTail} is what weighs.
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

/**
 * The opcodes that reshape a finalized aggregate on its way out, whose answer over nothing the
 * trace cannot compute. `Function` is here as well as in `READABLE` because it is readable only
 * when what it is handed is a null and it answers one.
 */
const SHAPES_A_VALUE = new Set(["Cast", "Function"]);

/**
 * The scalar functions that answer `NULL` when an argument is one, measured against SQLite rather
 * than assumed: `printf`, `format`, `quote`, `typeof`, `char`, `concat`, `iif`, `hex`, `json_quote`,
 * `json_array` and `json_object` each answer something over a null, and a figure where SQLite would
 * have answered nothing is the whole of what this file exists to refuse.
 */
const ANSWERS_NULL_OVER_NULL: ReadonlySet<string> = new Set([
  "abs",
  "ceil",
  "ceiling",
  "date",
  "datetime",
  "exp",
  "floor",
  "instr",
  "julianday",
  "length",
  "ln",
  "log",
  "log10",
  "log2",
  "lower",
  "ltrim",
  "max",
  "min",
  "mod",
  "nullif",
  "pow",
  "power",
  "replace",
  "round",
  "rtrim",
  "sign",
  "sqrt",
  "strftime",
  "substr",
  "time",
  "trim",
  "unicode",
  "unixepoch",
  "upper",
]);

/**
 * Whether the empty answers survive what stands between the aggregates and the result row. A
 * reshaping over an aggregate that answers something other than `NULL` puts a figure there the
 * platform cannot work out — `round(total(x), 2)` is `0.0` over nothing — and so does a function
 * that answers over a null. Either way the plan stops being readable rather than promising a zero.
 */
function answersSurviveTheTail(
  finalized: readonly PlannedOpcode[],
  between: readonly PlannedOpcode[],
): boolean {
  const shaped = between.filter((op) => SHAPES_A_VALUE.has(op.opcode));
  if (shaped.length === 0) return true;
  if (finalized.some((op) => EMPTY_ANSWERS[finalizedAggregate(op)?.name ?? ""] !== undefined)) {
    return false;
  }
  return shaped.every(
    (op) => op.opcode === "Cast" || ANSWERS_NULL_OVER_NULL.has(namedFunction(op.p4) ?? ""),
  );
}

/**
 * Whether this plan sorts its rows into groups. SQLite compiles a `GROUP BY` it cannot satisfy
 * from an index into a sorter plus a comparison at each group boundary, and a capability's table
 * carries no index but its key. A plain `ORDER BY` has the sorter and no comparison.
 */
function groupsItsRows(opcodes: readonly PlannedOpcode[]): boolean {
  return (
    opcodes.some((op) => op.opcode === "SorterData") &&
    opcodes.some((op) => op.opcode === "Compare")
  );
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
  // More than one place a row is handed back is more than one arm of a compound select, and the
  // answers below describe one arm. Both arms' empty rows arrive and only one set is ever spent.
  // Weighed before the grouping below, since one arm of a compound may group and the other not.
  if (opcodes.filter((op) => op.opcode === "ResultRow").length > 1) return NO_PLAN;
  // A group exists only because a row was scanned, so a grouped plan hands back nothing at all
  // over nothing — whatever the ordering and limiting between the aggregate and the result row
  // does, which the register trace below cannot follow through a sorter.
  if (groupsItsRows(opcodes)) return { empty: "no rows" };
  const between = opcodes.filter((op) => op.addr > last.addr && op.addr < resultRow.addr);
  if (between.some((op) => !READABLE.has(op.opcode))) return NO_PLAN;
  if (!answersSurviveTheTail(finalized, between)) return NO_PLAN;
  const answers = holds
    .map((name) => (name === undefined ? undefined : EMPTY_ANSWERS[name]))
    .filter((answer): answer is string | number => answer !== undefined);
  return { empty: "one row", answers };
}

/**
 * Whether one value is one the plan's own figures could have answered over nothing — a null, or
 * an answer not yet spent, which this spends. A value of any other type is one a row was scanned
 * into: no aggregate of the four answers a boolean or a blob.
 */
function answeredOverNothing(value: QueryWorkerValue, unspent: (string | number)[]): boolean {
  if (value === null) return true;
  if (typeof value !== "string" && typeof value !== "number") return false;
  const spend = unspent.indexOf(value);
  if (spend < 0) return false;
  unspent.splice(spend, 1);
  return true;
}

/**
 * Whether these rows are the row an aggregating plan hands back over nothing: nulls, and no value
 * its figures could not have answered. Each answer is spent once, so a second zero against one
 * count is a row that was scanned. What this cannot settle, recorded rather than hidden: rows
 * that *did* match can return the row an empty one does — `min(x)` over two rows with no `x` —
 * and are read as nothing found, which is weaker than the truth and never a figure about a person.
 */
function isTheEmptyRow(
  rows: readonly QueryWorkerRow[],
  answers: readonly (string | number)[],
): boolean {
  const unspent = [...answers];
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (!answeredOverNothing(value, unspent)) return false;
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
 * Whether any step opened one of this person's collections and read from it — what *looking*
 * is, and 6.4/05's gate. A statement that returned a row of its own did none of it.
 */
export function questionOpenedACollection(steps: readonly QuestionStep[]): boolean {
  return steps.some((step) => step.result.outcome === "rows" && step.collections.length > 0);
}

/**
 * Whether this question searched and found nothing — which a question whose every statement
 * failed did not do, and `question-narration.ts` has its own words for.
 */
export function questionFoundNothing(steps: readonly QuestionStep[]): boolean {
  return questionReadSomething(steps) && !steps.some(questionStepMatchedRows);
}
