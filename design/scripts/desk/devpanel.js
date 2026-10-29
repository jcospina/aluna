// @ts-check

/**
 * The developer panel's contents: the build's raw generation internals, each stage
 * as a code block.
 *
 * This is the one surface in Aluna that shows a payload rather than a product
 * sentence, and the one place `--font-mono` appears. What it does not get is an
 * imported editor theme. A code block here is built from the same parts as
 * everything else on the desk — a drawn frame, a well behind the text, and the
 * tint anchors already on the palette — so the panel reads as furniture in this
 * house rather than a terminal emulator someone dropped into it. `--signal` is
 * never among the tints: it is reserved for alerts, and nothing a read-only panel
 * reports is one.
 *
 * Each block's controls act on its own payload and nothing past it: fold the block,
 * read it pretty or raw, copy it, and show the latest one a selection is holding
 * back. How a payload reads is `devpanel-view.js`; what keys and a pointer do inside
 * a well is `devpanel-gestures.js`.
 *
 * Shared between the handbook's desk and the product's second window, because the
 * two must not drift: the panel is the surface a developer checks the product
 * against.
 */

import {
  BLOCK_SELECTOR,
  CODE_SELECTOR,
  dropHeld,
  holdUntilReleased,
  isHolding,
  keepPlace,
  letGo,
  PRE_SELECTOR,
  releaseHeld,
  rove,
  watchReading,
} from "./devpanel-gestures.js";
import {
  ELIDED_SELECTOR,
  element,
  FOLDED_CLASS,
  NODE_SELECTOR,
  plain,
  renderTree,
  TWIST_SELECTOR,
  tint,
} from "./devpanel-view.js";

/**
 * The eight stages, in the order a build reaches them: the key the panel files a
 * payload under, the caption its block carries, and the line a window narrates while
 * the stage is running.
 *
 * A new build sends metrics as it opens, then spec, migration, units, gate and commit,
 * and metrics again as it ends. An evolution sends spec, candidate, behavioral tests,
 * units and gate, then metrics and commit together at its end, so there the top block
 * fills last but one. Apart from that one order fills top to bottom for both, and it
 * puts the migration before the tests, which are frozen once their table exists.
 *
 * Records rather than tuples, for the reason `main.js` gives: a three-element array
 * of unlike things widens to a union on the way in.
 */
export const DEV_STAGES = [
  { key: "metrics", label: "Metrics", line: "Recent lifecycle metrics" },
  { key: "spec", label: "Spec", line: "Reading what you asked for" },
  { key: "candidate", label: "Candidate", line: "Drawing the shape of the data" },
  { key: "migration", label: "Migration", line: "Making room for it" },
  {
    key: "behavioral-tests",
    label: "Behavioral tests",
    line: "Writing what it must never get wrong",
  },
  { key: "units", label: "Units", line: "Building the pieces" },
  { key: "gate", label: "Gate", line: "Checking the whole thing" },
  { key: "commit", label: "Commit", line: "Putting it on the desk" },
];

/** What a stage shows before anything has arrived for it. */
export const RESTING_PAYLOAD = "—";

const SIZE_SELECTOR = ".devpanel__size";
const NAME_SELECTOR = ".devpanel__stage";
const STATUS_SELECTOR = ".devpanel__status";
const SAID_SELECTOR = ".devpanel__said";
const ACTION_SELECTOR = "[data-devpanel-action]";
const FORMAT_SELECTOR = '[data-devpanel-action="format"]';
const FILLED_CLASS = "is-filled";

const FORMAT_LABEL = "Pretty";
const LATEST_LABEL = "Show latest";
const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";
/* Short enough to fit where Copied does, so the caption never moves; the status says it fully. */
const FAILED_LABEL = "Failed";
const NOT_COPIED_SPOKEN = "Couldn’t copy";
const SAID_FOR_MS = 1500;

const BYTES_IN_KB = 1024;
/** Above this many kB, a tenth of a kB is noise rather than information. */
const WHOLE_KB_ABOVE = 10;

/**
 * What a block holds beyond its markup: the payload as it arrived, what it parsed to
 * (`null` when it is not JSON), which reading the reader chose, and the folds they made
 * in it. The reading survives a new build; the folds belong to one payload's shape and
 * do not.
 *
 * @typedef {{ raw: string, parsed: { value: unknown } | null, pretty: boolean,
 *             folded: Set<string> }} Reading
 */

/** @type {WeakMap<HTMLElement, Reading>} */
const readings = new WeakMap();

/** @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
const saying = new WeakMap();

/** Counted so two panels on one page never share an id. */
let panels = 0;

/**
 * @param {HTMLElement} block
 * @returns {Reading}
 */
function readingOf(block) {
  const known = readings.get(block);
  if (known) return known;
  /** @type {Reading} */
  const fresh = { raw: "", parsed: null, pretty: true, folded: new Set() };
  readings.set(block, fresh);
  return fresh;
}

/**
 * How big the payload was on the wire, for the caption. Measured in bytes rather
 * than characters, because that is what was actually sent.
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatPayloadSize(raw) {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes < BYTES_IN_KB) return `${bytes} B`;
  const kb = bytes / BYTES_IN_KB;
  return `${kb < WHOLE_KB_ABOVE ? kb.toFixed(1) : Math.round(kb)} kB`;
}

/**
 * A control on one block, named for what it does and for the stage it does it to, so eight
 * Copy buttons are eight different names to a screen reader.
 *
 * @param {string} className
 * @param {string} action
 * @param {string} id the block's well
 * @param {string} [text]
 */
function control(className, action, id, text) {
  const button = element("button", className, text);
  button.setAttribute("type", "button");
  button.setAttribute("id", `${id}-${action}`);
  button.dataset.devpanelAction = action;
  if (text) button.setAttribute("aria-labelledby", `${id}-${action} ${id}-name`);
  return button;
}

/**
 * Copy, whose word changes after a copy. The widest word it can say stands unseen in the same
 * place, so the button is that wide from the start and nothing beside it moves.
 *
 * @param {string} id
 */
function copyControl(id) {
  const button = control("devpanel__tool", "copy", id);
  const room = element("span", "devpanel__room", COPIED_LABEL);
  room.setAttribute("aria-hidden", "true");
  button.append(element("span", "devpanel__said", COPY_LABEL), room);
  button.setAttribute("aria-labelledby", `${id}-copy ${id}-name`);
  return button;
}

/**
 * One stage's block: a caption that folds it, the payload's size, the reader's controls,
 * and the well. Show latest stands in the well's corner, and only while a selection holds a
 * newer payload back, so the caption is the same height whether it is there or not.
 *
 * @param {{ key: string, label: string, line: string }} stage
 * @param {string} id
 */
function stageBlock({ key, label, line }, id) {
  const block = element("div", "devpanel__block");
  block.dataset.stage = key;
  block.dataset.ink = "";

  const name = element("b", "devpanel__stage", label);
  name.setAttribute("id", `${id}-name`);
  const fold = control("devpanel__fold", "fold", id);
  fold.setAttribute("aria-expanded", "true");
  fold.setAttribute("aria-controls", id);
  fold.append(name);

  const tools = element("span", "devpanel__tools");
  tools.append(control("devpanel__tool", "format", id, FORMAT_LABEL), copyControl(id));

  const head = element("div", "devpanel__head");
  head.append(fold, element("span", "devpanel__size"), tools);

  const pre = element("pre", "devpanel__pre");
  pre.setAttribute("id", id);
  /* A scroller the keyboard can reach, and the focus ⌘A reads to know which block it means. */
  pre.setAttribute("tabindex", "0");
  pre.setAttribute("role", "region");
  pre.setAttribute("aria-labelledby", `${id}-name`);
  /* The product-voice line for this stage, reachable but never printed here:
   * the panel stands outside that voice, and the tooltip is the one place the
   * two readings of the same moment can be held side by side. */
  pre.title = line;
  pre.append(element("code", "devpanel__code", RESTING_PAYLOAD));

  const corner = element("div", "devpanel__corner");
  corner.append(control("devpanel__latest", "latest", id, LATEST_LABEL));
  const well = element("div", "devpanel__well");
  well.append(corner, pre);
  block.append(head, well);
  return block;
}

/**
 * The panel's body: eight code blocks, all present from the start and all resting.
 *
 * All eight rather than only the ones that have arrived, because the set is the
 * information — a build that never reached the Gate is legible only if the Gate's
 * block is standing there empty. Each block asks the ink system for its frame by
 * name (`data-ink`), so the boundary around a payload is drawn like every other
 * boundary on the desk.
 *
 * @returns {HTMLElement}
 */
export function devPanelBody() {
  panels += 1;
  const shell = element("div", "devpanel");
  for (const stage of DEV_STAGES) {
    shell.append(stageBlock(stage, `devpanel-${panels}-${stage.key}`));
  }
  const status = element("span", "devpanel__status");
  status.setAttribute("role", "status");
  shell.append(status);
  shell.addEventListener("click", press);
  watchReading(shell, foldNode);
  return shell;
}

/** @param {Event} event */
function press(event) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const block = target?.closest(BLOCK_SELECTOR);
  if (!target || !(block instanceof HTMLElement)) return;

  /* A folded node's count is the larger thing to hit, so it opens the node as its twist does. */
  const twisted = target.closest(TWIST_SELECTOR) ?? target.closest(ELIDED_SELECTOR);
  const node = twisted?.closest(NODE_SELECTOR);
  if (node instanceof HTMLElement) {
    foldNode(node, node.classList.contains(FOLDED_CLASS));
    return;
  }

  const pressed = target.closest(ACTION_SELECTOR);
  if (!(pressed instanceof HTMLElement)) return;
  const action = pressed.dataset.devpanelAction;
  if (action === "fold") foldBlock(block, pressed);
  if (action === "format") reformat(block);
  if (action === "copy") copy(block, pressed);
  if (action === "latest") {
    letGo();
    show(block);
    /* The button goes with the hold, so the reader is put back in the well they were reading. */
    /** @type {HTMLElement | null} */ (block.querySelector(PRE_SELECTOR))?.focus({
      preventScroll: true,
    });
  }
}

/** @param {HTMLElement} block */
const nameOf = (block) => block.querySelector(NAME_SELECTOR)?.textContent ?? "";

/**
 * Open or close one object, array or multi-line string in a pretty payload, and keep
 * that for the next time the same stage is rewritten.
 *
 * @param {HTMLElement} node
 * @param {boolean} open
 */
function foldNode(node, open) {
  const block = node.closest(BLOCK_SELECTOR);
  if (!(block instanceof HTMLElement)) return;
  const { folded } = readingOf(block);
  const path = node.dataset.path ?? "";
  if (open) folded.delete(path);
  else folded.add(path);
  if (open) node.classList.remove(FOLDED_CLASS);
  else node.classList.add(FOLDED_CLASS);
  const twist = node.querySelector(TWIST_SELECTOR);
  twist?.setAttribute("aria-expanded", String(open));
  /* Closing can hide the fold Tab was holding; this one is always still standing. */
  if (twist) rove(twist);
}

/**
 * @param {HTMLElement} block
 * @param {HTMLElement} fold
 */
function foldBlock(block, fold) {
  const open = fold.getAttribute("aria-expanded") !== "true";
  fold.setAttribute("aria-expanded", String(open));
  const pre = block.querySelector(PRE_SELECTOR);
  if (open) pre?.removeAttribute("hidden");
  else pre?.setAttribute("hidden", "");
  /* A closed block shows nothing to hold still for, so anything waiting comes in. */
  releaseHeld();
}

/** @param {HTMLElement} block */
function reformat(block) {
  const reading = readingOf(block);
  reading.pretty = !reading.pretty;
  show(block);
}

/**
 * Copy what the well is showing, in the reading it is shown in, folds and all opened.
 *
 * @param {HTMLElement} block
 * @param {HTMLElement} button
 */
async function copy(block, button) {
  const code = block.querySelector(CODE_SELECTOR);
  if (!readingOf(block).raw || !code) return;
  try {
    await navigator.clipboard.writeText(code.textContent ?? "");
    say(button, COPIED_LABEL, COPIED_LABEL);
  } catch {
    say(button, FAILED_LABEL, NOT_COPIED_SPOKEN);
  }
}

/**
 * Say how the copy went on the button, and to a screen reader through the panel's status. The
 * status is the panel's one line, so a copy clears only what it said there itself.
 *
 * @param {HTMLElement} button
 * @param {string} shown
 * @param {string} spoken
 */
function say(button, shown, spoken) {
  const block = /** @type {HTMLElement} */ (button.closest(BLOCK_SELECTOR));
  const status = block.parentElement?.querySelector(STATUS_SELECTOR);
  const said = button.querySelector(SAID_SELECTOR);
  const heard = `${spoken}: ${nameOf(block)}`;
  if (said) said.textContent = shown;
  if (status) status.textContent = heard;
  clearTimeout(saying.get(button));
  saying.set(
    button,
    setTimeout(() => {
      if (said) said.textContent = COPY_LABEL;
      if (status?.textContent === heard) status.textContent = "";
    }, SAID_FOR_MS),
  );
}

/**
 * Put a block's payload in its well, in the reading the reader chose. Only JSON has
 * two readings; anything else is shown as it arrived and offers no choice.
 *
 * @param {HTMLElement} block
 */
function show(block) {
  const code = block.querySelector(CODE_SELECTOR);
  if (!(code instanceof HTMLElement)) return;
  const { raw, parsed, pretty, folded } = readingOf(block);
  const focused = code.contains(document.activeElement);
  dropHeld(block);
  if (!parsed) plain(code, raw);
  else if (!pretty) tint(code, raw);
  else drawTree(code, parsed.value, folded, block);
  /* A fold that held focus and is gone, read raw now, hands it back to its well. */
  if (focused && !code.contains(document.activeElement)) {
    /** @type {HTMLElement | null} */ (block.querySelector(PRE_SELECTOR))?.focus({
      preventScroll: true,
    });
  }

  /* The size of what the well shows, which a held block keeps until it shows the newer one. */
  const size = block.querySelector(SIZE_SELECTOR);
  if (size instanceof HTMLElement) size.textContent = formatPayloadSize(raw);
  const format = block.querySelector(FORMAT_SELECTOR);
  format?.setAttribute("aria-pressed", String(pretty));
  if (parsed) format?.removeAttribute("hidden");
  else format?.setAttribute("hidden", "");
}

/**
 * The pretty reading, or the raw one when the payload cannot be drawn as a tree: nested deeper
 * than the stack allows, or holding a key the page cannot take apart. Showing a payload never
 * fails because one reading of it did.
 *
 * @param {HTMLElement} code
 * @param {unknown} value
 * @param {ReadonlySet<string>} folded
 * @param {HTMLElement} block
 */
function drawTree(code, value, folded, block) {
  try {
    keepPlace(code, () => renderTree(code, value, folded, nameOf(block)));
  } catch {
    tint(code, readingOf(block).raw);
  }
}

/**
 * File one stage's payload. Returns whether there was a block to file it under, so
 * a caller can tell a stage it does not carry from one it simply has not mounted.
 *
 * @param {ParentNode} root
 * @param {string} key
 * @param {string} raw
 * @returns {boolean}
 */
export function writeStage(root, key, raw) {
  const block = root.querySelector(`${BLOCK_SELECTOR}[data-stage="${CSS.escape(key)}"]`);
  if (!(block instanceof HTMLElement)) return false;
  if (!(block.querySelector(CODE_SELECTOR) instanceof HTMLElement)) return false;

  const reading = readingOf(block);
  reading.raw = raw;
  try {
    reading.parsed = { value: JSON.parse(raw) };
  } catch {
    reading.parsed = null;
  }

  block.classList.add(FILLED_CLASS);
  if (isHolding(block)) holdUntilReleased(block, () => show(block));
  else show(block);
  return true;
}

/**
 * Every block back to resting. A new build starts from an empty panel rather than
 * from the last one's leavings, which is the difference between reading a build and
 * reading two builds at once.
 *
 * @param {ParentNode} root
 */
export function clearStages(root) {
  for (const block of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (!(block instanceof HTMLElement)) continue;
    block.classList.remove(FILLED_CLASS);
    dropHeld(block);
    const reading = readingOf(block);
    reading.raw = "";
    reading.parsed = null;
    reading.folded.clear();
    const code = block.querySelector(CODE_SELECTOR);
    if (code instanceof HTMLElement) plain(code, RESTING_PAYLOAD);
    const size = block.querySelector(SIZE_SELECTOR);
    if (size instanceof HTMLElement) size.textContent = "";
  }
}
