// Whether a card draws each file it holds as the kind of file it is (Module 7 PLAN decisions 28
// and 29): a video in a player, a photo in a picture, and a sound or a document in words. The
// enforcer keeps every one of those elements, so a renderer that draws a video with `<img>`
// passes it, and every such card is a broken picture. A document's words name its type, and
// "PDF" names only a PDF.

import { decodeAttributeValue } from "../../../../presentation/index.ts";
import type { FileFamily } from "../../../../registry/index.ts";

/** What an element draws a file it names as: a picture, or the player it is or sits in. */
type Drawn = "image" | "video" | "audio";

/** Each file's address in `record`, and its kind; an address two kinds share is left out. */
function kindsByUrl(record: Readonly<Record<string, unknown>>): Map<string, string> {
  const kinds = new Map<string, string>();
  const shared = new Set<string>();
  for (const value of Object.values(record)) {
    const { url, kind } = (value ?? {}) as Record<string, unknown>;
    if (typeof url !== "string" || typeof kind !== "string" || url === "") continue;
    if (kinds.has(url) && kinds.get(url) !== kind) shared.add(url);
    kinds.set(url, kind);
  }
  for (const url of shared) kinds.delete(url);
  return kinds;
}

function drawnAs(tag: string, frame: string | undefined): Drawn | undefined {
  if (tag === "img") return "image";
  if (tag === "video" || tag === "audio") return tag;
  if (tag !== "source") return undefined;
  return frame === "video" || frame === "audio" ? frame : "image";
}

/**
 * The path an address loads as a browser reads it: tabs and newlines dropped, a backslash as a
 * slash, each escape decoded, dot segments resolved, and a key's hex in either case.
 */
function pathOf(address: string): string {
  const cleaned = address
    .replace(/[\t\n\r]/g, "")
    .replaceAll("\\", "/")
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return (URL.parse(cleaned, "http://origin.invalid/")?.pathname ?? cleaned).toLowerCase();
}

/** Every address `element`'s `src` and `srcset` name, as paths. */
function namedPaths(element: HTMLRewriterTypes.Element): string[] {
  const src = decodeAttributeValue(element.getAttribute("src") ?? "");
  const srcset = decodeAttributeValue(element.getAttribute("srcset") ?? "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "");
  return [src, ...srcset].filter((address) => address !== "").map(pathOf);
}

/** The kind of the first file `element` draws as something else, or of a sound it draws at all. */
function misdrawnKind(
  element: HTMLRewriterTypes.Element,
  drawn: Drawn,
  kinds: ReadonlyMap<string, string>,
): string | undefined {
  const named = namedPaths(element);
  for (const [url, kind] of kinds) {
    const misdrawn = kind !== drawn || kind === "audio";
    if (misdrawn && named.includes(pathOf(url))) return kind;
  }
  return undefined;
}

/**
 * The first file `markup` draws as another kind than it is, said for the model to fix, or
 * undefined when every file it draws is drawn as itself.
 */
export function fileKindViolation(
  record: Readonly<Record<string, unknown>>,
  markup: string,
): string | undefined {
  const kinds = kindsByUrl(record);
  if (kinds.size === 0) return undefined;
  const frames: string[] = [];
  let violation: string | undefined;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        const drawn = drawnAs(tag, frames.at(-1));
        const kind = drawn && misdrawnKind(element, drawn, kinds);
        if (kind && drawn) violation ??= misdrawnSentence(kind, drawn, tag);
        if (FRAMES.has(tag) && element.canHaveContent) {
          frames.push(tag);
          element.onEndTag(() => void frames.pop());
        }
      },
    })
    .transform(markup);
  return violation;
}

function misdrawnSentence(kind: string, drawn: Drawn, tag: string): string {
  const rule =
    'Draw a file by its `kind`: "image" in an <img>, "video" in a <video>, and "audio" and "document" in words alone.';
  if (kind === "audio") {
    return `it draws a sound with <${tag}>, and a card holds no player. ${rule}`;
  }
  return `it draws ${NOUNS[kind] ?? kind} with <${tag}>, as if it were ${NOUNS[drawn]}. ${rule}`;
}

const FRAMES: ReadonlySet<string> = new Set(["picture", "video", "audio"]);

const NOUNS: Readonly<Record<string, string>> = {
  image: "a photo",
  video: "a video",
  audio: "a sound",
  document: "a document",
} satisfies Record<FileFamily, string>;

/** How the Gate names a file of `kind` to the model. */
export function fileNoun(kind: string): string {
  return NOUNS[kind] ?? kind;
}

const PICTURES: ReadonlySet<string> = new Set(["img", "picture", "video"]);

/** Whether `markup` draws a media frame with no picture or video in it. */
export function drawsEmptyMediaFrame(markup: string): boolean {
  const open: { filled: boolean }[] = [];
  let empty = false;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (PICTURES.has(tag)) for (const frame of open) frame.filled = true;
        const classes = (element.getAttribute("class") ?? "").split(/\s+/);
        if (!classes.some((name) => name === "media-frame" || name.startsWith("media-frame--")))
          return;
        if (!element.canHaveContent) {
          empty ||= !PICTURES.has(tag);
          return;
        }
        const frame = { filled: false };
        open.push(frame);
        element.onEndTag(() => {
          open.splice(open.indexOf(frame), 1);
          empty ||= !frame.filled;
        });
      },
    })
    .transform(markup);
  return empty || open.some((frame) => !frame.filled);
}

const PDF_TYPE = "application/pdf";

const NAMING_ATTRIBUTES = ["alt", "title", "aria-label", "aria-description"] as const;

const SAYS_PDF = /\bPDFs?\b/gi;

/** Soft hyphens and zero-width characters, which split a word on the page without showing. */
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const INVISIBLE_REFERENCES = /&(?:shy|zwj|zwnj|ZeroWidthSpace|NoBreak);/g;

/** Elements that style the letters they hold and never set them apart, as a card's `span` does. */
const INLINE: ReadonlySet<string> = new Set([
  ...["b", "i", "em", "strong", "small", "abbr", "mark", "u", "s", "sub", "sup"],
  ...["code", "kbd", "q", "cite", "dfn", "var", "bdi", "bdo", "wbr"],
]);

/** Text as a person reads it: invisible characters gone, references decoded, spaces collapsed. */
function visible(text: string): string {
  const decoded = decodeAttributeValue(text.replace(INVISIBLE_REFERENCES, ""));
  return decoded.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** What `markup` says where a person reads it: each text run and element name. */
function saying(markup: string): string[] {
  const runs: string[] = [];
  let run = "";
  const end = () => {
    const said = visible(run);
    if (said !== "") runs.push(said);
    run = "";
  };
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const names = NAMING_ATTRIBUTES.map((name) => visible(element.getAttribute(name) ?? ""));
        runs.push(...names.filter((name) => name !== ""));
        if (INLINE.has(element.tagName.toLowerCase())) return;
        end();
        if (element.canHaveContent) element.onEndTag(end);
      },
      text(chunk) {
        run += chunk.text;
      },
    })
    .transform(markup);
  end();
  return runs;
}

/** A run that names another type beside PDF hints at what a field takes, as "PDF or Word" does. */
const NAMES_ANOTHER_TYPE = /\b(?:word|docx?|markdown|md|txt)\b/i;

/** How often `runs` call a file "PDF", leaving out runs that name another type too. */
function pdfLabels(runs: readonly string[]): number {
  const labels = (run: string) =>
    NAMES_ANOTHER_TYPE.test(run) ? 0 : (run.match(SAYS_PDF)?.length ?? 0);
  return runs.reduce((total, run) => total + labels(run), 0);
}

/** Past this many cells, runs are matched as a multiset rather than in order. */
const MAX_COMMON_CELLS = 1_000_000;

const weightOf = (run = "") => 1000 + pdfLabels([run]);

/**
 * `common[i][j]`: the heaviest sequence `said` from `i` and `other` from `j` share, each run
 * weighing one, and a run that says "PDF" a little more, so a tie keeps what says it shared.
 */
function commonWeights(said: readonly string[], other: readonly string[]): number[][] {
  const common = Array.from({ length: said.length + 1 }, () =>
    new Array<number>(other.length + 1).fill(0),
  );
  const at = (i: number, j: number) => common[i]?.[j] ?? 0;
  for (let i = said.length - 1; i >= 0; i--) {
    const weight = weightOf(said[i]);
    for (let j = other.length - 1; j >= 0; j--) {
      const row = common[i] ?? [];
      row[j] =
        said[i] === other[j] ? at(i + 1, j + 1) + weight : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return common;
}

/** The runs of `said` that `other` holds too, as a multiset. */
function sharedAnyOrder(said: readonly string[], other: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const run of other) left.set(run, (left.get(run) ?? 0) + 1);
  return said.filter((run) => {
    const count = left.get(run) ?? 0;
    left.set(run, count - 1);
    return count > 0;
  });
}

/** The runs of `said` that `other` shares too, by their heaviest common sequence. */
function shared(said: readonly string[], other: readonly string[]): string[] {
  if (said.length * other.length > MAX_COMMON_CELLS) return sharedAnyOrder(said, other);
  const common = commonWeights(said, other);
  const at = (i: number, j: number) => common[i]?.[j] ?? 0;
  /** From `i` and `j`: take both runs as shared, or pass the next run of `other` or of `said`. */
  const move = (i: number, j: number) => {
    if (said[i] === other[j] && at(i, j) === at(i + 1, j + 1) + weightOf(said[i])) return "take";
    return j < other.length && at(i, j + 1) === at(i, j) ? "other" : "said";
  };
  const kept: string[] = [];
  for (let i = 0, j = 0; i < said.length; ) {
    const next = move(i, j);
    if (next === "take") kept.push(said[i] ?? "");
    if (next !== "other") i++;
    if (next !== "said") j++;
  }
  return kept;
}

function projections(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

const isOtherDocument = (file: Record<string, unknown>) =>
  file.kind === "document" && file.mime !== PDF_TYPE;

/** `value` with each file `which` picks retyped as `mime`, the rest as they were. */
function retyped(value: unknown, which: (file: Record<string, unknown>) => boolean, mime: unknown) {
  const retype = (file: unknown) =>
    typeof file === "object" && file !== null && which(file as Record<string, unknown>)
      ? { ...file, mime }
      : file;
  return Array.isArray(value) ? value.map(retype) : retype(value);
}

/** `value` without its documents of another type than PDF: null when nothing else is left. */
function withoutOthers(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  const left = value.filter((file) => !projections(file).some(isOtherDocument));
  return left.length > 0 ? left : null;
}

/**
 * Whether the card says "PDF" in text it shows for this file whether it is a PDF or not, and only
 * with a file there. A render that throws says nothing.
 */
function callsItPdf(said?: string, empty?: string, pdf?: string): boolean {
  if (said === undefined) return false;
  const sameForAPdf = shared(saying(said), saying(pdf ?? ""));
  return pdfLabels(sameForAPdf) > pdfLabels(shared(sameForAPdf, saying(empty ?? "")));
}

/** Whether `record`'s card calls `field`'s documents of another type "PDF". */
function labelsAsPdf(
  record: Readonly<Record<string, unknown>>,
  field: string,
  render: (record: Readonly<Record<string, unknown>>) => string | undefined,
  emptyMayThrow: boolean,
): boolean {
  const value = record[field];
  const empty = render({ ...record, [field]: withoutOthers(value) });
  if (empty === undefined && !emptyMayThrow) return false;
  const pdf = render({ ...record, [field]: retyped(value, isOtherDocument, PDF_TYPE) });
  return callsItPdf(render(record), empty, pdf);
}

/**
 * Whether the card `render` draws calls a document "PDF" whose type is another's, held alone or
 * among several files. It is read as it is, and again with every other PDF the record holds
 * retyped, so a card that names those right is not read as naming this one; a card that throws
 * with the field empty is read only the second way. `render` answers undefined when it throws.
 */
export function mislabelledDocument(
  record: Readonly<Record<string, unknown>>,
  render: (record: Readonly<Record<string, unknown>>) => string | undefined,
): string | undefined {
  for (const [field, value] of Object.entries(record)) {
    const other = projections(value).find(isOtherDocument);
    if (!other) continue;
    const isPdf = (file: Record<string, unknown>) =>
      file.kind === "document" && !isOtherDocument(file);
    const retypedOthers = Object.fromEntries(
      Object.entries(record).map(([name, held]) => [
        name,
        name === field ? held : retyped(held, isPdf, other.mime),
      ]),
    );
    const asItIs = labelsAsPdf(record, field, render, false);
    if (!asItIs && !labelsAsPdf(retypedOthers, field, render, true)) continue;
    return `it says "PDF" for a document recorded as ${String(other.mime)}. Say "PDF" only when a document's \`mime\` is "${PDF_TYPE}", and "Document" for any other.`;
  }
  return undefined;
}
