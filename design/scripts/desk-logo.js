/**
 * What a logo is made of, apart from the desk that stands them in a grid.
 *
 * Nothing about how a logo *looks* is decided here either — the corner, the
 * shadow, the size, the gap and the way the name is set are all in
 * `logo-contract.css`. This is only the markup those rules are written for, and
 * the two states a tile passes through before it has a face.
 */

/** @typedef {import("./data/capabilities.js").Capability} Capability */

/**
 * Where a capability's name is written, so it can be filled in later.
 * @param {string} id
 */
const labelId = (id) => `logo-label-${id}`;

/**
 * The constant half of a nameless tile's accessible name.
 * @param {string} id
 */
const statusId = (id) => `logo-status-${id}`;

/**
 * A logo, assembled to the contract: the stored artwork full-bleed on the tile,
 * and the capability's name written straight onto the desk beneath it.
 *
 * A capability has no artwork until its build has cleared the gate, because that
 * is when the request is made and nothing pays for a build that can still fail
 * (L10). Until then the tile is a placeholder, and it works for the whole of that
 * wait — the build first, which is the ambient signal that something is being
 * made (D6), and then the logo request itself, back to back, so the ground never
 * goes still while a picture is on its way.
 *
 * It is also nameless for the first part of it. Admission has no name to write —
 * the name is authored at the spec stage — so the ground stays blank rather than
 * carrying a stand-in. `aria-labelledby` reads a directly referenced node even
 * when it is hidden, so the tile answers to "being made" now and to its own name
 * the moment there is one, without the label ever having to be a word nobody
 * chose.
 *
 * D4 makes the logo load-bearing: with no taskbar it is the capability's
 * permanent identity and the only way back to a window you closed.
 *
 * @param {Capability} capability
 * @param {{ building: boolean, onOpen: () => void }} opts
 * @returns {HTMLButtonElement}
 */
export function logoButton(capability, opts) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "logo";
  button.dataset.capability = capability.id;

  const tile = document.createElement("span");
  tile.className = "logo-tile";
  if (capability.pending) {
    tile.classList.add("logo-tile--pending", "logo-tile--working");
  } else if (capability.logo) {
    tile.style.backgroundImage = `url("${capability.logo}")`;
  }

  const label = document.createElement("span");
  label.className = "logo-label";
  label.id = labelId(capability.id);
  label.textContent = capability.unnamed ? "" : capability.label;
  button.append(tile, label);

  if (capability.unnamed) {
    const status = document.createElement("span");
    status.id = statusId(capability.id);
    status.hidden = true;
    status.textContent = "being made";
    button.append(status);
    button.setAttribute("aria-labelledby", `${label.id} ${status.id}`);
  } else {
    const name = capability.label;
    button.setAttribute("aria-label", opts.building ? `${name} — being made` : `Open ${name}`);
  }

  button.addEventListener("click", opts.onOpen);
  return button;
}

/**
 * The name, once the spec has authored one, written into the label already
 * standing on the desk. Never by redrawing the logo: the tile beside it is
 * mid-crawl and a fresh element would restart the animation.
 *
 * @param {ParentNode} root
 * @param {Capability} capability
 */
export function nameLogo(root, capability) {
  capability.unnamed = false;
  const label = root.querySelector(`#${labelId(capability.id)}`);
  if (label instanceof HTMLElement) label.textContent = capability.label;
}

/**
 * The developer tile's mark: a prompt, and the cursor waiting on the next line.
 *
 * Drawn here rather than borrowed. A line icon from a UI set is built to sit inside
 * running text at a hairline weight, and at 64px on a wallpaper it reads as a small
 * piece of type someone left on the tile. Every terminal that ships an icon solves
 * this the same way, and macOS Terminal is the clearest statement of it: a heavy
 * chevron in the **upper left** of the screen, the cursor bar set **below and to the
 * right** of it, and the bottom right left empty. That is not `>_` typed on one
 * baseline — it is a prompt with a cursor on the line under it, which is what makes it
 * read as a screen with something on it rather than as two characters.
 *
 * The coordinates are the face's own, so the mark is composed against the glass rather
 * than centred in whatever room is left under the title bar. The weight is a subject's
 * weight, not `--line`: the tile's edge is the boundary here, and what sits on the
 * glass is artwork — the same freedom a capability's full-bleed logo has.
 */
const DEV_ICON_VIEWBOX = "0 0 60 43";
const DEV_ICON_PATHS = ["M13 9 L23 17.5 L13 26", "M26 29 H41"];
const DEV_ICON_STROKE = "5.5";
const SVG_NS = "http://www.w3.org/2000/svg";

/** @returns {SVGSVGElement} */
function terminalIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", DEV_ICON_VIEWBOX);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", DEV_ICON_STROKE);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  for (const d of DEV_ICON_PATHS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * The developer panel's tile (D13). It stands with the apps because it is one,
 * and it is drawn rather than generated so nothing mistakes it for a capability.
 *
 * @param {() => void} onOpen
 * @returns {HTMLButtonElement}
 */
export function devTile(onOpen) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "logo logo--dev";
  button.dataset.dev = "true";
  /* The visible label is inside the accessible name, the way a capability logo's is
   * ("Open Notes"). A name that shared no words with the label would leave a
   * voice-control user with nothing to say. */
  button.setAttribute("aria-label", "Open Developer");

  const tile = document.createElement("span");
  tile.className = "logo-tile logo-tile--dev";
  tile.append(terminalIcon());

  const label = document.createElement("span");
  label.className = "logo-label";
  label.textContent = "Developer";

  button.append(tile, label);
  button.addEventListener("click", onOpen);
  return button;
}
