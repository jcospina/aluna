// A record's way back, played on a history that moves: what it names
// and where it lands, from the entry before as this page saw it, and the record's own list
// wherever the page saw none.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import {
  answerTraversal,
  capabilityAddress,
  DESK_ADDRESS,
  DESK_HISTORY_STATE,
  followWindow,
  forgetRecord,
  markRecordExit,
  mayNameAgain,
  nameRecord,
  pushAddress,
  startDeskHistory,
  wayBack,
} from "#shell/desk/desk-address.js";
import { tabHistory } from "../tab-history.test-support.ts";

const NOTES = capabilityAddress("notes");
const RECIPES = capabilityAddress("recipes");
const NOTE = recordAddress("notes", randomUUID());
const OTHER_NOTE = recordAddress("notes", randomUUID());
const RECIPE = recordAddress("recipes", randomUUID());
const NOTE_TITLE = `Buy figs ${randomUUID()}`;

/** Pages loaded so far, each given a run of counts no other page in this file has written. */
let pages = 0;

/**
 * A tab loaded at `pathname` as a page load starts it, knowing nothing of the entries around it,
 * every traversal answered by the desk, and the bar following `shows.window` when the desk is
 * back. `onDesk` is every capability with a logo on the ground.
 */
function tabAt(pathname: string, onDesk = ["notes", "recipes"]) {
  const shows = { window: null as string | null };
  const follow = (navigated: boolean) => {
    if (shows.window !== null) followWindow(shows.window, navigated, tab);
  };
  const answers = {
    render: () => {},
    hold: () => false,
    follow,
    knows: (id: string) => onDesk.includes(id),
  };
  const tab = tabHistory(pathname, (event) => answerTraversal(event, answers, tab));
  pages += 1;
  tab.history.replaceState({ ...DESK_HISTORY_STATE, index: 50_000 + pages * 1000 }, "", pathname);
  const host = globalThis as Record<string, unknown>;
  const standing = host.window;
  host.window = Object.assign(tab, { onpopstate: null });
  try {
    startDeskHistory(answers);
  } finally {
    host.window = standing;
  }
  return Object.assign(tab, { shows });
}

type Tab = ReturnType<typeof tabAt>;

/** A press opening `address`, and the window showing it, called `title` if it is a record. */
function open(tab: Tab, address: string, title?: string) {
  pushAddress(address, tab);
  tab.shows.window = address;
  if (title !== undefined) nameRecord(address, title);
}

/** The record view's way out, `to` landing in the window and the bar following it. */
function leave(tab: Tab, to: string, onto = to) {
  const unmark = markRecordExit(to, onto);
  tab.shows.window = to;
  followWindow(to, false, tab);
  unmark();
}

/** Where the way out of the record the bar names goes, leaving for its own list otherwise. */
const wayBackFrom = (tab: Tab, own: string, here: string | null = tab.location.pathname) =>
  wayBack(own, here, tab);

describe("the way back names the entry before, and steps back onto it", () => {
  test("a record opened from a record names that record by its title", async () => {
    const tab = tabAt(NOTES);
    open(tab, NOTE, NOTE_TITLE);
    open(tab, RECIPE, "Fig jam");
    expect(wayBackFrom(tab, RECIPES)).toEqual({ address: NOTE, title: NOTE_TITLE, onto: NOTE });
    leave(tab, NOTE);
    expect(tab.pending()).toEqual([-1]);
    await tab.arrived();
    // The visible Back lands where the browser's would, and the Forward it leaves is the same.
    expect(tab.location.pathname).toBe(NOTE);
    expect(tab.entries()).toEqual([NOTES, NOTE, RECIPE]);
    // The record's own list is named by its logo, so no title comes with it.
    expect(wayBackFrom(tab, NOTES)).toEqual({ address: NOTES, title: null, onto: NOTES });
  });

  test("a record opened over another capability's list names that list by its label", async () => {
    // An answer window writes no history, so a name pressed in one over Recipes leaves Recipes as
    // the entry before.
    const tab = tabAt(RECIPES);
    open(tab, NOTE, NOTE_TITLE);
    expect(wayBackFrom(tab, NOTES)).toEqual({ address: RECIPES, title: null, onto: RECIPES });
    leave(tab, RECIPES);
    await tab.arrived();
    expect(tab.location.pathname).toBe(RECIPES);
    expect(tab.entries()).toEqual([RECIPES, NOTE]);
  });

  test("a record's title is the one the window last showed, whichever entry showed it", () => {
    const note = recordAddress("notes", randomUUID());
    const other = recordAddress("notes", randomUUID());
    const tab = tabAt(NOTES);
    open(tab, note, NOTE_TITLE);
    open(tab, RECIPE, "Fig jam");
    open(tab, note, "Buy plums");
    open(tab, other, "Buy pears");
    expect(wayBackFrom(tab, NOTES)?.title).toBe("Buy plums");
    expect(mayNameAgain(note)).toBe(true);
    expect(mayNameAgain(other)).toBe(false);
  });

  test("a record a delete has taken since is left for its list, stepping back onto its entry", () => {
    const note = recordAddress("notes", randomUUID());
    const tab = tabAt(NOTES);
    open(tab, note, NOTE_TITLE);
    open(tab, RECIPE, "Fig jam");
    forgetRecord(note);
    expect(wayBackFrom(tab, RECIPES)).toEqual({ address: NOTES, title: null, onto: note });
  });
});

describe("the way back is the record's own list, by a replace", () => {
  test("after a pasted address or a reload, whose entries before this page never saw", async () => {
    const tab = tabAt(NOTE);
    expect(wayBackFrom(tab, NOTES)).toEqual({ address: NOTES, title: null, onto: NOTES });
    leave(tab, NOTES);
    await tab.arrived();
    expect(tab.entries()).toEqual([NOTES]);
  });

  test("from the bare desk", async () => {
    const tab = tabAt(DESK_ADDRESS);
    open(tab, NOTE, NOTE_TITLE);
    expect(wayBackFrom(tab, NOTES)).toEqual({ address: NOTES, title: null, onto: NOTES });
    leave(tab, NOTES);
    await tab.arrived();
    expect(tab.entries()).toEqual([DESK_ADDRESS, NOTES]);
  });

  test("where the record before was never shown, or its capability left the desk", () => {
    const unshown = tabAt(NOTES);
    pushAddress(recordAddress("notes", randomUUID()), unshown);
    open(unshown, RECIPE, "Fig jam");
    expect(wayBackFrom(unshown, RECIPES)?.address).toBe(RECIPES);

    const gone = tabAt(RECIPES, ["notes"]);
    open(gone, NOTE, NOTE_TITLE);
    expect(wayBackFrom(gone, NOTES)?.address).toBe(NOTES);
  });

  test("where the view holds no record, there is no bar, or the bar cannot step", async () => {
    const tab = tabAt(RECIPES);
    open(tab, NOTE, NOTE_TITLE);
    expect(wayBackFrom(tab, NOTES, null)?.address).toBe(NOTES);
    expect(wayBack(NOTES, NOTE, null)?.address).toBe(NOTES);
    Reflect.deleteProperty(tab.history, "go");
    expect(wayBackFrom(tab, NOTES)?.address).toBe(NOTES);
  });
});

describe("the way back waits while the bar is off the record", () => {
  test("for a navigation of the person's own still landing over it, and only then", () => {
    // A name pressed over the note pushes another note, whose read is still on its way: the note's
    // own Back yields to it.
    const tab = tabAt(NOTES);
    open(tab, NOTE, NOTE_TITLE);
    pushAddress(OTHER_NOTE, tab);
    const landing = (pathname: string) => pathname === OTHER_NOTE;
    expect(wayBack(NOTES, NOTE, tab, landing)).toBeNull();
    // With nothing landing, as after a press that failed, the record's own list is the way back.
    expect(wayBack(NOTES, NOTE, tab)).toEqual({ address: NOTES, title: null, onto: NOTES });
  });

  test("and for the desk's own step back still on its way", async () => {
    const tab = tabAt(RECIPES);
    open(tab, NOTE, NOTE_TITLE);
    leave(tab, RECIPES);
    expect(tab.pending()).toEqual([-1]);
    expect(wayBack(NOTES, NOTE, tab)).toBeNull();
    await tab.arrived();
    await tab.travel(1);
    expect(wayBackFrom(tab, NOTES)?.address).toBe(RECIPES);
  });
});

describe("what this page knows of the entries", () => {
  test("survives a traversal back, and loses the Forward a push drops", async () => {
    // Records of their own: what an earlier test's page saw is still in this module.
    const note = recordAddress("notes", randomUUID());
    const tab = tabAt(RECIPES);
    open(tab, note, NOTE_TITLE);
    await tab.travel(-1);
    await tab.travel(1);
    expect(wayBackFrom(tab, NOTES)?.address).toBe(RECIPES);
    // Back on the list, the entry after it may yet name it on its way back; a push drops it.
    await tab.travel(-1);
    expect(mayNameAgain(RECIPES)).toBe(true);
    open(tab, recordAddress("recipes", randomUUID()), "Fig jam");
    expect(mayNameAgain(note)).toBe(false);
  });

  test("calls nothing but a record by a title, and nothing by an empty one", () => {
    const tab = tabAt(NOTES);
    nameRecord(NOTES, "Notes");
    open(tab, recordAddress("notes", randomUUID()), "");
    open(tab, RECIPE, "Fig jam");
    expect(wayBackFrom(tab, RECIPES)?.address).toBe(RECIPES);
  });
});

describe("a record there that has gone since", () => {
  test("its list stands in, stepped back onto the record's entry, which is then corrected", async () => {
    const tab = tabAt(NOTES);
    open(tab, NOTE, NOTE_TITLE);
    open(tab, RECIPE, "Fig jam");
    leave(tab, NOTES, NOTE);
    expect(tab.pending()).toEqual([-1]);
    await tab.arrived();
    // As a browser Back onto a gone record leaves it: its entry names its list from then on.
    expect(tab.entries()).toEqual([NOTES, NOTES, RECIPE]);
    expect(tab.location.pathname).toBe(NOTES);
  });
});
