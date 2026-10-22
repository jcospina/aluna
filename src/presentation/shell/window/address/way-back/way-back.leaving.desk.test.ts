// Every way out of a record leaves the way Back does, on a desk: Save,
// Cancel and a confirmed Delete land where Back would, drawn fresh, and only an exit with unsaved
// changes to lose asks first. A place gone since leaves its capability open, and a read still in
// flight never moves the bar off the entry it is on.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { registerRegionRelease } from "#shell/core/region-scope.js";
import {
  capabilityAddress,
  correctUnfilledAddress,
  pushAddress,
  RECORD_NOT_THERE,
} from "#shell/desk/desk-address.js";
import { backOutOfLeaving } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_GO_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import { READ_UNAVAILABLE_FRAGMENT } from "../../../../../runtime/router/wire/failure-responses.ts";
import { Doc, type El, parseHtml } from "../../../../controls/double/choice-picker.test-support.ts";
import { CAPABILITY } from "../../../../records/record-view/record-view.test-support.ts";
import { RECORD_VIEW_ATTR, recordTitle } from "../../../../records/record-view/record-view.ts";
import { OPENED_BY, type WayBackDesk, wayBackDesk } from "./way-back.test-support.ts";

let desk: WayBackDesk | undefined;
afterEach(() => {
  backOutOfLeaving();
  desk?.restore();
  desk = undefined;
});

/** The notes list, then its note, then the recipe opened from the note: three entries. */
async function recipeFromNote(framed = false, open = OPENED_BY["a listed card"]) {
  desk = await wayBackDesk((places) => places.list("notes"), framed);
  await desk.pressOn(desk.card());
  await open(desk);
  return desk;
}

const onFirstField = (at: WayBackDesk) =>
  at.doc.activeElement === at.view().querySelector('[name="text"]');

describe("Save, Cancel and Delete leave the way Back does", () => {
  const ways: Record<string, (at: WayBackDesk) => void> = {
    Cancel: (at) => at.doc.fire("click", at.view().querySelector("[data-record-cancel]") as El),
    "a committed save": (at) => at.commit("save"),
    "a confirmed delete": (at) => at.commit("delete"),
  };
  for (const [opener, open] of Object.entries(OPENED_BY)) {
    for (const [way, leave] of Object.entries(ways)) {
      test(`${way} on a record opened by ${opener} lands on the record it was opened from, drawn fresh`, async () => {
        const at = await recipeFromNote(false, open);
        leave(at);
        await at.settled();
        expect(at.asked().at(-1)).toBe(at.at.record("notes"));
        await at.tab.arrived();
        expect([at.tab.at(), at.tab.location.pathname]).toStrictEqual([1, at.at.record("notes")]);
        expect(onFirstField(at)).toBe(true);
      });
    }
  }

  test("the record it lands on shows what the save changed", async () => {
    const at = await recipeFromNote();
    const renamed = `Plum jam ${randomUUID()}`;
    at.stored.recipes.text = renamed;
    at.commit("save");
    await at.settled();
    expect(at.listedCard().textContent).toContain(renamed);
  });

  test("a save renaming a record an earlier entry names renames it there too", async () => {
    const at = await recipeFromNote();
    await at.pressOn(at.listedCard());
    // The note again, three entries on: its save lands on the recipe, whose Back names the note.
    const renamed = `Buy almond milk ${randomUUID()}`;
    at.stored.notes.text = renamed;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      at.commit("save");
      await at.settled();
      await at.tab.arrived();
      await at.settled();
      expect(read).toHaveBeenCalledTimes(1);
      expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
      expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
    } finally {
      read.mockRestore();
    }
  });
});

describe("a way out with unsaved changes asks first, and only that", () => {
  const asks = (at: WayBackDesk) => at.doc.querySelector(UNSAVED_LEAVING_SELECTOR) !== null;

  for (const control of ["[data-record-back]", "[data-record-cancel]"]) {
    test(`${control} asks, and a yes goes where Back would`, async () => {
      const at = await recipeFromNote(true);
      at.type("Plum jam");
      const before = at.asked().length;
      await at.pressOn(at.view().querySelector(control) as El);
      expect([asks(at), at.asked().length]).toEqual([true, before]);
      await at.pressOn(at.doc.querySelector(UNSAVED_LEAVING_GO_SELECTOR) as El);
      expect(at.asked().at(-1)).toBe(at.at.record("notes"));
      await at.tab.arrived();
      expect(at.tab.location.pathname).toBe(at.at.record("notes"));
    });
  }

  for (const kind of ["save", "delete"] as const) {
    test(`a committed ${kind} never asks, and goes where Back would`, async () => {
      const at = await recipeFromNote(true);
      at.type("Plum jam");
      at.commit(kind);
      await at.settled();
      expect(asks(at)).toBe(false);
      expect(at.asked().at(-1)).toBe(at.at.record("notes"));
    });
  }
});

describe("a place there that has gone since", () => {
  test("a record leaves its capability open, says so, and its entry names the list", async () => {
    const at = await recipeFromNote();
    at.gone.add(at.at.record("notes"));
    await at.pressOn(at.back());
    expect(at.asked().slice(-2)).toEqual([at.at.record("notes"), at.at.list("notes")]);
    expect(at.said).toEqual([RECORD_NOT_THERE]);
    await at.tab.arrived();
    // As the browser's Back onto a record that has gone leaves it.
    const { list, record } = at.at;
    expect([at.tab.at(), at.tab.entries()]).toEqual([
      1,
      [list("notes"), list("notes"), record("recipes")],
    ]);
    expect(at.doc.querySelector(`[${RECORD_VIEW_ATTR}]`)).toBeNull();
  });

  test("a record whose capability has gone too leaves for the record's own list", async () => {
    const at = await recipeFromNote();
    at.gone.add(at.at.record("notes"));
    at.gone.add(at.at.list("notes"));
    await at.pressOn(at.back());
    const { list, record } = at.at;
    expect(at.asked().slice(-3)).toEqual([record("notes"), list("notes"), list("recipes")]);
    expect(at.said).toEqual([RECORD_NOT_THERE]);
    expect(at.tab.pending()).toEqual([]);
    expect(at.tab.entries()).toEqual([list("notes"), record("notes"), list("recipes")]);
    expect(at.region.querySelector('[data-active-capability-id="recipes"]')).not.toBeNull();
  });

  test("with nothing left to return to, the window goes, and the bar says why once", async () => {
    const at = await recipeFromNote();
    for (const place of [at.at.record("notes"), at.at.list("notes"), at.at.list("recipes")]) {
      at.gone.add(place);
    }
    await at.pressOn(at.back());
    expect(at.said).toEqual([RECORD_NOT_THERE]);
    expect(at.putAway.asked).toBe(1);
    // Nothing was drawn over the record: the desk puts its window away.
    expect(at.view()).not.toBeNull();
  });

  test("a record its capability has no view for opens the list without a word", async () => {
    const at = await recipeFromNote();
    at.bare.add(at.at.record("notes"));
    await at.pressOn(at.back());
    expect(at.asked().slice(-2)).toEqual([at.at.record("notes"), at.at.list("notes")]);
    expect(at.said).toEqual([]);
  });
});

describe("a read still in flight", () => {
  test("a Back pressed while another record lands over the record yields to it", async () => {
    // Opened over Recipes, the note names Recipes; a name pressed over it is still on its way.
    const at = await wayBackDesk((places) => places.list("recipes"));
    desk = at;
    await at.answerLink("notes", at.stored.notes.id);
    at.reads.holding = true;
    const other = randomUUID();
    await at.answerLink("notes", other);
    at.reads.holding = false;
    const before = at.asked().length;
    await at.pressOn(at.back());
    expect(at.asked()).toHaveLength(before);
    await at.release();
    const { list, record } = at.at;
    expect(at.tab.entries()).toEqual([
      list("recipes"),
      record("notes"),
      `${list("notes")}/${other}`,
    ]);
  });

  test("a Back pressed while the browser's Back still reads its place yields to it", async () => {
    const at = await recipeFromNote();
    at.reads.holding = true;
    await at.tab.travel(-1);
    at.reads.holding = false;
    await at.pressOn(at.back());
    await at.release();
    await at.tab.arrived();
    const { list, record } = at.at;
    expect(at.tab.entries()).toEqual([list("notes"), record("notes"), record("recipes")]);
    expect([at.tab.at(), at.view().getAttribute("data-record-title")]).toEqual([
      1,
      recordTitle(CAPABILITY, at.stored.notes),
    ]);
  });

  test("a swap elsewhere while a Back reads the list keeps the list's entry", async () => {
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    at.reads.holding = true;
    await at.tab.travel(-1);
    at.follow();
    expect(at.tab.entries()).toEqual([at.at.list("notes"), at.at.record("notes")]);
    // Forward again before the list lands: the note still stands, and the list's read is let go.
    await at.tab.travel(1);
    await at.release();
    expect(at.tab.entries()).toEqual([at.at.list("notes"), at.at.record("notes")]);
    expect(at.tab.at()).toBe(1);
  });

  test("a renamed title read back before the save's way out lands is the one kept", async () => {
    const at = await recipeFromNote();
    await at.pressOn(at.listedCard());
    const renamed = `Buy almond milk ${randomUUID()}`;
    at.stored.notes.text = renamed;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      at.reads.holding = true;
      at.commit("save");
      await at.settled();
      await at.settled();
      at.reads.holding = false;
      await at.release();
      await at.tab.arrived();
      expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
      expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
    } finally {
      read.mockRestore();
    }
  });
});

describe("titles read back after a save", () => {
  test("the newer save's title stands, whichever read answers last", async () => {
    const at = await recipeFromNote();
    const answers: (() => void)[] = [];
    const read = spyOn(globalThis, "fetch").mockImplementation(((address: string) => {
      const markup = at.drawn(address);
      return new Promise<Response>((resolve) => answers.push(() => resolve(new Response(markup))));
    }) as never);
    try {
      const save = async (text: string) => {
        await at.pressOn(at.listedCard());
        at.stored.notes.text = text;
        at.commit("save");
        await at.settled();
        await at.tab.arrived();
      };
      await save(`Buy rye ${randomUUID()}`);
      await save(`Buy spelt ${randomUUID()}`);
      for (const answer of answers.reverse()) answer();
      await at.settled();
      expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
    } finally {
      read.mockRestore();
    }
  });
});

describe("a record a delete has taken", () => {
  test("is left for its list by the way back that named it, which says nothing", async () => {
    // The note, the recipe listed on it, then the note again: deleted there, it lands on the recipe.
    const at = await recipeFromNote();
    await at.pressOn(at.listedCard());
    at.commit("delete");
    at.gone.add(at.at.record("notes"));
    await at.settled();
    await at.tab.arrived();
    expect(at.names()).toEqual([at.labels.notes, true]);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.list("notes"));
    await at.tab.arrived();
    const { list, record } = at.at;
    expect(at.tab.entries().slice(0, 3)).toEqual([list("notes"), list("notes"), record("recipes")]);
    expect(at.said).toEqual([]);
  });
});

describe("the bar off the record with nothing landing", () => {
  // A press on another logo that failed, say, before the desk put the bar back.
  const offTheRecord = async () => {
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    pushAddress(capabilityAddress("recipes"), at.tab);
    return at;
  };
  const ways: Record<string, (at: WayBackDesk) => Promise<void> | void> = {
    Back: (at) => at.pressOn(at.back()),
    "a committed save": (at) => at.commit("save"),
    "a confirmed delete": (at) => at.commit("delete"),
  };
  for (const [way, leave] of Object.entries(ways)) {
    test(`${way} still leaves, for the record's own list, putting the bar right`, async () => {
      const at = await offTheRecord();
      await leave(at);
      await at.settled();
      expect(at.asked().at(-1)).toBe(at.at.list("notes"));
      expect(at.tab.location.pathname).toBe(at.at.list("notes"));
      expect(at.view()).toBeNull();
    });
  }
});

describe("a save whose record stays on screen", () => {
  /** The note saved renamed, the recipe it was left for a Forward: the title is read back. */
  async function renamedNote(how: (at: WayBackDesk) => Promise<void>) {
    const at = await recipeFromNote();
    await at.tab.travel(-1);
    const renamed = `Buy almond milk ${randomUUID()}`;
    at.stored.notes.text = renamed;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      await how(at);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
    return at;
  }

  test("yielding to the Forward still landing, names its record afresh there", async () => {
    const at = await renamedNote(async (at) => {
      at.reads.holding = true;
      await at.tab.travel(1);
      at.commit("save");
      await at.settled();
      await at.settled();
      at.reads.holding = false;
      await at.releaseAll();
    });
    expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
    expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
  });

  test("whose way out was severed, says its new title from then on", async () => {
    // Opened from its list, no other entry names the note: only its staying on screen asks again.
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    at.stored.notes.text = `Buy almond milk ${randomUUID()}`;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      at.reads.severed = true;
      at.commit("save");
      await at.settled();
      await at.settled();
      at.reads.severed = false;
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
    const renamed = recordTitle(CAPABILITY, at.stored.notes);
    expect(at.view().getAttribute("data-record-title")).toBe(renamed);
    await at.pressOn(at.listedCard());
    expect(at.names()).toEqual([renamed, true]);
  });
});

describe("a way out under way when the person moves", () => {
  test("stops reading, and leaves what the person asked for to land", async () => {
    const at = await recipeFromNote();
    for (const place of [at.at.record("notes"), at.at.list("notes"), at.at.list("recipes")]) {
      at.gone.add(place);
    }
    at.reads.holding = true;
    await at.pressOn(at.back());
    await at.tab.travel(-1);
    await at.releaseAll();
    expect(at.asked()).not.toContain(at.at.list("recipes"));
    expect(at.putAway.asked).toBe(0);
  });
});

describe("a place briefly unreadable on the way", () => {
  test("leaves the record standing, and the bar says why", async () => {
    const at = await recipeFromNote();
    at.busy.add(at.at.record("notes"));
    let released = 0;
    const field = at.view().querySelector('[name="text"]') as El;
    registerRegionRelease(field as never, "a watch on the field", () => released++);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.record("notes"));
    const refusal = parseHtml(READ_UNAVAILABLE_FRAGMENT, new Doc()).children[0] as El;
    expect(released).toBe(0);
    expect(at.said).toEqual([refusal.textContent.trim()]);
    expect(at.tab.entries()).toHaveLength(3);
    expect(at.view().getAttribute("data-record-title")).toBe(
      recordTitle(CAPABILITY, at.stored.recipes),
    );
  });
});

describe("a logo press that failed over the record", () => {
  /** A press on `id`'s logo pushed its address and failed: the desk puts the address back. */
  function failedPress(at: WayBackDesk, id: "notes" | "recipes") {
    const cameFrom = pushAddress(capabilityAddress(id), at.tab);
    return () => {
      correctUnfilledAddress(capabilityAddress(id), cameFrom ?? "/");
      at.follow();
    };
  }

  test("leaves two entries naming the record, and Back steps back over both", async () => {
    const at = await recipeFromNote();
    failedPress(at, "notes")();
    const { list, record } = at.at;
    expect(at.tab.entries()).toEqual([
      list("notes"),
      record("notes"),
      record("recipes"),
      record("recipes"),
    ]);
    expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(record("notes"));
    expect(at.tab.pending()).toEqual([-2]);
    await at.tab.arrived();
    expect(at.tab.at()).toBe(1);
  });

  test("still lets a Back pressed while it was out leave once it is put back", async () => {
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    const fail = failedPress(at, "recipes");
    at.reads.holding = true;
    await at.pressOn(at.back());
    fail();
    at.reads.holding = false;
    await at.releaseAll();
    await at.tab.arrived();
    expect(at.view()).toBeNull();
    expect([at.tab.at(), at.tab.location.pathname]).toEqual([0, at.at.list("notes")]);
  });
});

describe("a save whose way out is overtaken", () => {
  test("still reads its record's title again, for the record that took its place", async () => {
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    at.stored.notes.text = `Buy almond milk ${randomUUID()}`;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      at.reads.holding = true;
      at.commit("save");
      await at.settled();
      at.reads.holding = false;
      await at.pressOn(at.listedCard());
      await at.releaseAll();
      await at.settled();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
    expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
    expect(at.names()).toEqual([recordTitle(CAPABILITY, at.stored.notes), true]);
  });
});

describe("the person moving while the way out reads", () => {
  test("Back then a name pressed lands the name, and the way out draws nothing", async () => {
    const at = await recipeFromNote();
    at.reads.holding = true;
    await at.pressOn(at.back());
    await at.tab.travel(-1);
    const other = randomUUID();
    await at.answerLink("notes", other);
    await at.releaseAll();
    const { list, record } = at.at;
    expect(at.tab.entries()).toEqual([list("notes"), record("notes"), `${list("notes")}/${other}`]);
    expect(at.tab.location.pathname).toBe(`${list("notes")}/${other}`);
  });

  test("Back then Forward keeps the entry the person came forward to", async () => {
    const at = await recipeFromNote();
    at.reads.holding = true;
    await at.pressOn(at.back());
    await at.tab.travel(-1);
    await at.tab.travel(1);
    await at.releaseAll();
    const { list, record } = at.at;
    expect(at.tab.entries()).toEqual([list("notes"), record("notes"), record("recipes")]);
    expect(at.tab.at()).toBe(2);
  });
});

describe("a way out the server cannot draw", () => {
  test("leaves the record standing and working, and a save reads its title again", async () => {
    const at = await wayBackDesk((places) => places.list("notes"));
    desk = at;
    await at.pressOn(at.card());
    at.broken.add(at.at.list("notes"));
    let released = 0;
    const field = at.view().querySelector('[name="text"]') as El;
    registerRegionRelease(field as never, "a watch on the field", () => released++);
    at.stored.notes.text = `Buy almond milk ${randomUUID()}`;
    const read = spyOn(globalThis, "fetch").mockImplementation(
      (async (address: string) => new Response(at.drawn(address))) as never,
    );
    try {
      at.commit("save");
      await at.settled();
      await at.settled();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
    expect([at.view() !== null, released]).toEqual([true, 0]);
    expect(at.view().getAttribute("data-record-title")).toBe(
      recordTitle(CAPABILITY, at.stored.notes),
    );
  });
});
