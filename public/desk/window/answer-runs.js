// @ts-check

/**
 * The answer as the server sent it, read into the plain list the answer window draws: words, or
 * a name with the record it names (ADR-0010, PLAN decision 47). The fragment is already parsed,
 * inert, by the glue. An anchor counts only as the platform writes it: its two attributes, words
 * alone inside, and a record address, whose two ids are all that is kept of it. Any other node is
 * read as the words it shows.
 */

import {
  CAPABILITY_ID_PATTERN,
  isAddressableRecord,
  RECORD_ID_PATTERN,
} from "../../core/routes.js";

/** What marks a name as a link to its record. Restated from the server's fragments and pinned. */
export const ANSWER_RECORD_ATTRIBUTE = "data-answer-record";

/** @typedef {{ text: string }} AnswerWords */
/** @typedef {{ name: string, capability: string, record: string }} AnswerName */
/** @typedef {AnswerWords | AnswerName} AnswerRun */

/**
 * As much of a parsed node as reading it asks for.
 *
 * @typedef {{
 *   nodeType: number,
 *   textContent: string | null,
 *   localName?: string,
 *   childNodes?: Iterable<ReadNode>,
 *   getAttributeNames?: () => string[],
 *   getAttribute?: (name: string) => string | null,
 * }} ReadNode
 */

const RECORD_LINK = new RegExp(`^/capability/(${CAPABILITY_ID_PATTERN})/(${RECORD_ID_PATTERN})$`);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Whether a run names a record the desk can address, under a name that shows something.
 *
 * @param {unknown} run
 * @returns {run is AnswerName}
 */
export function isAnswerName(run) {
  if (typeof run !== "object" || run === null) return false;
  const { name, capability, record } = /** @type {Record<string, unknown>} */ (run);
  return typeof name === "string" && name.trim() !== "" && isAddressableRecord(capability, record);
}

/**
 * Whether a node is an anchor as the platform writes one: its mark, an `href`, and words inside.
 *
 * @param {ReadNode} node
 */
function isPlatformAnchor(node) {
  if (node.nodeType !== ELEMENT_NODE || node.localName !== "a") return false;
  const attributes = node.getAttributeNames?.() ?? [];
  const own = attributes.length === 2 && attributes.includes(ANSWER_RECORD_ATTRIBUTE);
  if (!own || node.getAttribute?.(ANSWER_RECORD_ATTRIBUTE) !== "") return false;
  return [...(node.childNodes ?? [])].every((child) => child.nodeType === TEXT_NODE);
}

/**
 * The name an anchor links, or null where it is not the platform's own.
 *
 * @param {ReadNode} node
 * @returns {AnswerName | null}
 */
function nameIn(node) {
  if (!isPlatformAnchor(node)) return null;
  const linked = RECORD_LINK.exec(node.getAttribute?.("href") ?? "");
  const run = { name: node.textContent ?? "", capability: linked?.[1], record: linked?.[2] };
  if (!isAnswerName(run)) return null;
  return { name: run.name, capability: run.capability, record: run.record.toLowerCase() };
}

/**
 * The words a node shows: a text node's own, an element's text, a break as a line's end, and
 * nothing for a comment.
 *
 * @param {ReadNode} node
 * @returns {string}
 */
function wordsIn(node) {
  if (node.nodeType === ELEMENT_NODE && node.localName === "br") return "\n";
  const shows = node.nodeType === TEXT_NODE || node.nodeType === ELEMENT_NODE;
  return shows && typeof node.textContent === "string" ? node.textContent : "";
}

/**
 * Every run of the saying, in order. Words beside words are one run.
 *
 * @param {{ childNodes: Iterable<ReadNode> }} said
 * @returns {AnswerRun[]}
 */
export function answerRuns(said) {
  /** @type {AnswerRun[]} */
  const runs = [];
  for (const node of said.childNodes) {
    if (typeof node?.nodeType !== "number") continue;
    const named = nameIn(node);
    const last = runs.at(-1);
    if (named !== null) runs.push(named);
    else if (last !== undefined && "text" in last) last.text += wordsIn(node);
    else runs.push({ text: wordsIn(node) });
  }
  return runs.filter((run) => !("text" in run) || run.text !== "");
}
