// What a question's model may read of what came back (Module 7 PLAN decision 37; ADR-0009).
//
// The worker's views show a file column without its key, and withhold text or a file's name that
// may hold an address: a `/files/` path, a NUL, or a ledger key in any case once the separators
// they list are dropped (`query-worker-thread.ts`). This is the second layer, for a copy stored in
// a form the views cannot read and for the statement, its bound values and SQLite's messages. A
// value that is or contains a ledger key or an address is replaced.
//
// A key is matched against the ledger rather than the UUID shape, which a record's id shares, by
// any twelve of its digits in a row, forwards or backwards, after NFKC: in any case, with
// separators that are not hex digits, in pieces of twelve digits or more, in shorter pieces kept
// in order across neighbouring values, hex-encoded, as a blob, or as character codes. A copy some
// Handler stored in a form the views cannot read can still be cut up and reordered by a statement
// past both layers; nothing a scrub reads of the result can undo that.

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { keylessStoredFileReference } from "../data/schema/file-values.ts";
import type { QueryWorkerRow, QueryWorkerValue } from "./query-worker.ts";

/** What the model reads in place of a value that held a file's address. */
export const QUESTION_FILE_WITHHELD = "(withheld: it may hold a file's address)";

/** What both prompts tell the model about that phrase, so it is never read out as data. */
export const QUESTION_FILE_WITHHELD_RULE = `- A value reading ${QUESTION_FILE_WITHHELD} is not shown. Say nothing about it.`;

/** How many of a key's digits in a row count as the key. */
const FRAGMENT = 12;
/** Twelve characters, hex-encoded. */
const HEX_RUN = /[0-9a-f]{24,}/gi;
const KEY_CHARACTER = /^[0-9a-f-]$/i;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
/** A `/files/` path with the first eight digits of a key after it. */
const ADDRESS = new RegExp(
  `${FILE_URL_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[0-9a-fA-F]{8}`,
);
/** Text that holds none of these has no escaped or disguised path to undo. */
const MAY_HIDE_A_PATH = /[/%&\\]|[^\x20-\x7e]/;
const LARGEST_CODE_POINT = 0x10ffff;
const utf8 = new TextDecoder();

/** A key as the scrub compares it: its hex digits alone, in lower case. */
export function fileKeyDigits(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
}

/** The ledger's keys, and every run of twelve digits of each, forwards and backwards. */
export interface QuestionLedger {
  readonly keys: ReadonlySet<string>;
  readonly fragments: ReadonlyMap<string, string>;
}

export function questionLedger(keys: Iterable<string>): QuestionLedger {
  const digits = new Set([...keys].map(fileKeyDigits));
  const fragments = new Map<string, string>();
  for (const key of digits) {
    for (const run of [key, [...key].reverse().join("")]) {
      for (let at = 0; at + FRAGMENT <= run.length; at += 1) {
        fragments.set(run.slice(at, at + FRAGMENT), key);
      }
    }
  }
  return { keys: digits, fragments };
}

function hexToText(hex: string): string {
  return utf8.decode(Buffer.from(hex.slice(0, hex.length - (hex.length % 2)), "hex"));
}

/** A text's numbers read as the character codes of a key's characters; any other number is skipped. */
function characterCodes(text: string): string {
  return [...text.matchAll(/\d{1,7}/g)]
    .map(([code]) => String.fromCharCode(Number(code) % 0x10000).normalize("NFKC"))
    .filter((character) => KEY_CHARACTER.test(character))
    .join("");
}

/** What a text's hex runs decode to, at both alignments, and what those decode to in turn. */
function decodedText(text: string): string {
  const found = [characterCodes(text)];
  let layer = [text];
  while (layer.length > 0) {
    layer = layer.flatMap((source) =>
      [...source.matchAll(HEX_RUN)].flatMap(([run]) => [hexToText(run), hexToText(run.slice(1))]),
    );
    found.push(...layer);
  }
  return found.join("\n");
}

function codePoint(value: number, text: string): string {
  return value <= LARGEST_CODE_POINT ? String.fromCodePoint(value) : text;
}

/** How many times escapes are undone; a text still changing after that is taken for an address. */
const UNESCAPE_ROUNDS = 8;

/**
 * A text with every escape a path could hide behind undone, or `null` when it is still changing
 * after {@link UNESCAPE_ROUNDS}. Nested `%25` and `&amp;` collapse in one pass each, so a deep nest
 * costs one round rather than one round a layer.
 */
function unescaped(text: string): string | null {
  let current = text;
  for (let round = 0; round < UNESCAPE_ROUNDS; round += 1) {
    if (!MAY_HIDE_A_PATH.test(current)) return current;
    const next = current
      .normalize("NFKC")
      .replace(INVISIBLE, "")
      .replace(/%(?:25)+(?=[0-9a-f]{2})/gi, "%")
      .replace(/&(?:amp;)+/gi, "&")
      .replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/&#x([0-9a-f]{1,6});?/gi, (entity, hex: string) =>
        codePoint(Number.parseInt(hex, 16), entity),
      )
      .replace(/&#(\d{1,7});?/g, (entity, code: string) => codePoint(Number(code), entity))
      .replace(/&sol;/gi, "/")
      .replaceAll("\\", "");
    if (next === current) return current;
    current = next;
  }
  return null;
}

interface Cell {
  readonly name: string;
  /** What the model is shown when nothing in the cell is withheld. */
  readonly shown: QueryWorkerValue;
  readonly text: string;
  readonly decoded: string;
  readonly isNumber: boolean;
}

function cellOf(name: string, raw: QueryWorkerValue): Cell {
  if (raw instanceof Uint8Array) {
    const hex = Buffer.from(raw).toString("hex").toUpperCase();
    const text = `${hex}\n${utf8.decode(raw)}`;
    return { name, shown: `X'${hex}'`, text, decoded: decodedText(text), isNumber: false };
  }
  const shown = keylessStoredFileReference(raw) ?? raw;
  const text = typeof shown === "string" || typeof shown === "number" ? String(shown) : "";
  return { name, shown, text, decoded: decodedText(text), isNumber: typeof shown === "number" };
}

function lastStartAtOrBefore(starts: readonly number[], at: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] as number) <= at) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Marks every cell whose digits carry a key. The cells are read as one line, so a key cut into
 * pieces kept in order is still found; a cell with no digits takes no part and is never marked.
 */
function scanLine(
  texts: readonly string[],
  fragments: ReadonlyMap<string, string>,
  found: Set<string>,
  marked: Set<number>,
): void {
  let line = "";
  const starts: number[] = [];
  const owners: number[] = [];
  texts.forEach((text, index) => {
    const digits = fileKeyDigits(text);
    if (digits.length === 0) return;
    starts.push(line.length);
    owners.push(index);
    line += digits;
  });
  for (let at = 0; at + FRAGMENT <= line.length; at += 1) {
    const key = fragments.get(line.slice(at, at + FRAGMENT));
    if (key === undefined) continue;
    found.add(key);
    const first = lastStartAtOrBefore(starts, at);
    for (
      let cell = first;
      cell < starts.length && (starts[cell] as number) < at + FRAGMENT;
      cell++
    ) {
      marked.add(owners[cell] as number);
    }
  }
}

function holdsAnAddress(cell: Cell): boolean {
  return [cell.text, cell.decoded].some((text) => {
    const plain = unescaped(text);
    return plain === null || ADDRESS.test(plain);
  });
}

function scan(rows: readonly QueryWorkerRow[], ledger: QuestionLedger) {
  const cells = rows.map((row) => Object.entries(row).map(([name, raw]) => cellOf(name, raw)));
  const flat = cells.flat();
  const found = new Set<string>();
  const marked = new Set<number>();
  if (ledger.keys.size > 0) {
    // A number's digits stay off the line: one beside a piece of key would be taken for more of
    // it one time in sixteen. Read as character codes, it is on the decoded line all the same.
    const lines = [
      flat.map((cell) => (cell.isNumber ? "" : cell.text)),
      flat.map((cell) => cell.decoded),
    ];
    for (const line of lines) scanLine(line, ledger.fragments, found, marked);
  }
  flat.forEach((cell, index) => {
    if (holdsAnAddress(cell)) marked.add(index);
  });
  return { cells, found, marked };
}

/** Which of the ledger's keys, written as {@link fileKeyDigits} writes them, `rows` hold. */
export function questionFileKeysIn(
  rows: readonly QueryWorkerRow[],
  ledger: QuestionLedger,
): ReadonlySet<string> {
  return scan(rows, ledger).found;
}

function scrubbed(rows: readonly QueryWorkerRow[], ledger: QuestionLedger): QueryWorkerRow[] {
  const { cells, marked } = scan(rows, ledger);
  let index = 0;
  return cells.map((row) =>
    Object.fromEntries(
      row.map((cell) => [cell.name, marked.has(index++) ? QUESTION_FILE_WITHHELD : cell.shown]),
    ),
  );
}

/** `rows` as the model may read them, given the keys {@link questionFileKeysIn} found in them. */
export function scrubQuestionRows(
  rows: readonly QueryWorkerRow[],
  fileKeys: ReadonlySet<string>,
): QueryWorkerRow[] {
  return scrubbed(rows, questionLedger(fileKeys));
}

/** One text the model reads beside the rows — a statement, or what SQLite said about one. */
export function scrubQuestionText(text: string, ledger: QuestionLedger): string {
  const [row] = scrubbed([{ text }], ledger);
  return String(row?.text);
}

/** The values a statement was bound to, each as the model may read it. */
export function scrubQuestionValues<T extends QueryWorkerValue>(
  values: readonly T[],
  ledger: QuestionLedger,
): (T | string)[] {
  const [row] = scrubbed([Object.fromEntries(values.entries())], ledger);
  return values.map((value, index) => (row?.[index] ?? value) as T | string);
}
