// Taking one id out of an answer, and leaving the sentence round it reading as one (ADR-0010).
//
// The cut grows past the id only over what pointed at it and now points at nothing: a bracket or
// quote it stood alone inside, a mark leading into it, a path it ended. It never grows over a word
// or a list marker, so the worst a cut does to her prose is leave a mark it could not account for.

/** Brackets and quotes that only ever open, with what closes each. */
const CLOSES: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
  "“": "”",
  "‘": "’",
  "«": "»",
  "（": "）",
  "「": "」",
  "『": "』",
  "【": "】",
  "〈": "〉",
  "《": "》",
};
/** Marks that open and close alike, so they pair only when they touch the id on both sides. */
const SYMMETRIC = /^["'`*_]$/;
/** Marks that lead into what follows them. */
const LEADS_IN = /^[,;:#\-–—：，；、]$/;
/** What ends a sentence, which an opening bracket the id was alone inside goes before. */
const ENDS = /^[.!?\n。！？]$/;
/** What a space never goes before. */
const STOPS = /^[,.;:!?)\]}>»）」』】〉》：，；、。！？]$/;
const SPACE = /^[^\S\n]$/;
const A_LETTER = /^[\p{L}\p{M}\p{N}]$/u;
/** A list item's marker, alone at the start of its line. */
const LIST_MARKER = /(?:^|\n)[^\S\n]*(?:[-*•]|\d+[.)])$/;
/** Characters a URL is written in, walked back over from a slash an id followed. */
const IN_A_URL = /^[A-Za-z0-9\-._~%:@!$&*+,;=/?#]$/;
const A_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const WORDLIKE = /^[\p{L}\p{M}\p{N}]$/u;
/** Scripts written without spaces, where any two characters may sit inside one name or apart. */
const UNSPACED =
  /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]$/u;

/** Whether two neighbouring characters belong to one word, a combining mark counting as part of one. */
export function oneWord(first: string | undefined, second: string | undefined): boolean {
  if (first === undefined || second === undefined) return false;
  if (!WORDLIKE.test(first) || !WORDLIKE.test(second)) return false;
  return !(UNSPACED.test(first) && UNSPACED.test(second));
}

const opens = (character: string) => CLOSES[character] !== undefined;

/** Where the spaces next to `at` end, walking left (`-1`) or right (`1`). */
function spacesFrom(text: string, at: number, step: -1 | 1): number {
  let edge = at;
  const next = () => (step === -1 ? text[edge - 1] : text[edge]);
  while (SPACE.test(next() ?? "\n")) edge += step;
  return edge;
}

/** Whether `left` sits right after a list item's marker. */
function afterAListMarker(text: string, left: number): boolean {
  return LIST_MARKER.test(text.slice(Math.max(0, left - 12), left));
}

/** Where a cut stands: the id's span, and the spaces and characters either side of it. */
interface Site {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly left: number;
  readonly right: number;
  readonly before: string;
  readonly after: string;
}

type Span = readonly [number, number];

/** A quote, backtick or emphasis touching the id on both sides. */
const markedAlone = ({ text, from, to }: Site): Span | undefined => {
  const touching = text[from - 1];
  return touching !== undefined && SYMMETRIC.test(touching) && text[to] === touching
    ? [from - 1, to + 1]
    : undefined;
};

/** A bracket it stood alone inside, or one it alone followed before a sentence's end. */
const bracketedAlone = ({ left, right, before, after }: Site): Span | undefined => {
  if (!opens(before)) return undefined;
  if (CLOSES[before] === after) return [left - 1, right + 1];
  return ENDS.test(after) ? [left - 1, right] : undefined;
};

/** A mark after it that led from it into the rest, where nothing came before it. */
const leadingOnward = ({ text, from, left, right, before, after }: Site): Span | undefined => {
  const starts = before === "\n" || opens(before) || afterAListMarker(text, left);
  return starts && LEADS_IN.test(after) ? [from, right + 1] : undefined;
};

/** A mark before it that led into it, where nothing comes after it. */
const leadingIn = ({ text, left, right, before, after }: Site): Span | undefined => {
  const nothingAfter = after === "\n" || STOPS.test(after) || after === before;
  return LEADS_IN.test(before) && !afterAListMarker(text, left) && nothingAfter
    ? [left - 1, right]
    : undefined;
};

/** A path the id ended, or only the slash where a word stood before it. */
const ended = ({ text, to, left, before }: Site): Span | undefined =>
  before === "/" ? [pathStart(text, left - 1), to] : undefined;

const GROWTHS = [markedAlone, bracketedAlone, leadingOnward, leadingIn, ended];

function siteOf(text: string, from: number, to: number): Site {
  const left = spacesFrom(text, from, -1);
  const right = spacesFrom(text, to, 1);
  return {
    text,
    from,
    to,
    left,
    right,
    before: text[left - 1] ?? "\n",
    after: text[right] ?? "\n",
  };
}

/**
 * Where the path ending at `slash` starts: at its scheme, at the start of a path standing alone in
 * a bracket, and otherwise at its first slash, so a word written before a path is never taken.
 */
function pathStart(text: string, slash: number): number {
  let start = slash;
  while (start > 0 && IN_A_URL.test(text[start - 1] ?? " ")) start -= 1;
  const token = text.slice(start, slash + 1);
  const scheme = token.search(A_SCHEME);
  if (scheme !== -1) return start + scheme;
  return opens(text[start - 1] ?? "") ? start : start + token.indexOf("/");
}

/**
 * Whether no space belongs where the cut closed up. A straight quote closes when no letter follows
 * it and opens when none comes before it, and an apostrophe is a quote with a letter after it.
 */
function tight({ text, left, right, before, after }: Site): boolean {
  if (before === "\n" || after === "\n" || opens(before) || STOPS.test(after)) return true;
  const beyond = text[right + 1] ?? "\n";
  if (after === '"') return !A_LETTER.test(beyond);
  if (after === "'" || after === "\u2019") return A_LETTER.test(beyond);
  return before === '"' && !A_LETTER.test(text[left - 2] ?? "\n");
}

/** The character on either side of `left..right`, read whole. */
function neighbours(
  text: string,
  left: number,
  right: number,
): readonly [string | undefined, string | undefined] {
  return [
    [...text.slice(Math.max(0, left - 2), left)].at(-1),
    [...text.slice(right, right + 2)][0],
  ];
}

/**
 * `text` with `from..right` gone and `room` in its place. A Markdown link whose address went
 * keeps its name and loses the brackets round it.
 */
function closedUp(text: string, from: number, left: number, right: number, room: string): string {
  const opened =
    text[from] === "(" && text[from - 1] === "]" ? text.lastIndexOf("[", from - 2) : -1;
  const name = opened === -1 ? "" : text.slice(opened + 1, from - 1);
  if (opened === -1 || /[[\]\n]/.test(name)) {
    return `${text.slice(0, left)}${room}${text.slice(right)}`;
  }
  return `${text.slice(0, opened)}${name}${room}${text.slice(right)}`;
}

/** `text` without `from..to`, grown over what pointed at it, with the room it leaves tidied. */
export function cut(text: string, from: number, to: number): string {
  const site = siteOf(text, from, to);
  for (const growth of GROWTHS) {
    const wider = growth(site);
    if (wider !== undefined) return cut(text, wider[0], wider[1]);
  }
  const spaced = site.left < from || site.right > to;
  const [before, after] = neighbours(text, site.left, site.right);
  const room = (spaced && !tight(site)) || oneWord(before, after) ? " " : "";
  return closedUp(text, from, site.left, site.right, room);
}
