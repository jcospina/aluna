// The records an answer names, checked (ADR-0010; Module 7 PLAN decisions 45 to 47). She nominates
// a record by the words that name it and the id she read for it; the platform keeps a nomination
// only when all four checks hold, and links the first free occurrence of those words. Every other
// nomination is dropped without a word, and the answer is spoken either way.
//
// The holders read answers the second check, and it also decides which strings are record ids at
// all: a key or a token a person saved stays in what she says. One more check is the platform's
// own: the words must stand in a cell of the row that returned the id, and that cell must be one
// of the record's own text values, read from its capability, because a statement can return any
// id beside any name.

import { hasRecordView } from "../../../presentation/index.ts";
import { activeSpecFields, capabilitySpecFromRow } from "../../../registry/index.ts";
import type { AnswerRecordLink } from "../../../server/http/index.ts";
import {
  QuestionAnswerUnreadableError,
  type QuestionAnswerWritten,
  SAYS_SOMETHING,
  shaped,
} from "../endings/question-answer.ts";
import type { QuestionStep } from "../step/question-step.ts";
import type { QueryWorkerRow } from "../worker/query-worker.ts";
import { oneWord } from "./answer-id-cut.ts";
import {
  holdsARecordId,
  idDigits,
  idsInCell,
  wholeCellId,
  withoutRecordIds,
} from "./answer-record-ids.ts";
import { type CheckingScope, type Holders, holdersOf, storedRecords } from "./record-reads.ts";

/** What an answered question says, and which of its words link which record. */
export interface SpokenAnswer {
  readonly answer: string;
  readonly links: readonly AnswerRecordLink[];
}

/** A nomination past the first check: the words, the id, and the capabilities that could hold it. */
interface Candidate {
  readonly says: string;
  readonly id: string;
  readonly capabilities: ReadonlySet<string>;
  /** The cells, folded, of the rows that returned the id, in which the words stand. */
  readonly cells: ReadonlySet<string>;
}

/** A nomination past the first three checks, and the one capability that holds its record. */
interface Vouched extends Candidate {
  readonly capability: string;
}

export interface RecordCheckDeps {
  readonly scope: CheckingScope;
}

/**
 * The answer with every record id the steps returned taken out, and a link for each nomination
 * that holds. Throws `QuestionAnswerUnreadableError` when nothing but ids was said, and a
 * cancellation; a check that could not be read costs the links and never the answer.
 */
export async function linkTheRecordsNamed(
  deps: RecordCheckDeps,
  steps: readonly QuestionStep[],
  written: QuestionAnswerWritten,
): Promise<SpokenAnswer> {
  const returned = new Set(rowsOf(steps).flatMap((row) => Object.values(row).flatMap(idsInCell)));
  const holders = await holdersOf(deps.scope, returned);
  // A check that could not be read decides nothing, so every id-shaped string is taken out.
  const ids = new Set([...(holders?.keys() ?? returned)].map(idDigits));
  const answer = withoutRecordIds(written.answer, ids);
  if (!SAYS_SOMETHING.test(answer)) {
    throw new QuestionAnswerUnreadableError(
      "Once the ids were taken out, the answer said nothing.",
    );
  }
  if (holders === undefined) return { answer, links: [] };
  const vouched = written.records.flatMap((named) => {
    const candidate = returnedAsACell(steps, { ids, answer }, named);
    const capability = candidate && theOneHolder(deps, candidate, holders);
    return candidate && capability ? [{ ...candidate, capability }] : [];
  });
  const stored = vouched.length > 0 ? await storedRecords(deps.scope, vouched) : undefined;
  return { answer, links: placed(deps, answer, vouched, stored ?? new Map()) };
}

/** The links, in the order she named them and then in the order they stand in the answer. */
function placed(
  deps: RecordCheckDeps,
  answer: string,
  vouched: readonly Vouched[],
  stored: ReadonlyMap<string, QueryWorkerRow>,
): readonly AnswerRecordLink[] {
  const links: AnswerRecordLink[] = [];
  // The longest name first, so a short one cannot take the start of a longer one it sits inside.
  const longestFirst = vouched.toSorted((one, other) => other.says.length - one.says.length);
  for (const { says, id, capability, cells } of longestFirst) {
    const record = stored.get(id);
    const own = record && namesIt(record, textFields(deps, capability), cells);
    const at = own ? freeOccurrence(answer, says, links) : undefined;
    if (at !== undefined) links.push({ from: at, to: at + says.length, capability, record: id });
  }
  return links.toSorted((one, other) => one.from - other.from);
}

function rowsOf(steps: readonly QuestionStep[]): readonly QueryWorkerRow[] {
  return steps.flatMap((step) => (step.result.outcome === "rows" ? step.result.rows : []));
}

/**
 * How a name is compared with a value: shaped as the answer is, composed, with a curly apostrophe
 * read as a straight one, in lower case, without the room round it. Never used for a position.
 */
const folded = (value: string) =>
  shaped(value)
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
    .toLowerCase();

/** The capability's fields a person writes words into: its text and its choices. */
function textFields(deps: RecordCheckDeps, capability: string): readonly string[] {
  const row = deps.scope.catalog.capabilities.find((candidate) => candidate.id === capability);
  if (!row) return [];
  return activeSpecFields(capabilitySpecFromRow(row).schema.fields)
    .filter(({ type }) => type === "string" || type === "choice")
    .map(({ name }) => name);
}

/**
 * The platform's own check beside the four: the step's cell that held the words is one of this
 * record's own text values, so a name links the record it names and not one returned beside it.
 */
function namesIt(
  record: QueryWorkerRow,
  fields: readonly string[],
  cells: ReadonlySet<string>,
): boolean {
  return fields.some((field) => {
    const value = record[field];
    return typeof value === "string" && cells.has(folded(value));
  });
}

/** Whether `says` stands in `cell` as words of their own, in any case. */
function standsIn(cell: string, says: string): boolean {
  const [text, words] = [folded(cell), folded(says)];
  for (let at = text.indexOf(words); at !== -1; at = text.indexOf(words, at + 1)) {
    if (!cutsAWord(text, at, at + words.length)) return true;
  }
  return false;
}

/**
 * The first check, and what the others need from it: the id came back as a whole cell of some
 * step's rows, the capabilities every such step read, and the cells of those rows that hold the
 * words. Words the answer does not hold, that would show an id, that say nothing, or that break a
 * line or a character in two name nothing.
 */
function returnedAsACell(
  steps: readonly QuestionStep[],
  { ids, answer }: { readonly ids: ReadonlySet<string>; readonly answer: string },
  named: QuestionAnswerWritten["records"][number],
): Candidate | undefined {
  const id = wholeCellId(named.id);
  const { says } = named;
  if (id === undefined || !ids.has(idDigits(id)) || !answer.includes(says)) return undefined;
  if (!says.isWellFormed() || !SAYS_SOMETHING.test(says) || says.includes("\n")) return undefined;
  if (holdsARecordId(says, ids)) return undefined;
  const carries = (row: QueryWorkerRow) =>
    Object.values(row).some((cell) => wholeCellId(cell) === id);
  const reading = steps.filter((step) => rowsOf([step]).some(carries));
  const cells = rowsOf(reading)
    .filter(carries)
    .flatMap((row) => Object.values(row))
    .filter((cell): cell is string => typeof cell === "string" && standsIn(cell, says));
  const capabilities = new Set(reading.flatMap((step) => step.capabilities));
  if (capabilities.size === 0 || cells.length === 0) return undefined;
  return { says, id, capabilities, cells: new Set(cells.map(folded)) };
}

/** The second and third checks: exactly one capability read holds it, with a record view. */
function theOneHolder(
  deps: RecordCheckDeps,
  candidate: Candidate,
  holders: Holders,
): string | undefined {
  const held = holders.get(candidate.id) ?? new Set();
  const holding = [...candidate.capabilities].filter((id) => held.has(id));
  const [only] = holding;
  if (holding.length !== 1 || only === undefined) return undefined;
  const row = deps.scope.catalog.capabilities.find((capability) => capability.id === only);
  return row && hasRecordView({ actions: row.tools }) ? only : undefined;
}

/** Whether `from..to` starts or ends inside a word, a combining mark counting as part of one. */
function cutsAWord(text: string, from: number, to: number): boolean {
  const inside = [...text.slice(from, to)];
  const before = [...text.slice(Math.max(0, from - 2), from)].at(-1);
  const after = [...text.slice(to, to + 2)][0];
  return oneWord(before, inside[0]) || oneWord(inside.at(-1), after);
}

/**
 * The fourth check, and where the link goes: the first occurrence of `says` that overlaps no link
 * already placed. One standing as a word of its own comes before one that would cut a longer word.
 */
function freeOccurrence(
  answer: string,
  says: string,
  links: readonly AnswerRecordLink[],
): number | undefined {
  const free: number[] = [];
  for (let at = answer.indexOf(says); at !== -1; at = answer.indexOf(says, at + 1)) {
    const end = at + says.length;
    if (!links.some((link) => at < link.to && link.from < end)) free.push(at);
  }
  return free.find((at) => !cutsAWord(answer, at, at + says.length)) ?? free[0];
}
