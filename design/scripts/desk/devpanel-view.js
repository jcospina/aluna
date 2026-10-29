// @ts-check

/**
 * How a stage's payload reads in its well: as it arrived, or pretty-printed.
 *
 * Raw is the payload byte for byte, tinted. Pretty is JSON a line to a member, every object,
 * array and multi-line string foldable, and a string that carries line breaks — a unit's source,
 * a migration's SQL — set out as the lines it holds rather than as one escaped run. A payload that
 * is not JSON has one reading only, and is shown as it arrived.
 *
 * Pretty is laid out by the sheet rather than by spaces, so a value too long for its line wraps
 * under itself instead of back to the well's left edge. The spaces and line breaks are still in
 * the text, in spans the sheet hides, so anything that copies the well's text copies the
 * two-space indent.
 *
 * Built as nodes rather than markup: a payload is data from a build, and the one safe way to put
 * data on a page is to never let it be parsed as anything else.
 */

/**
 * One JSON token per match: a string, carrying the colon that would make it a key;
 * a literal; a number; or punctuation. Whatever the pattern does not claim is
 * whitespace, which rides through between matches untinted.
 */
const JSON_TOKEN =
  /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

export const NODE_SELECTOR = ".devpanel__node";
export const TWIST_SELECTOR = ".devpanel__twist";
export const ELIDED_SELECTOR = ".devpanel__elided";
export const FOLDED_CLASS = "is-folded";
const TREE_CLASS = "is-tree";
/**
 * What the new tree holds where a string's lines have not changed since the well last drew them:
 * an empty block of the same kind, which tells the update to leave the drawn one alone. It keeps
 * the text it stands for, and is filled with its lines if it lands where none were drawn.
 */
const KEPT_CLASS = "devpanel__lines";

/** @type {WeakMap<Element, { text: string, comma: boolean }>} */
const standing = new WeakMap();

/**
 * @param {string} text
 * @param {boolean} comma
 */
function standIn(text, comma) {
  const stand = element("span", KEPT_CLASS);
  standing.set(stand, { text, comma });
  return stand;
}

/**
 * Fill every stand-in under a node about to go into the well, where nothing drawn is kept.
 *
 * @param {ChildNode} node
 */
function fillStandIns(node) {
  if (!(node instanceof Element)) return;
  for (const stand of [node, ...node.querySelectorAll(`.${KEPT_CLASS}`)]) {
    const kept = standing.get(stand);
    if (kept && stand.childNodes.length === 0) {
      stand.append(...lines(kept.text, kept.comma).childNodes);
    }
  }
}
const INDENT = "  ";
/**
 * How deep a tree is drawn. Each step is a few boxes nested in the last, and a browser's layout
 * gives out somewhere past two hundred of them, taking the tab with it; no stage nests a tenth as
 * deep, so past this the payload is read raw.
 */
const DEEPEST = 100;

/**
 * Which tint a token wears. Read off the first character, which is enough to
 * separate all five kinds once the pattern above has already decided where each
 * token starts and ends.
 *
 * @param {string} token
 * @returns {string}
 */
function tokenKind(token) {
  const first = token[0] ?? "";
  if (first === '"') return token.endsWith(":") ? "key" : "string";
  if (first === "t" || first === "f" || first === "n") return "atom";
  if (first === "-" || (first >= "0" && first <= "9")) return "number";
  return "punct";
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function element(tag, className, text = "") {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * @param {string} kind
 * @param {string} text
 */
const tinted = (kind, text) => element("span", `devpanel__${kind}`, text);

/**
 * Text that is in the payload's copy but not on screen: the line breaks and the indent.
 *
 * @param {string} text
 */
const unseen = (text) => element("span", "devpanel__unseen", text);

/**
 * The payload as it arrived, a span per token — all of it, however long it is. Measured against
 * what the stream sends, a 27,000-character metrics payload tints in 15ms and a 99kB units payload
 * in 2.5ms; a colour that stopped partway down would leave the reader guessing. The tokens go in
 * under one span, so the page's mutation observers hear of one node rather than thousands.
 *
 * @param {HTMLElement} code
 * @param {string} text
 */
export function tint(code, text) {
  const out = document.createElement("span");
  let last = 0;
  JSON_TOKEN.lastIndex = 0;
  for (let match = JSON_TOKEN.exec(text); match !== null; match = JSON_TOKEN.exec(text)) {
    if (match.index > last) out.append(text.slice(last, match.index));
    out.append(tinted(tokenKind(match[0]), match[0]));
    last = match.index + match[0].length;
  }
  out.append(text.slice(last));
  code.classList.remove(TREE_CLASS);
  code.replaceChildren(out);
}

/**
 * Plain text, untinted, for a payload that is not JSON.
 *
 * @param {HTMLElement} code
 * @param {string} text
 */
export function plain(code, text) {
  code.classList.remove(TREE_CLASS);
  code.textContent = text;
}

/**
 * The payload pretty-printed, with its folds. Fully unfolded, its text is
 * `JSON.stringify(value, null, 2)` wherever no string spans lines.
 *
 * The well is updated where the new tree differs rather than replaced, so a fold being pressed,
 * the fold holding focus and the place being read all survive a live stage.
 *
 * @param {HTMLElement} code
 * @param {unknown} value
 * @param {ReadonlySet<string>} folded the paths the reader folded, kept across live rewrites
 * @param {string} label what the root fold is called, the stage's own name
 * @throws {RangeError} when the value nests deeper than a tree is drawn
 */
export function renderTree(code, value, folded, label) {
  if (depthOf(value) > DEEPEST) throw new RangeError("nested too deep to draw as a tree");
  const before = code.classList.contains(TREE_CLASS) ? drawn.get(code) : undefined;
  /** @type {Draw} */
  const draw = { folded, before: before ?? new Map(), after: new Map() };
  const out = document.createDocumentFragment();
  entry(out, { value, depth: 0, path: "", key: null, label, draw, comma: false });
  morphChildren(code, out);
  drawn.set(code, draw.after);
  code.classList.add(TREE_CLASS);
}

/**
 * The strings that span lines each well was last drawn with, by path. A live units stage rewrites
 * every unit's source on every send while only one of them is changing; the rest are left as
 * they stand rather than built again, line by line, to be thrown away.
 *
 * @type {WeakMap<HTMLElement, Map<string, string>>}
 */
const drawn = new WeakMap();

/**
 * @typedef {{ folded: ReadonlySet<string>, before: ReadonlyMap<string, string>,
 *             after: Map<string, string> }} Draw
 * @typedef {{ value: unknown, depth: number, path: string, key: string | null,
 *             label: string, draw: Draw, comma: boolean }} Entry
 */

/**
 * How many objects and arrays deep a value goes, walked without recursion so a value deep
 * enough to need asking cannot overflow the asking.
 *
 * @param {unknown} value
 */
function depthOf(value) {
  let deepest = 0;
  /** @type {[unknown, number][]} */
  const waiting = [[value, 0]];
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    const [each, depth] = next;
    if (each === null || typeof each !== "object") continue;
    deepest = Math.max(deepest, depth + 1);
    for (const member of Object.values(each)) waiting.push([member, depth + 1]);
  }
  return deepest;
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
const counted = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * @param {string} text
 */
function lineCount(text) {
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/**
 * One value, behind its key when it has one.
 *
 * @param {ParentNode} parent
 * @param {Entry} at
 */
function entry(parent, at) {
  const { value, depth, path, key, draw } = at;
  const head = key === null ? [] : [tinted("key", `${JSON.stringify(key)}:`), " "];
  const shape = shapeOf(value);
  if (shape === null) {
    parent.append(...head, leaf(value));
    return;
  }

  const node = element("span", "devpanel__node");
  node.dataset.path = path;
  const open = !draw.folded.has(path);
  if (!open) node.classList.add(FOLDED_CLASS);

  const twist = element("button", "devpanel__twist");
  twist.setAttribute("type", "button");
  twist.setAttribute("tabindex", "-1");
  twist.setAttribute("aria-expanded", String(open));
  twist.setAttribute("aria-label", at.label);

  const body = element("span", "devpanel__body");
  const elided = element("span", "devpanel__elided");
  elided.dataset.elided = shape.elided;
  node.append(twist, ...head, tinted(shape.kind, shape.open), body);
  if (typeof value === "string") fillString(body, elided, at);
  else {
    fillMembers(body, depth, membersOf(value, path), draw);
    node.append(unseen(`\n${INDENT.repeat(depth)}`), elided, tinted(shape.kind, shape.close ?? ""));
  }
  if (typeof value === "string") node.append(elided);
  parent.append(node);
}

/**
 * A string's lines, or a stand-in for them where the well already shows the same. Its comma ends
 * its last line of code rather than taking a row of its own under the block.
 *
 * @param {HTMLElement} body
 * @param {HTMLElement} elided
 * @param {Entry} at
 */
function fillString(body, elided, { value, path, draw, comma }) {
  const text = String(value);
  const drawnAs = `${comma ? "," : ""}${text}`;
  draw.after.set(path, drawnAs);
  body.append(draw.before.get(path) === drawnAs ? standIn(text, comma) : lines(text, comma));
  if (comma) elided.dataset.elided = `${elided.dataset.elided},`;
}

/**
 * @typedef {{ key: string | null, label: string, member: unknown, path: string }} Member
 */

/**
 * An object's properties or an array's items, each with the path its fold is kept under. Each
 * step is JSON-quoted, so no key can pass for another's path, whatever characters it holds.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {Member[]}
 */
function membersOf(value, path) {
  if (Array.isArray(value)) {
    return value.map((member, index) => ({
      key: null,
      label: `[${index}]`,
      member,
      path: `${path}/${index}`,
    }));
  }
  return Object.entries(/** @type {object} */ (value)).map(([name, member]) => ({
    key: name,
    label: name === "" ? '""' : name,
    member,
    path: `${path}/${JSON.stringify(name)}`,
  }));
}

/**
 * Each member on a line of its own.
 *
 * @param {HTMLElement} body
 * @param {number} depth
 * @param {Member[]} members
 * @param {Draw} draw
 */
function fillMembers(body, depth, members, draw) {
  members.forEach(({ key, label, member, path }, index) => {
    const line = element("span", "devpanel__line");
    /* Lines are kept by the member they hold, so a key arriving before a fold leaves the fold. */
    line.dataset.line = path;
    line.append(unseen(`\n${INDENT.repeat(depth + 1)}`));
    const comma = index < members.length - 1;
    entry(line, { value: member, depth: depth + 1, path, key, label, draw, comma });
    if (comma && shapeOf(member)?.kind !== "string") line.append(tinted("punct", ","));
    body.append(line);
  });
}

/**
 * What makes a value foldable, or `null` for one that sits on a single line: a non-empty object or
 * array, and a string that spans lines. `elided` is what the fold leaves showing when it is
 * closed, drawn by the sheet, never text, so no copy ever picks it up.
 *
 * @param {unknown} value
 * @returns {{ kind: string, open: string, close?: string, elided: string } | null}
 */
function shapeOf(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const elided = ` … ${counted(value.length, "item", "items")} `;
    return { kind: "punct", open: "[", close: "]", elided };
  }
  if (typeof value === "object" && value !== null) {
    const size = Object.keys(value).length;
    if (size === 0) return null;
    return { kind: "punct", open: "{", close: "}", elided: ` … ${counted(size, "key", "keys")} ` };
  }
  if (typeof value === "string" && value.includes("\n")) {
    const elided = `… ${counted(lineCount(value), "line", "lines")}"`;
    return { kind: "string", open: '"', elided };
  }
  return null;
}

/**
 * A string that spans lines, set out as those lines in a block of its own under its key. Each
 * line hangs from its own indent, so a line too long for the well wraps a step in from where it
 * began rather than at the depth of the next statement. The closing quote ends the last line, so
 * a string that ends on a line break shows its quote on a line of its own and one that does not
 * shows it after its last character.
 *
 * @param {string} text
 * @param {boolean} comma whether a separator follows the string, at the end of its last line
 */
function lines(text, comma) {
  const block = element("span", "devpanel__lines");
  block.append(...text.split("\n").map((line, index) => codeRow(line, index > 0)));
  const last = /** @type {HTMLElement} */ (block.lastChild);
  last.append(tinted("string", '"'));
  if (comma) last.append(tinted("punct", ","));
  return block;
}

/**
 * One line of code, its line break and indent kept as unseen text and its indent drawn.
 *
 * @param {string} line
 * @param {boolean} broken whether a line break comes before it
 */
function codeRow(line, broken) {
  const row = element("span", "devpanel__codeline");
  const lead = /^ */.exec(line)?.[0] ?? "";
  const before = `${broken ? "\n" : ""}${lead}`;
  if (before) row.append(unseen(before));
  if (lead) row.setAttribute("style", `--devpanel-lead: ${lead.length}`);
  row.append(line.slice(lead.length));
  return row;
}

/**
 * A value that sits on one line: an empty object or array, a one-line string, a number or a
 * literal.
 *
 * @param {unknown} value
 */
function leaf(value) {
  if (Array.isArray(value)) return tinted("punct", "[]");
  if (typeof value === "object" && value !== null) return tinted("punct", "{}");
  if (typeof value === "string") return tinted("string", JSON.stringify(value));
  if (typeof value === "number") return tinted("number", JSON.stringify(value));
  return tinted("atom", JSON.stringify(value));
}

/* ── updating a tree in place ────────────────────────────────────────────── */

/**
 * What a node is, for telling whether the old tree and the new one hold the same thing in the
 * same place: a fold by its path, anything else by its tag and class.
 *
 * @param {ChildNode} node
 */
function kindOf(node) {
  if (!(node instanceof HTMLElement)) return "#text";
  const { path, line } = node.dataset;
  if (path !== undefined) return `fold ${path}`;
  if (line !== undefined) return `line ${line}`;
  return `${node.tagName} ${node.className}`;
}

/**
 * Make `current`'s children match `fresh`'s, keeping every one that is the same kind of thing in
 * the same place and moving the new ones in where they differ.
 *
 * @param {Element} current
 * @param {Element | DocumentFragment} fresh
 */
function morphChildren(current, fresh) {
  const incoming = [...fresh.childNodes];
  /* A member's line is found by its member wherever it now stands, so one key added, renamed or
   * moved leaves the lines after it as they are rather than drawing every one of them again. */
  const lines = new Map();
  for (const child of current.childNodes) if (lineOf(child)) lines.set(lineOf(child), child);
  incoming.forEach((next, index) => {
    const here = current.childNodes[index];
    const key = lineOf(next);
    const kept = key ? lines.get(key) : sameKind(here, next);
    if (kept) {
      if (kept !== here) current.insertBefore(kept, here ?? null);
      lines.delete(key);
      morph(kept, next);
    } else {
      fillStandIns(next);
      current.insertBefore(next, here ?? null);
    }
  });
  while (current.childNodes.length > incoming.length) current.lastChild?.remove();
}

/** @param {ChildNode} node */
const lineOf = (node) => (node instanceof HTMLElement ? node.dataset.line : undefined);

/**
 * @param {ChildNode | undefined} here
 * @param {ChildNode} next
 */
const sameKind = (here, next) => (here && kindOf(here) === kindOf(next) ? here : undefined);

/**
 * Bring one kept node up to date. Text that has not changed is left as the same node, so the
 * page around a live stage does not move under the reader.
 *
 * @param {ChildNode} current
 * @param {ChildNode} fresh
 */
function morph(current, fresh) {
  const leaves = !(current instanceof Element) || !(fresh instanceof Element);
  if (!leaves) syncAttributes(current, fresh);
  if (!leaves && fresh.className === KEPT_CLASS && fresh.childNodes.length === 0) return;
  if (leaves || fresh.children.length === 0) {
    if (current.textContent !== fresh.textContent) current.textContent = fresh.textContent;
    return;
  }
  morphChildren(current, fresh);
}

/**
 * Bring a kept node's attributes over from its new self, and drop any only the old one had: a
 * line of code that has lost its indent has lost the style that drew it.
 *
 * @param {Element} current
 * @param {Element} fresh
 */
function syncAttributes(current, fresh) {
  for (const name of fresh.getAttributeNames()) {
    const value = fresh.getAttribute(name) ?? "";
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  for (const name of current.getAttributeNames()) {
    if (!fresh.hasAttribute(name)) current.removeAttribute(name);
  }
}
