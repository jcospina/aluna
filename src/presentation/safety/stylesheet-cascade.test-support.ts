// The `display` one stylesheet gives an element of the DOM double: the rules whose last compound
// names the element's class, matched against the tree and cascaded by specificity, then source
// order. It reads only the syntax `public/css/collection.css` writes those rules in and refuses
// anything else, so a rule it cannot read fails the test that asked instead of passing as a rule
// that did not match. A rule reaching the element some other way, or from another stylesheet, is
// out of its sight.

import type { El } from "../controls/double/choice-picker.test-support.ts";

interface Compound {
  readonly matches: (node: El) => boolean;
  readonly specificity: number;
}

type Combinator = " " | "~";

interface Complex {
  readonly compounds: readonly Compound[];
  readonly combinators: readonly Combinator[];
  readonly specificity: number;
}

interface Declaration {
  readonly specificity: number;
  readonly value: string;
}

type Reader = (rest: string) => readonly [Compound, number] | null;

/** What the user agent draws an element as when no author rule decides, or one reverts to it. */
const USER_AGENT_DISPLAY: Readonly<Record<string, string>> = { p: "block" };

/** Values that defer to something other than the user agent, which this does not model. */
const UNREAD_VALUES = ["inherit", "initial", "unset", "revert-layer"];

const elementChildren = (node: El): El[] => node.children.filter((child) => child.tag !== "#text");

const readClass: Reader = (rest) => {
  const name = /^\.([a-zA-Z0-9_-]+)/.exec(rest)?.[1];
  if (name === undefined) return null;
  return [{ matches: (node) => node.classList.contains(name), specificity: 1 }, name.length + 1];
};

const readAttribute: Reader = (rest) => {
  const found = /^\[([a-zA-Z0-9_-]+)="([^"]*)"\]/.exec(rest);
  if (!found) return null;
  const [whole, name, value] = found as unknown as [string, string, string];
  return [{ matches: (node) => node.getAttribute(name) === value, specificity: 1 }, whole.length];
};

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return index;
  }
  throw new SyntaxError(`unclosed parenthesis in "${text}"`);
}

const holdsMatch = (node: El, compound: Compound): boolean =>
  elementChildren(node).some((child) => compound.matches(child) || holdsMatch(child, compound));

/** `:not(x)` and `:has(x)` over one compound, each weighing what its argument weighs. */
const readFunctional: Reader = (rest) => {
  const name = /^:(not|has)\(/.exec(rest)?.[1];
  if (name === undefined) return null;
  const open = name.length + 1;
  const close = closingParen(rest, open);
  const argument = parseCompound(rest.slice(open + 1, close).trim());
  const matches =
    name === "not"
      ? (node: El) => !argument.matches(node)
      : (node: El) => holdsMatch(node, argument);
  return [{ matches, specificity: argument.specificity }, close + 1];
};

const READERS: readonly Reader[] = [readClass, readAttribute, readFunctional];

function readSimple(rest: string): readonly [Compound, number] {
  for (const reader of READERS) {
    const read = reader(rest);
    if (read) return read;
  }
  throw new SyntaxError(`unread selector syntax at "${rest}"`);
}

function parseCompound(text: string): Compound {
  if (text === "*") return { matches: () => true, specificity: 0 };
  if (text === "") throw new SyntaxError("an empty compound selector");
  const parts: Compound[] = [];
  for (let index = 0; index < text.length; ) {
    const [part, length] = readSimple(text.slice(index));
    parts.push(part);
    index += length;
  }
  return {
    matches: (node) => parts.every((part) => part.matches(node)),
    specificity: parts.reduce((sum, part) => sum + part.specificity, 0),
  };
}

function nesting(character: string): number {
  if (character === "[" || character === "(") return 1;
  if (character === "]" || character === ")") return -1;
  return 0;
}

/** A selector's compounds and its `~` combinators, split outside brackets and parentheses. */
function tokens(selector: string): string[] {
  const found: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of selector) {
    depth += nesting(character);
    if (depth > 0 || !/[\s~]/.test(character)) {
      current += character;
      continue;
    }
    found.push(current, character);
    current = "";
  }
  found.push(current);
  return found.filter((token) => token.trim() !== "");
}

function parseComplex(parts: readonly string[]): Complex {
  const compounds: Compound[] = [];
  const combinators: Combinator[] = [];
  let pending: Combinator = " ";
  for (const part of parts) {
    if (part === "~") {
      pending = "~";
      continue;
    }
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(parseCompound(part));
    pending = " ";
  }
  return {
    compounds,
    combinators,
    specificity: compounds.reduce((sum, compound) => sum + compound.specificity, 0),
  };
}

function candidates(node: El, combinator: Combinator): El[] {
  if (combinator === "~") {
    const siblings = node.parent ? elementChildren(node.parent) : [];
    return siblings.slice(0, siblings.indexOf(node));
  }
  const ancestors: El[] = [];
  for (let next = node.parent; next; next = next.parent) ancestors.push(next);
  return ancestors;
}

function matchesFrom(complex: Complex, index: number, node: El): boolean {
  if (!complex.compounds[index]?.matches(node)) return false;
  if (index === 0) return true;
  const combinator = complex.combinators[index - 1] as Combinator;
  return candidates(node, combinator).some((next) => matchesFrom(complex, index - 1, next));
}

/** Every top-level block in source order, its prelude cut after any statement before it. */
function blocks(css: string): { prelude: string; body: string }[] {
  const found: { prelude: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === "{") {
      if (depth === 0) open = index;
      depth += 1;
    }
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth > 0) continue;
    const prelude = css.slice(start, open);
    const head = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
    found.push({ prelude: head, body: css.slice(open + 1, index) });
    start = index + 1;
  }
  return found;
}

/** The specificity of each of `prelude`'s selectors that is about the subject and matches `node`. */
function matchingSpecificities(prelude: string, node: El, subject: RegExp): number[] {
  return prelude
    .split(",")
    .map(tokens)
    .filter((parts) => subject.test(parts.at(-1) ?? ""))
    .map(parseComplex)
    .filter((complex) => matchesFrom(complex, complex.compounds.length - 1, node))
    .map((complex) => complex.specificity);
}

/** The last `display` a body declares, as a browser takes it: a plain keyword, or refused. */
function displayIn(body: string): string | null {
  const declared = [...body.matchAll(/(?:^|;)\s*display\s*:\s*([^;]+)/g)].at(-1)?.[1]?.trim();
  if (declared === undefined) return null;
  if (!/^[a-z-]+$/.test(declared) || UNREAD_VALUES.includes(declared)) {
    throw new Error(`unread display value: ${declared}`);
  }
  return declared;
}

function declarationsFor(css: string, node: El, subject: RegExp): Declaration[] {
  return blocks(css).flatMap(({ prelude, body }) => {
    if (body.includes("{") && subject.test(body)) {
      throw new Error(`a rule inside another decides the subject: ${prelude}`);
    }
    const specificities = matchingSpecificities(prelude, node, subject);
    if (specificities.length === 0) return [];
    if (body.includes("{")) throw new Error(`a rule about the subject holds another: ${prelude}`);
    const value = displayIn(body);
    return value === null ? [] : specificities.map((specificity) => ({ specificity, value }));
  });
}

/**
 * The `display` the stylesheet `css`, its comments already out (`rules()` in `source.test-support.ts`),
 * gives `node`, whose class is `subjectClass`. Of equal specificity, the later rule wins.
 */
export function cascadedDisplay(css: string, node: El, subjectClass: string): string {
  const agent = USER_AGENT_DISPLAY[node.tag];
  if (agent === undefined) throw new Error(`no user-agent display known for <${node.tag}>`);
  const subject = new RegExp(`\\.${subjectClass}(?![\\w-])`);
  const winner = declarationsFor(css, node, subject).reduce<Declaration | null>(
    (held, next) => (held === null || next.specificity >= held.specificity ? next : held),
    null,
  );
  return winner === null || winner.value === "revert" ? agent : winner.value;
}
