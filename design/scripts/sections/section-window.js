// @ts-check
/**
 * The lamps, on a document section.
 *
 * Every section of every page here is a real window, drawn by the same code the
 * desk uses, so every section carries the same two lamps. What they *mean* is
 * adapted to the object: a section has no logo to come back from, so putting
 * one away rolls it up to its title bar rather than removing it, and clicking
 * that bar puts it back.
 *
 * Both stay reversible and neither is destructive, which is the contract window
 * chrome keeps everywhere — close means put away, and nothing in storage
 * changes that a click cannot change back.
 *
 * This lives apart from any one page's bootstrap because there is more than one
 * page now, and a second copy of it would be a second place for the lamps to
 * mean something slightly different.
 */

/** @typedef {import("../window.js").AlunaWindow} AlunaWindow */

const PUT_AWAY_KEY = "aluna.design.putaway.v1";

/** @returns {Set<string>} */
export function readPutAway() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PUT_AWAY_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/**
 * @param {string} id the section's element id; a section without one is skipped
 * @param {boolean} away
 */
function putAway(id, away) {
  if (!id) return;
  const set = readPutAway();
  if (away) set.add(id);
  else set.delete(id);
  try {
    localStorage.setItem(PUT_AWAY_KEY, JSON.stringify([...set]));
  } catch {
    /* A page that cannot persist is still a working page. */
  }
}

/**
 * @param {AlunaWindow} win
 */
export function wireSectionLamps(win) {
  const restore = () => {
    if (!win.rolled) return;
    win.setRolled(false);
    putAway(win.el.id, false);
  };

  win.bar.addEventListener("click", (event) => {
    const { target } = event;
    if (target instanceof Element && target.closest(".lamp")) return;
    restore();
  });

  win.el.addEventListener("window:lamp", (event) => {
    const { action } = /** @type {CustomEvent<{ action: string }>} */ (event).detail;

    if (action === "maximise") {
      win.el.classList.toggle("is-wide");
    }

    /*
     * Put away: the section rolls up and stays that way on the next visit.
     * Nothing is lost — the title bar remains and clicking it puts it back.
     */
    if (action === "putaway") {
      win.setRolled(true);
      putAway(win.el.id, true);
    }
  });
}

/**
 * Mount the lamps on every section window on a page, restoring whatever was put
 * away last visit. The one call a page bootstrap needs.
 *
 * @param {Iterable<AlunaWindow>} windows
 */
export function wireSectionWindows(windows) {
  const away = readPutAway();
  for (const win of windows) {
    wireSectionLamps(win);
    if (win.el.id && away.has(win.el.id)) win.setRolled(true);
  }
}
