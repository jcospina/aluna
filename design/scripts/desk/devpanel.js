// @ts-check

/**
 * The developer panel's contents: the build's raw generation internals, each stage
 * as a code block (D13).
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
 * Shared between the handbook's desk and the product's second window, because the
 * two must not drift: the panel is the surface a developer checks the product
 * against.
 */

/**
 * The eight stages, in the order they arrive: the key the panel files a payload
 * under, the caption its block carries, and the line a window narrates while the
 * stage is running.
 *
 * Records rather than tuples, for the reason `main.js` gives: a three-element array
 * of unlike things widens to a union on the way in.
 */
export const DEV_STAGES = [
  { key: "metrics", label: "Metrics", line: "Recent lifecycle metrics" },
  { key: "spec", label: "Spec", line: "Reading what you asked for" },
  { key: "candidate", label: "Candidate", line: "Drawing the shape of the data" },
  {
    key: "behavioral-tests",
    label: "Behavioral tests",
    line: "Writing what it must never get wrong",
  },
  { key: "migration", label: "Migration", line: "Making room for it" },
  { key: "units", label: "Units", line: "Building the pieces" },
  { key: "gate", label: "Gate", line: "Checking the whole thing" },
  { key: "commit", label: "Commit", line: "Putting it on the desk" },
];

/** What a stage shows before anything has arrived for it. */
export const RESTING_PAYLOAD = "—";

const BLOCK_SELECTOR = ".devpanel__block";
const CODE_SELECTOR = ".devpanel__code";
const SIZE_SELECTOR = ".devpanel__size";
const FILLED_CLASS = "is-filled";

/**
 * One JSON token per match: a string, carrying the colon that would make it a key;
 * a literal; a number; or punctuation. Whatever the pattern does not claim is
 * whitespace, which rides through between matches untinted.
 */
const JSON_TOKEN =
  /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

const BYTES_IN_KB = 1024;
/** Above this many kB, a tenth of a kB is noise rather than information. */
const WHOLE_KB_ABOVE = 10;

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
 * Pretty-print a payload, and say whether it turned out to be JSON. A stage that
 * one day sends plain text — a stack trace, a line of SQL on its own — still has
 * somewhere to land; it is shown as it arrived rather than tinted as something it
 * is not.
 *
 * @param {string} raw
 * @returns {{ text: string, json: boolean }}
 */
function prettyPrint(raw) {
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, 2), json: true };
  } catch {
    return { text: raw, json: false };
  }
}

/**
 * Tint one payload into `code`, a span per token — all of it, however long it is.
 *
 * There was a character budget here for a while, on the theory that a span per token
 * is too many elements for the units stage. Measured against what the stream actually
 * sends, the theory did not hold: the real metrics payload is 27,000 characters and
 * tints in 15ms, and a 99kB units payload in 2.5ms — a units file is mostly one long
 * string, which is the cheapest shape there is. What the budget bought instead was a
 * panel whose colour stopped partway down the very payload it exists to show. A
 * payload is either worth showing or it is not; one shown half-lit is neither.
 *
 * The cost is real but it is a long way from here: a synthetic 595kB of 20,000 tiny
 * objects is 220,000 spans and 680ms, roughly forty times denser in tokens than
 * anything the pipeline emits. If a stage ever gets near that, the answer is to say so
 * on the surface — a caption that admits what it is not showing — rather than to go
 * quiet halfway through and let the reader guess.
 *
 * Built as nodes rather than markup: a payload is data from a build, and the one safe
 * way to put data on a page is to never let it be parsed as anything else.
 *
 * @param {HTMLElement} code
 * @param {string} text
 */
function tint(code, text) {
  const out = document.createDocumentFragment();
  let last = 0;
  JSON_TOKEN.lastIndex = 0;
  for (let match = JSON_TOKEN.exec(text); match !== null; match = JSON_TOKEN.exec(text)) {
    if (match.index > last) out.append(text.slice(last, match.index));
    const span = document.createElement("span");
    span.className = `devpanel__${tokenKind(match[0])}`;
    span.textContent = match[0];
    out.append(span);
    last = match.index + match[0].length;
  }
  out.append(text.slice(last));
  code.replaceChildren(out);
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
  const shell = document.createElement("div");
  shell.className = "devpanel";
  for (const { key, label, line } of DEV_STAGES) {
    const block = document.createElement("div");
    block.className = "devpanel__block";
    block.dataset.stage = key;
    block.dataset.ink = "";

    const head = document.createElement("div");
    head.className = "devpanel__head";

    const stage = document.createElement("b");
    stage.className = "devpanel__stage";
    stage.textContent = label;

    const size = document.createElement("span");
    size.className = "devpanel__size";

    head.append(stage, size);

    const pre = document.createElement("pre");
    pre.className = "devpanel__pre";
    /* The product-voice line for this stage, reachable but never printed here:
     * the panel stands outside that voice, and the tooltip is the one place the
     * two readings of the same moment can be held side by side. */
    pre.title = line;

    const code = document.createElement("code");
    code.className = "devpanel__code";
    code.textContent = RESTING_PAYLOAD;
    pre.append(code);

    block.append(head, pre);
    shell.append(block);
  }
  return shell;
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

  const code = block.querySelector(CODE_SELECTOR);
  if (!(code instanceof HTMLElement)) return false;

  const { text, json } = prettyPrint(raw);
  if (json) tint(code, text);
  else code.textContent = text;

  const size = block.querySelector(SIZE_SELECTOR);
  if (size instanceof HTMLElement) size.textContent = formatPayloadSize(raw);
  block.classList.add(FILLED_CLASS);
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
    block.classList.remove(FILLED_CLASS);
    const code = block.querySelector(CODE_SELECTOR);
    if (code instanceof HTMLElement) code.textContent = RESTING_PAYLOAD;
    const size = block.querySelector(SIZE_SELECTOR);
    if (size instanceof HTMLElement) size.textContent = "";
  }
}
