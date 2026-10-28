// @ts-check
/**
 * The drawing a build narrates over: the window it is making, there from the first moment as a
 * faint ghost, drawn in pencil part by part over it and inked as each part passes its check. The
 * record sheet on the right has one row for each of the first three fields, and shortens to fit
 * when there are fewer.
 */

/** @typedef {import("./voice.js").Part} Part */

const SVG_NS = "http://www.w3.org/2000/svg";

/** What each part of the window draws. */
/** @type {Record<Part, readonly string[]>} */
export const DRAWN_BY = {
  card: ["card", "pill"],
  add: ["newbtn"],
  open: ["sheet"],
  change: ["save"],
  remove: ["delete"],
  search: ["rail"],
};

/** How long the record sheet's old ghost takes to fade under the one redrawn for its fields. */
const GHOST_SWAP_MS = 450;

/** The most characters a field name gets in its slot before it is trimmed. */
const LABEL_ROOM = 15;

/**
 * Counted in characters as a reader sees them, so an emoji or an accent is never cut in half.
 *
 * @param {string} label
 */
function trim(label) {
  const letters = Array.from(new Intl.Segmenter().segment(label), ({ segment }) => segment);
  return letters.length > LABEL_ROOM ? `${letters.slice(0, LABEL_ROOM - 1).join("")}…` : label;
}

/**
 * An SVG element for the drawing, its attributes set.
 *
 * @param {string} tag
 * @param {Record<string, string | number>} attributes
 */
export function shape(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/**
 * @param {string} part
 * @param {string} tag
 * @param {Record<string, string | number>} attributes
 */
const drawn = (part, tag, attributes) =>
  shape(tag, { "data-part": part, pathLength: 1, ...attributes });

/**
 * The shapes that come loose together when a run fails, as one piece of the window.
 *
 * @param {string} name
 * @param {Element[]} shapes
 */
function piece(name, ...shapes) {
  const group = shape("g", { "data-piece": name });
  group.append(...shapes);
  return group;
}

/** The parts every window has, whatever it keeps track of. */
function frame() {
  /** @param {number} y @param {string} lines */
  const card = (y, lines) =>
    piece(
      "card",
      drawn("card", "rect", { x: 20, y, width: 226, height: 48 }),
      drawn("card", "path", { d: lines }),
      drawn("pill", "rect", { x: 196, y: y + 13, width: 38, height: 18 }),
    );
  return [
    drawn("frame", "rect", { x: 4, y: 4, width: 392, height: 242 }),
    piece(
      "rail",
      drawn("rail", "rect", { x: 20, y: 20, width: 226, height: 28 }),
      drawn("rail", "circle", { cx: 36, cy: 34, r: 6 }),
    ),
    piece(
      "newbtn",
      drawn("newbtn", "rect", { x: 262, y: 20, width: 118, height: 28 }),
      drawn("newbtn", "path", { d: "M314 34h14M321 27v14" }),
    ),
    piece("count", drawn("count", "path", { d: "M20 66h64" })),
    card(78, "M34 95h96M34 110h140"),
    card(136, "M34 153h80M34 168h120"),
  ];
}

/**
 * The record sheet: a row for each of the first three fields, then the two buttons under them.
 *
 * @param {readonly string[]} fields
 */
function recordSheet(fields) {
  const shown = fields.slice(0, 3);
  const buttons = 90 + Math.max(1, shown.length) * 38;
  const rows = shown.flatMap((label, i) => {
    const text = shape("text", { "data-part": "labels", x: 272, y: 86 + i * 38, "font-size": 10 });
    text.textContent = trim(label);
    return [text, drawn("sheet", "rect", { x: 272, y: 92 + i * 38, width: 98, height: 18 })];
  });
  return [
    piece(
      "sheet",
      drawn("sheet", "rect", { x: 262, y: 64, width: 118, height: buttons - 38 }),
      ...rows,
    ),
    piece("save", drawn("save", "rect", { x: 272, y: buttons, width: 46, height: 18 })),
    piece("delete", drawn("delete", "rect", { x: 324, y: buttons, width: 46, height: 18 })),
  ];
}

/**
 * A faint copy of each shape, in pieces as the shapes are, the field names left out. A ghost names
 * its part in `data-ghost` and its piece in `data-ghost-piece`, so nothing that draws a part
 * reaches it, and has no `pathLength`, so its dashes keep their size.
 *
 * @param {readonly Element[]} nodes
 */
function ghostsOf(nodes) {
  let order = 0;
  /** @param {Element} node @returns {Element[]} */
  const ghost = (node) => {
    if (node.getAttribute("data-part") === "labels") return [];
    const copy = /** @type {SVGElement} */ (node.cloneNode(false));
    const name = node.getAttribute("data-piece");
    if (name !== null) {
      copy.removeAttribute("data-piece");
      copy.setAttribute("data-ghost-piece", name);
      copy.append(...[...node.children].flatMap(ghost));
      return [copy];
    }
    copy.setAttribute("data-ghost", node.getAttribute("data-part") ?? "");
    copy.removeAttribute("data-part");
    copy.removeAttribute("pathLength");
    copy.style.setProperty("--ghost-order", String(order));
    order += 1;
    return [copy];
  };
  return nodes.flatMap(ghost);
}

/** The drawing, before the build has named any field. */
export function drawSheet() {
  const svg = /** @type {SVGSVGElement} */ (shape("svg", { viewBox: "0 0 400 250" }));
  svg.setAttribute("class", "narration__sheet");
  svg.setAttribute("aria-hidden", "true");
  const shapes = frame();
  const sheet = recordSheet([]);
  const record = shape("g", { class: "narration__record" });
  record.append(...sheet);
  const ghostRecord = shape("g", { class: "narration__ghost-record" });
  ghostRecord.append(...ghostsOf(sheet));
  const ghost = shape("g", { class: "narration__ghost" });
  ghost.append(...ghostsOf(shapes), ghostRecord);
  svg.append(ghost, ...shapes, record);
  return svg;
}

/**
 * Redraw the record sheet, and its ghost, for the fields the build settled on. Its parts start
 * undrawn again, which costs nothing: nothing on the sheet is drawn before the fields are known.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} fields
 */
export function nameFields(svg, fields) {
  const sheet = recordSheet(fields);
  svg.querySelector(".narration__record")?.replaceChildren(...sheet);
  const ghost = svg.querySelector(".narration__ghost-record");
  if (!ghost) return;
  // The old ghost fades as the new one comes in over it, so the sheet's ghost never blinks out.
  for (const old of [...ghost.children]) {
    for (const leaving of [old, ...old.querySelectorAll("[data-ghost]")]) {
      /** @type {SVGElement} */ (leaving).style.setProperty(
        "--narration-fade",
        `${GHOST_SWAP_MS}ms`,
      );
      leaving.setAttribute("data-leaving", "");
    }
    setTimeout(() => old.remove(), GHOST_SWAP_MS + 150);
  }
  ghost.append(...ghostsOf(sheet));
}

/**
 * Every shape of the named parts, or of their ghosts.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {"part" | "ghost"} [kind]
 */
export function shapesOf(svg, parts, kind = "part") {
  if (parts.length === 0) return [];
  const selector = parts.map((part) => `[data-${kind}="${part}"]:not([data-leaving])`).join(",");
  return [...svg.querySelectorAll(selector)];
}

/**
 * Put every shape of the named parts in one drawing state.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {string} state
 */
export function markDrawn(svg, parts, state) {
  for (const node of shapesOf(svg, parts)) node.setAttribute("data-state", state);
}
