import { describe, expect, test } from "bun:test";

import {
  answerDoorway,
  WINDOW_DOORWAY_SELECTOR,
  whenTheRequestFails,
} from "#shell/desk-doorway.js";

// The presses on the ground that are owed a window before htmx resolves their target.
// Today there is one — Delete on a capability's context menu, whose confirmation fills
// the window (PLAN decision 20) — and everything it decides is decided here, so it is
// asked directly rather than only through the markup that carries its mark.

/** As much of a document as the doorway reaches for: one listener list, one dispatch. */
function documentDouble() {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    root: {
      addEventListener(name: string, listener: (event: unknown) => void) {
        if (name === "htmx:afterRequest") listeners.push(listener);
      },
      removeEventListener(_name: string, listener: (event: unknown) => void) {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      },
    },
    settle(elt: unknown, successful: boolean) {
      for (const listener of [...listeners]) listener({ detail: { elt, successful } });
    },
    get listening() {
      return listeners.length;
    },
  };
}

/** The window, and a record of everything the doorway asked it to do. */
function windowDouble(overrides: { narrating?: boolean; logo?: object | null } = {}) {
  const region = { id: "region" };
  const opened: Array<{ title: string; openedBy: unknown }> = [];
  const putAway: unknown[] = [];
  return {
    region,
    opened,
    putAway,
    api: {
      isNarrating: () => overrides.narrating === true,
      logoFor: () => (overrides.logo === undefined ? { id: "logo" } : overrides.logo),
      titleOf: () => "Coffee tasting",
      fallbackTitle: "Aluna",
      openWindow: (title: string, openedBy: unknown) => {
        opened.push({ title, openedBy });
        return region;
      },
      putAwayUnfilled: (asked: unknown) => {
        putAway.push(asked);
      },
    },
  };
}

/**
 * The pressed control, with the three DOM facts the release scope reads off it. It is
 * connected while it is on the desk and reports itself gone once the swap that answers the
 * press has taken the logo slot it sits in.
 */
function doorwayItem() {
  return {
    getAttribute: () => "coffee_tasting_diary",
    isConnected: true,
    closest: () => null,
    contains: () => false,
  };
}

const deleteItem = doorwayItem();

describe("a press on desk furniture that is about to fill the window", () => {
  test("is the mark the server writes on Delete", () => {
    expect(WINDOW_DOORWAY_SELECTOR).toBe("[data-window-doorway]");
  });

  test("stands the window up and names it after the capability the press is about", () => {
    const root = documentDouble();
    const win = windowDouble();

    answerDoorway(root.root as never, deleteItem, win.api as never);

    // A destructive question under another capability's name is the one place a
    // misattributed title is least affordable.
    expect(win.opened).toEqual([{ title: "Coffee tasting", openedBy: { id: "logo" } }]);
  });

  test("falls back to the desk's own name when the capability has no logo to read", () => {
    const root = documentDouble();
    const win = windowDouble({ logo: null });

    answerDoorway(root.root as never, deleteItem, win.api as never);

    expect(win.opened[0]).toEqual({ title: "Aluna", openedBy: null });
  });

  test("leaves a run that is using the window holding everything it holds", () => {
    const root = documentDouble();
    const win = windowDouble({ narrating: true });

    answerDoorway(root.root as never, deleteItem, win.api as never);

    // The press is about to be refused on the prompt bar (5.8/03's desk-furniture rule).
    // Renaming its frame for a request that never lands would be this press changing
    // something after all — and nothing is left listening for an answer that never comes.
    expect(win.opened).toEqual([]);
    expect(root.listening).toBe(0);
  });

  test("never leaves an empty window standing when the request comes back unsuccessful", () => {
    const root = documentDouble();
    const win = windowDouble();

    answerDoorway(root.root as never, deleteItem, win.api as never);
    root.settle(deleteItem, false);

    expect(win.putAway).toEqual([win.region]);
  });

  test("leaves the window alone when the request succeeds, and listens only once", () => {
    const root = documentDouble();
    const win = windowDouble();

    answerDoorway(root.root as never, deleteItem, win.api as never);
    root.settle(deleteItem, true);
    root.settle(deleteItem, false);

    expect(win.putAway).toEqual([]);
    expect(root.listening).toBe(0);
  });

  test("answers only for the element that asked", () => {
    const root = documentDouble();
    const win = windowDouble();

    answerDoorway(root.root as never, deleteItem, win.api as never);
    root.settle({ somethingElse: true }, false);

    expect(win.putAway).toEqual([]);
    expect(root.listening).toBe(1);
  });

  test("is one rule, shared with the other press that stands a window up first", () => {
    const root = documentDouble();
    const stood: string[] = [];
    const asking = doorwayItem();

    whenTheRequestFails(root.root as never, asking as never, () => stood.push("put away"));
    root.settle(asking, false);

    expect(stood).toEqual(["put away"]);
    expect(root.listening).toBe(0);
  });

  // htmx fires `htmx:afterRequest` *after* the swap, so a swap that detached the pressed
  // control left the event bubbling from a node no longer in the document — it never
  // reached the listener, which stayed on the document for the life of the page holding the
  // detached subtree with it.
  test("the listener goes when the control that made the request leaves the document", async () => {
    const { releaseRegionContent } = await import("#shell/region-scope.js");
    const root = documentDouble();
    const asking = doorwayItem();

    whenTheRequestFails(root.root as never, asking as never, () => {});
    expect(root.listening).toBe(1);

    // The deletion's out-of-band `delete:` takes the whole logo slot, and the doorway is
    // inside it.
    releaseRegionContent(asking as never);

    expect(root.listening).toBe(0);
  });
});
