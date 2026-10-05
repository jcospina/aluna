// A record's entry in the tab's history, played on a history that moves (`tab-history.test-support.ts`):
// a press pushes it, the record view's way out steps back or replaces, and a build that gives the
// capability back replaces (PLAN decision 44; ADR-0010).

import { describe, expect, test } from "bun:test";
import { recordAddress } from "#shell/core/routes.js";
import { PLACES_ITS_OWN_FOCUS } from "#shell/core/shell-dom.js";
import {
  answerTraversal,
  capabilityAddress,
  capabilityIdFromAddress,
  correctUnfilledAddress,
  DESK_ADDRESS,
  DESK_HISTORY_STATE,
  followWindow,
  isAnotherPlace,
  markRecordExit,
  OPEN_THE_RECORD_EVENT,
  pushAddress,
  recordFromAddress,
  replaceAddress,
  startDeskHistory,
} from "#shell/desk/desk-address.js";
import { tabHistory } from "./tab-history.test-support.ts";

const RECORD = "0b0e3d6c-4c1f-4b8e-9a52-7d1f0c2a9e41";
const NOTES = capabilityAddress("notes");
const NOTE = recordAddress("notes", RECORD);
const RECIPES = capabilityAddress("recipes");

/** Pages loaded so far, each given a run of counts no other page has written. */
let pages = 0;

/**
 * Start the desk's history on `tab` as a page load does, its entry already carrying a count from
 * a page before it: what the desk knows of the entries around it is then nothing.
 */
function loadPage(
  tab: ReturnType<typeof tabHistory>,
  answers: Parameters<typeof startDeskHistory>[0],
) {
  pages += 1;
  tab.history.replaceState(
    { ...DESK_HISTORY_STATE, index: pages * 1000 },
    "",
    tab.location.pathname,
  );
  const host = globalThis as Record<string, unknown>;
  const standing = host.window;
  host.window = Object.assign(tab, { onpopstate: null });
  try {
    startDeskHistory(answers);
  } finally {
    host.window = standing;
  }
}

/**
 * A tab loaded at `pathname`, its entry stamped as the desk stamps the one it loads into, and every
 * traversal answered by the desk. `hold(true)` makes traversals ask before they are taken, and
 * `window` is what the window shows when the desk asks the bar to follow it.
 */
function tabAt(pathname: string) {
  const rendered: string[] = [];
  const held: (() => unknown)[] = [];
  const shows = { window: null as string | null };
  let holding = false;
  const hold = (go: () => unknown) => {
    if (!holding) return false;
    held.push(go);
    return true;
  };
  const follow = (navigated: boolean) => {
    if (shows.window !== null) followWindow(shows.window, navigated, tab);
  };
  const answers = { render: (at: string) => rendered.push(at), hold, follow };
  const tab = tabHistory(pathname, (event) => answerTraversal(event, answers, tab));
  loadPage(tab, answers);
  return {
    tab,
    rendered,
    held,
    shows,
    hold(on: boolean) {
      holding = on;
    },
  };
}

/** A card pressed in the collection the tab is on. */
/** A record a confirmed move lands on takes the focus as it lands; a collection leaves it to the bar. */
const focusAfterMovingTo = (address = "") =>
  recordFromAddress(address) === null ? undefined : PLACES_ITS_OWN_FOCUS;

function press(tab: ReturnType<typeof tabHistory>, address = NOTE) {
  pushAddress(address, tab);
}

/** The record view's way out, its collection landing and the bar following, as the desk plays it. */
function leave(tab: ReturnType<typeof tabHistory>, collection = NOTES) {
  const unmark = markRecordExit(collection);
  followWindow(collection, false, tab);
  unmark();
}

describe("a card press pushes the record address", () => {
  test("and Back and Forward move between it and its collection, writing nothing", async () => {
    const { tab, rendered } = tabAt(NOTES);
    press(tab);
    expect(tab.entries()).toEqual([NOTES, NOTE]);
    await tab.travel(-1);
    expect(rendered).toEqual([NOTES]);
    await tab.travel(1);
    expect(rendered).toEqual([NOTES, NOTE]);
    expect(tab.entries()).toEqual([NOTES, NOTE]);
  });

  test("and the entry carries the desk's mark and its place, and nothing about the one before", () => {
    const { tab } = tabAt(NOTES);
    press(tab);
    expect(Object.keys(tab.state() ?? {}).sort()).toEqual(["aluna", "index"]);
  });
});

describe("the record view's way out", () => {
  test("steps back onto the collection the record was opened from, keeping its Forward", async () => {
    const { tab, rendered } = tabAt(NOTES);
    press(tab);
    const unmark = markRecordExit(NOTES);
    followWindow(NOTES, false, tab);
    // The collection's own records landing before the step back does write nothing on the record.
    followWindow(NOTES, false, tab);
    await tab.arrived();
    unmark();
    expect(tab.at()).toBe(0);
    expect(tab.entries()).toEqual([NOTES, NOTE]);
    // The step back is the desk's own and renders nothing: the window already shows the collection.
    expect(rendered).toEqual([]);
    followWindow(NOTES, false, tab);
    expect(tab.entries()).toEqual([NOTES, NOTE]);
    await tab.travel(1);
    expect(rendered).toEqual([NOTE]);
  });

  test("replaces the entry with the collection's address where the person arrived by link", async () => {
    // A reload of a pressed record is the same arrival: the entries before it belong to a page now
    // gone, and stepping back onto one would load that page whole.
    const { tab } = tabAt(NOTE);
    leave(tab);
    await tab.arrived();
    expect(tab.entries()).toEqual([NOTES]);
  });

  test("replaces where the press left somewhere other than this collection", async () => {
    const { tab } = tabAt(DESK_ADDRESS);
    press(tab);
    leave(tab);
    await tab.arrived();
    expect(tab.entries()).toEqual([DESK_ADDRESS, NOTES]);
  });

  test("replaces where the entry before has since been corrected to somewhere else", async () => {
    const { tab } = tabAt(NOTES);
    press(tab);
    await tab.travel(-1);
    replaceAddress(DESK_ADDRESS, tab);
    await tab.travel(1);
    leave(tab);
    await tab.arrived();
    expect(tab.entries()).toEqual([DESK_ADDRESS, NOTES]);
  });

  test("replaces where there is no way to step", () => {
    const { tab } = tabAt(NOTES);
    press(tab);
    Reflect.deleteProperty(tab.history, "go");
    leave(tab);
    expect(tab.entries()).toEqual([NOTES, NOTES]);
  });

  test("replaces where the bar names a record the desk did not write there", () => {
    const { tab } = tabAt(NOTES);
    press(tab, recordAddress("notes", RECORD.replace("0b0e", "1c1f")));
    tab.history.replaceState(tab.state(), "", NOTE);
    leave(tab);
    expect(tab.pending()).toEqual([]);
    expect(tab.entries()).toEqual([NOTES, NOTES]);
  });

  test("after a reload, steps back once Back and Forward have shown what the entry before is", async () => {
    const answers = { render: () => {}, hold: () => false };
    const tab = tabHistory(NOTES, (event) => answerTraversal(event, answers, tab));
    // The page before the reload wrote both entries; this one is about to load at the second.
    tab.history.replaceState({ ...DESK_HISTORY_STATE, index: (pages + 1) * 1000 - 1 }, "", NOTES);
    tab.history.pushState(null, "", NOTE);
    loadPage(tab, answers);
    await tab.travel(-1);
    await tab.travel(1);
    leave(tab);
    expect(tab.pending()).toEqual([-1]);
    await tab.arrived();
    expect(tab.entries()).toEqual([NOTES, NOTE]);
  });

  test("steps back only for the read it marked, and an older read lifts no newer mark", async () => {
    const lifted = tabAt(NOTES);
    press(lifted.tab);
    markRecordExit(NOTES)();
    followWindow(NOTES, false, lifted.tab);
    expect(lifted.tab.entries()).toEqual([NOTES, NOTES]);

    const elsewhere = tabAt(NOTES);
    press(elsewhere.tab);
    leave(elsewhere.tab, RECIPES);
    followWindow(NOTES, false, elsewhere.tab);
    expect(elsewhere.tab.entries()).toEqual([NOTES, NOTES]);

    const newer = tabAt(NOTES);
    press(newer.tab);
    const older = markRecordExit(NOTES);
    const latest = markRecordExit(NOTES);
    older();
    followWindow(NOTES, false, newer.tab);
    latest();
    await newer.tab.arrived();
    expect(newer.tab.at()).toBe(0);
    expect(newer.tab.entries()).toEqual([NOTES, NOTE]);
  });
});

describe("a traversal across record addresses, with something to lose", () => {
  test("Back off a record, Forward onto one, and one record to another each ask first", async () => {
    for (const [from, to, delta] of [
      [NOTES, NOTE, -1],
      [NOTES, NOTE, 1],
      [NOTE, recordAddress("notes", RECORD.replace("0b0e", "1c1f")), -1],
    ] as const) {
      const desk = tabAt(from);
      press(desk.tab, to);
      if (delta === 1) await desk.tab.travel(-1);
      const before = desk.tab.at();
      desk.hold(true);
      await desk.tab.travel(delta);
      // Asked, and the bar stepped back onto the window it is asking over, writing nothing.
      expect(desk.held).toHaveLength(1);
      expect(desk.tab.at()).toBe(before);
      expect(desk.rendered.slice(delta === 1 ? 1 : 0)).toEqual([]);
      desk.hold(false);
      expect(desk.held[0]?.()).toBe(focusAfterMovingTo(desk.tab.entries()[before + delta]));
      await desk.tab.arrived();
      expect(desk.tab.at()).toBe(before + delta);
      expect(desk.rendered.at(-1)).toBe(desk.tab.entries()[before + delta]);
      expect(desk.tab.entries()).toEqual([from, to]);
    }
  });
});

describe("a yes to the question a traversal asks", () => {
  test("a yes is taken once: what it confirmed is not asked about again when it lands", async () => {
    // Every traversal still finds something to lose, as a form given focus back by the yes does.
    const desk = tabAt(NOTES);
    press(desk.tab);
    desk.hold(true);
    await desk.tab.travel(-1);
    desk.held[0]?.();
    await desk.tab.arrived();
    expect(desk.held).toHaveLength(1);
    expect(desk.tab.location.pathname).toBe(NOTES);
    expect(desk.rendered).toEqual([NOTES]);
    // And the next traversal is asked about as any is.
    await desk.tab.travel(1);
    expect(desk.held).toHaveLength(2);
    expect(desk.tab.location.pathname).toBe(NOTES);
  });

  test("a yes whose traversal never lands is forgotten by the person's next press", () => {
    const { tab } = tabAt(NOTES);
    press(tab);
    const onRecord = tab.state()?.index as number;
    const asked: (() => void)[] = [];
    const desk = { render: () => {}, hold: (go: () => void) => asked.push(go) > 0 };
    // The browser delivers none of the desk's `go`s: the step back, nor the yes.
    tab.history.go = () => {};
    answerTraversal({ state: { ...DESK_HISTORY_STATE, index: onRecord - 1 } }, desk, tab);
    asked[0]?.();
    press(tab, RECIPES);
    // A Back onto the entry the lost yes was for is the person's own, and is asked about.
    answerTraversal({ state: { ...DESK_HISTORY_STATE, index: onRecord - 1 } }, desk, tab);
    expect(asked).toHaveLength(2);
  });

  test("a yes after the record's own way out stepped back lands where the person asked, no further", async () => {
    const desk = tabAt(DESK_ADDRESS);
    press(desk.tab, NOTES);
    press(desk.tab);
    desk.hold(true);
    await desk.tab.travel(-1);
    expect(desk.tab.location.pathname).toBe(NOTE);
    // The delete commits while the question stands, and its way out steps back on its own.
    desk.shows.window = NOTES;
    leave(desk.tab);
    await desk.tab.arrived();
    expect(desk.tab.location.pathname).toBe(NOTES);
    desk.hold(false);
    desk.held[0]?.();
    await desk.tab.arrived();
    expect(desk.tab.location.pathname).toBe(NOTES);
    expect(desk.rendered).toEqual([NOTES]);
    expect(desk.tab.went()).not.toContain(0);
  });
});

describe("while the bar is on an entry the desk is stepping back off", () => {
  test("one record to another, held, keeps the entry the person landed on while the bar is away", async () => {
    const other = recordAddress("notes", RECORD.replace("0b0e", "1c1f"));
    const desk = tabAt(NOTES);
    press(desk.tab);
    press(desk.tab, other);
    desk.hold(true);
    desk.tab.history.go(-1);
    desk.tab.arriveOne();
    // The other record's save commits while the question stands, its collection landing in the gap.
    desk.shows.window = NOTES;
    leave(desk.tab);
    expect(desk.tab.entries()).toEqual([NOTES, NOTE, other]);
    desk.tab.arriveOne();
    expect(desk.tab.entries()).toEqual([NOTES, NOTE, NOTES]);
    desk.hold(false);
    desk.held[0]?.();
    await desk.tab.arrived();
    expect(desk.tab.location.pathname).toBe(NOTE);
  });

  test("a way out that landed while the bar was away still steps back once the desk is back", async () => {
    const desk = tabAt(NOTES);
    press(desk.tab);
    desk.hold(true);
    desk.tab.history.go(-1);
    desk.tab.arriveOne();
    // On the collection, the question asked, and the record's way out landing its collection
    // before the desk has stepped back onto the record: held, and kept for when it has.
    desk.shows.window = NOTES;
    leave(desk.tab);
    expect(desk.tab.entries()).toEqual([NOTES, NOTE]);
    desk.tab.arriveOne();
    expect(desk.tab.pending()).toEqual([-1]);
    await desk.tab.arrived();
    expect(desk.tab.location.pathname).toBe(NOTES);
    expect(desk.tab.entries()).toEqual([NOTES, NOTE]);
    // Kept for that one coming back, and no other.
    press(desk.tab);
    followWindow(NOTES, false, desk.tab);
    expect(desk.tab.entries()).toEqual([NOTES, NOTES]);
  });

  test("a way out still being read when the desk is back steps back once it lands", () => {
    const desk = tabAt(NOTES);
    press(desk.tab);
    desk.hold(true);
    desk.tab.history.go(-1);
    desk.tab.arriveOne();
    const unmark = markRecordExit(NOTES);
    desk.tab.arriveOne();
    followWindow(NOTES, false, desk.tab);
    unmark();
    expect(desk.tab.pending()).toEqual([-1]);
  });

  test("a way out kept for the desk's return is spent by it, or by the person moving first", () => {
    // Spent: the window showed something else when the desk came back, and a build that later
    // gives notes back from a record of it replaces.
    const spent = tabAt(NOTES);
    press(spent.tab);
    spent.hold(true);
    spent.tab.history.go(-1);
    spent.tab.arriveOne();
    spent.shows.window = RECIPES;
    leave(spent.tab);
    spent.tab.arriveOne();
    press(spent.tab, NOTES);
    press(spent.tab);
    followWindow(NOTES, false, spent.tab);
    expect(spent.tab.pending()).toEqual([]);
    expect(spent.tab.entries().at(-1)).toBe(NOTES);

    // Moved first: the person's own Back lands before the desk's step back does.
    const moved = tabAt(DESK_ADDRESS);
    press(moved.tab, NOTES);
    press(moved.tab);
    moved.hold(true);
    moved.tab.history.go(-1);
    moved.tab.arriveOne();
    leave(moved.tab);
    moved.hold(false);
    const first = (moved.tab.state()?.index as number) - 1;
    answerTraversal(
      { state: { ...DESK_HISTORY_STATE, index: first } },
      { render: () => {}, hold: () => false },
      moved.tab,
    );
    press(moved.tab);
    followWindow(NOTES, false, moved.tab);
    expect(moved.tab.pending()).toEqual([1]);
  });

  test("and what the window shows when the desk is back is owed an entry only if it was a push", async () => {
    // Asked about leaving, the window shows another capability by the time the step back lands:
    // the person's own Back owed nothing, so it is a correction.
    const held = tabAt(NOTES);
    press(held.tab);
    held.hold(true);
    held.tab.history.go(-1);
    held.tab.arriveOne();
    held.shows.window = RECIPES;
    held.tab.arriveOne();
    expect(held.tab.entries()).toEqual([NOTES, RECIPES]);

    // And one step back owing nothing leaves nothing owed to the next.
    const twice = tabAt(NOTES);
    press(twice.tab);
    twice.shows.window = NOTES;
    leave(twice.tab);
    await twice.tab.arrived();
    press(twice.tab);
    leave(twice.tab);
    twice.shows.window = RECIPES;
    await twice.tab.arrived();
    expect(twice.tab.entries()).toEqual([RECIPES, NOTE]);
  });
});

describe("a build that took the window from a record address", () => {
  test("gives the capability back by a replace, restored or shown evolved", () => {
    for (const navigated of [false, true]) {
      const { tab } = tabAt(NOTES);
      press(tab);
      followWindow(NOTE, navigated, tab);
      expect(tab.entries()).toEqual([NOTES, NOTE]);
      followWindow(NOTES, navigated, tab);
      expect(tab.entries()).toEqual([NOTES, NOTES]);
    }
  });

  test("still pushes a first build's new capability", () => {
    const { tab } = tabAt(NOTES);
    press(tab);
    followWindow(RECIPES, true, tab);
    expect(tab.entries()).toEqual([NOTES, NOTE, RECIPES]);
  });
});

describe("the bar follows the window", () => {
  test("to the bare desk when the window is put away, adding no entry", () => {
    const { tab } = tabAt(NOTE);
    followWindow(DESK_ADDRESS, false, tab);
    expect(tab.entries()).toEqual([DESK_ADDRESS]);
  });

  test("but not while it names the record a step back is leaving, and is owed it after", async () => {
    const desk = tabAt(NOTES);
    press(desk.tab);
    leave(desk.tab);
    followWindow(NOTES, false, desk.tab);
    followWindow(RECIPES, true, desk.tab);
    expect(desk.tab.entries()).toEqual([NOTES, NOTE]);
    // A first build landed in the gap: the desk asks the window once it is back, and pushes it.
    desk.shows.window = RECIPES;
    await desk.tab.arrived();
    expect(desk.tab.entries()).toEqual([NOTES, RECIPES]);
  });
});

// The count every entry carries, which a step back is sized from (`desk-address.js`).
describe("the count the desk keeps", () => {
  test("moves with every traversal, so the next press numbers its entry from where the bar is", async () => {
    const { tab } = tabAt(NOTES);
    const loaded = tab.state()?.index as number;
    press(tab);
    await tab.travel(-1);
    press(tab, RECIPES);
    expect(tab.entries()).toEqual([NOTES, RECIPES]);
    expect(tab.state()?.index).toBe(loaded + 1);
  });

  test("a traversal onto the entry the desk is on asks nothing, and one with no event is answered", () => {
    const { tab, rendered } = tabAt(NOTES);
    const asked: string[] = [];
    const hold = () => asked.push("asked") > 0;
    answerTraversal({ state: tab.state() }, { render: (at) => rendered.push(at), hold }, tab);
    answerTraversal(undefined, { render: (at) => rendered.push(at), hold }, tab);
    expect(asked).toEqual([]);
    expect(rendered).toEqual([NOTES, NOTES]);
  });

  test("two addresses naming no place are not one place, nor is one that only ends like one", () => {
    expect(isAnotherPlace("/somewhere", "/elsewhere")).toBe(true);
    expect(capabilityIdFromAddress(`/x${NOTES}`)).toBeNull();
    expect(recordFromAddress(`/x${NOTE}`)).toBeNull();
  });

  test("no browser, no history: every verb answers rather than throwing", () => {
    expect(() => followWindow(NOTES, true, null)).not.toThrow();
    expect(() => correctUnfilledAddress(NOTE, NOTES)).not.toThrow();
    expect(() => startDeskHistory({ render: () => {}, hold: () => false })).not.toThrow();
    const nobody = { render: () => {}, hold: () => false };
    expect(() => answerTraversal({ state: null }, nobody, null)).not.toThrow();
  });
});

describe("the page starting its history", () => {
  /** A page in `readyState`, its body's and its own listeners kept, its bar on `pathname`. */
  function page(readyState: string, pathname: string) {
    const listening: Record<string, () => void> = {};
    const browser = Object.assign(
      tabHistory(pathname, () => {}),
      { onpopstate: null as unknown },
    );
    const listen = (type: string, run: () => void) => {
      listening[type] = run;
    };
    const doc = { readyState, body: { addEventListener: listen }, addEventListener: listen };
    return { browser, doc, listening };
  }

  /** Stand `window` and `document` up for the length of `run`, and put back what was there. */
  function standing(globals: { window: unknown; document: unknown }, run: () => void) {
    const host = globalThis as Record<string, unknown>;
    const before = { window: host.window, document: host.document };
    Object.assign(host, globals);
    try {
      run();
    } finally {
      Object.assign(host, before);
    }
  }

  test("stamps the entry it loaded into, and stamps again an entry htmx wrote the state of", () => {
    const { browser, doc, listening } = page("complete", NOTES);
    standing({ window: browser, document: doc }, () => {
      startDeskHistory({ render: () => {}, hold: () => false });
      const stamped = browser.state()?.index;
      expect(typeof stamped).toBe("number");
      browser.history.replaceState({ htmx: true }, "", NOTE);
      listening["htmx:replacedInHistory"]?.();
      expect(browser.state()).toEqual({ ...DESK_HISTORY_STATE, index: stamped });
      expect(browser.entries()).toEqual([NOTE]);
    });
    // Loaded already, so there is no `DOMContentLoaded` left to wait for; a pressed name is heard.
    expect(Object.keys(listening).sort()).toEqual(
      ["htmx:replacedInHistory", OPEN_THE_RECORD_EVENT].sort(),
    );
  });

  test("in a window with no document yet, takes Back and Forward all the same", () => {
    const { browser } = page("complete", NOTES);
    standing({ window: browser, document: undefined }, () => {
      startDeskHistory({ render: () => {}, hold: () => false });
    });
    expect(typeof browser.onpopstate).toBe("function");
  });

  test("a reload keeps the count its entry carries", () => {
    const { browser, doc } = page("complete", NOTES);
    browser.history.replaceState({ ...DESK_HISTORY_STATE, index: 41 }, "", NOTES);
    standing({ window: browser, document: doc }, () => {
      startDeskHistory({ render: () => {}, hold: () => false });
      pushAddress(NOTE, browser);
    });
    expect(browser.state()?.index).toBe(42);
  });
});
