// Addresses the desk opens a window for, settled by running the desk (`public/desk/window/desk-window.js`)
// the way the page starts it. A record address asks for the record; a record that is not there
// leaves its capability open with the address corrected in place (ADR-0010).

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import { PROMPT_FORM_ID } from "#shell/core/shell-dom.js";
import {
  capabilityAddress,
  DESK_ADDRESS,
  PUT_WINDOW_AWAY_EVENT,
} from "#shell/desk/window/desk-window.js";
import { NOT_FOUND_FRAGMENT } from "../../../../runtime/router/wire/failure-responses.ts";
import type { El } from "../standing-desk.test-support.ts";
import { deskNodes } from "../viewport-desk.test-support.ts";
import {
  answerFor,
  askedFrom,
  deskAnswering,
  gate,
  RECORD,
  restoreDesk,
} from "./record-address-desk.test-support.ts";

afterEach(restoreDesk);

describe("a page loaded at a record address", () => {
  test("asks for the record in the window, under the capability's name, and writes nothing", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200]);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    expect(desk.desk.windows()).toHaveLength(1);
    expect(desk.title()).toBe("Notes");
    expect(desk.region().querySelector("[data-record-view]")).not.toBeNull();
    expect(desk.written()).toEqual([]);
  });

  test("keeps its address as the record lands, and spells it as the desk does", async () => {
    const desk = await deskAnswering(`/capability/notes/${RECORD.toUpperCase()}/`, [200]);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    desk.tookCapability();
    expect(desk.written()).toEqual([`replace ${recordAddress("notes", RECORD)}`]);
  });

  test("gives way to the collection's address once the collection takes the window", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200]);
    desk.tookCapability();
    expect(desk.written()).toEqual([]);
    desk.region().replaceChildren(...deskNodes(answerFor(capabilityAddress("notes"))));
    desk.tookCapability();
    expect(desk.written()).toEqual([`replace ${capabilityAddress("notes")}`]);
  });

  test("puts the person on the record's first field", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200]);
    // `text`, the notes fixture's first field.
    const first = desk.region().querySelector('[name="text"]');
    expect(first).not.toBeNull();
    expect(desk.desk.doc.activeElement).toBe(first as El);
  });

  test("whose record is not there keeps the window and opens the collection in it", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [404, 200]);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD), capabilityAddress("notes")]);
    // Asked from inside the window, which leaves the prompt bar saying what the record's answer said.
    const [first, fallback] = desk.htmx.requests;
    expect(desk.desk.windows()[0]?.contains(first?.context.source as El)).toBe(false);
    expect(askedFrom()).toEqual([false, true]);
    expect(fallback?.context.target).toBe(first?.context.target);
    expect(desk.region().querySelector('[data-active-capability-id="notes"]')).not.toBeNull();
    expect(desk.written()).toEqual([`replace ${capabilityAddress("notes")}`]);
  });

  test("whose capability then goes too leaves the bare desk, the refusal drawn in it and all", async () => {
    const said: unknown[] = [];
    const hear = (event: { detail?: unknown }) => said.push(event.detail);
    const desk = await deskAnswering(recordAddress("notes", RECORD), [404, 404], hear);
    expect(desk.desk.windows()).toEqual([]);
    // The second refusal was drawn in the window, so its sentence moved to the prompt bar with it.
    const sentence = (deskNodes(NOT_FOUND_FRAGMENT)[0] as El).textContent?.trim();
    expect(said).toEqual([{ sentence, refused: true }]);
    expect(desk.written()).toEqual([
      `replace ${capabilityAddress("notes")}`,
      `replace ${DESK_ADDRESS}`,
    ]);
  });

  for (const status of [409, 500, 0]) {
    test(`answered ${status} leaves the bare desk without asking for the collection`, async () => {
      const desk = await deskAnswering(recordAddress("notes", RECORD), [status]);
      expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
      expect(desk.desk.windows()).toEqual([]);
      expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
    });
  }

  test("naming a capability the desk is not standing opens nothing", async () => {
    const desk = await deskAnswering(recordAddress("ghosts", RECORD), []);
    expect(desk.asked()).toEqual([]);
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
  });
});

describe("a record address still loading when the window is taken", () => {
  for (const status of [200, 404, 409]) {
    test(`by a press, answered ${status}, leaves the press its window`, async () => {
      const held = gate();
      const desk = await deskAnswering(recordAddress("notes", RECORD), [
        { status, gate: held.opened },
      ]);
      desk.logo("Recipes").click();
      // The press's own read lands first; the record's answer is no longer the window's.
      desk.region().replaceChildren(...deskNodes(answerFor(capabilityAddress("recipes"))));
      held.open();
      await Bun.sleep(10);
      expect(desk.desk.windows()).toHaveLength(1);
      expect(desk.title()).toBe("Recipes");
      expect(desk.region().querySelector('[data-active-capability-id="recipes"]')).not.toBeNull();
      expect(desk.region().querySelector("[data-record-view]")).toBeNull();
      expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
      expect(desk.written()).toEqual([`push ${capabilityAddress("recipes")}`]);
    });
  }

  test("by a prompt, is not answered into the run", async () => {
    const held = gate();
    const desk = await deskAnswering(recordAddress("notes", RECORD), [
      { status: 404, gate: held.opened },
    ]);
    const form = desk.desk.root.querySelector(`#${PROMPT_FORM_ID}`) as El;
    form.dispatchEvent({ type: "submit", target: form } as never);
    held.open();
    await Bun.sleep(10);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    expect(desk.desk.windows()).toHaveLength(1);
    expect(desk.written()).toEqual([]);

    // The run gives the window back with nothing in it, and the bar follows it to the bare desk.
    desk.desk.doc.dispatchEvent({ type: PUT_WINDOW_AWAY_EVENT } as never);
    expect(desk.desk.windows()).toHaveLength(0);
    expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
    desk.desk.doc.dispatchEvent({ type: PUT_WINDOW_AWAY_EVENT } as never);
    expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
  });

  test("by a record the person opened in it, keeps that record", async () => {
    const held = gate();
    const desk = await deskAnswering(capabilityAddress("notes"), [
      200,
      { status: 200, gate: held.opened },
    ]);
    await desk.travelTo(recordAddress("notes", RECORD));
    // A card press opens another record in the collection standing there, in place.
    const pressed = randomUUID();
    desk.region().replaceChildren(...deskNodes(answerFor(recordAddress("notes", pressed))));
    held.open();
    await Bun.sleep(10);
    expect(desk.region().querySelector(`[value="${pressed}"]`)).not.toBeNull();
    expect(desk.region().querySelector(`[value="${RECORD}"]`)).toBeNull();
    expect(desk.desk.windows()).toHaveLength(1);
  });

  test("by an address naming what the window already shows, stands aside", async () => {
    const held = gate();
    const desk = await deskAnswering(capabilityAddress("notes"), [
      200,
      { status: 200, gate: held.opened },
    ]);
    await desk.travelTo(recordAddress("notes", RECORD));
    await desk.travelTo(capabilityAddress("notes"));
    held.open();
    await Bun.sleep(10);
    expect(desk.asked()).toEqual([capabilityAddress("notes"), recordAddress("notes", RECORD)]);
    expect(desk.region().querySelector("[data-record-view]")).toBeNull();
  });

  test("by a record opened and left again, keeps the collection the person came back to", async () => {
    const held = gate();
    const desk = await deskAnswering(capabilityAddress("notes"), [
      200,
      { status: 200, gate: held.opened },
    ]);
    await desk.travelTo(recordAddress("notes", RECORD));
    desk.region().replaceChildren(...deskNodes(answerFor(recordAddress("notes", randomUUID()))));
    // Its way back asks for the collection from inside the window, and that answer swaps in.
    const back = deskNodes("<span></span>")[0] as El;
    const detail = { requestConfig: { elt: back }, shouldSwap: true };
    desk.region().dispatchEvent({ type: "htmx:beforeSwap", bubbles: true, detail } as never);
    desk.region().replaceChildren(...deskNodes(answerFor(capabilityAddress("notes"))));
    desk.region().dispatchEvent({ type: "htmx:afterSwap", bubbles: true, detail } as never);
    held.open();
    await Bun.sleep(10);
    expect(desk.region().querySelector("[data-record-view]")).toBeNull();
    expect(desk.region().querySelector('[data-active-capability-id="notes"]')).not.toBeNull();
  });

  test("leaves focus where the person has since put it", async () => {
    const held = gate();
    const desk = await deskAnswering(recordAddress("notes", RECORD), [
      { status: 200, gate: held.opened },
    ]);
    const elsewhere = desk.logo("Recipes");
    elsewhere.focus();
    held.open();
    await Bun.sleep(10);
    expect(desk.region().querySelector("[data-record-view]")).not.toBeNull();
    expect(desk.desk.doc.activeElement).toBe(elsewhere);
  });
});

describe("a traversal while a window stands", () => {
  test("onto a record of the capability standing there asks for it", async () => {
    const desk = await deskAnswering(capabilityAddress("notes"), [200, 200]);
    await desk.travelTo(recordAddress("notes", RECORD));
    expect(desk.asked()).toEqual([capabilityAddress("notes"), recordAddress("notes", RECORD)]);
    expect(desk.region().querySelector("[data-record-view]")).not.toBeNull();
    expect(desk.written()).toEqual([]);
  });

  test("off a record onto its own collection asks for the collection", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200, 200]);
    await desk.travelTo(capabilityAddress("notes"));
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD), capabilityAddress("notes")]);
    expect(desk.region().querySelector("[data-record-view]")).toBeNull();
  });

  test("onto a record keeps its address while the collection's own records land first", async () => {
    const held = gate();
    const desk = await deskAnswering(capabilityAddress("notes"), [
      200,
      { status: 200, gate: held.opened },
    ]);
    await desk.travelTo(recordAddress("notes", RECORD));
    desk.tookCapability();
    expect(desk.written()).toEqual([]);
    held.open();
    await Bun.sleep(10);
    desk.tookCapability();
    expect(desk.desk.address.pathname).toBe(recordAddress("notes", RECORD));
    expect(desk.written()).toEqual([]);
  });

  test("onto the record the window already holds asks for nothing", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200]);
    await desk.travelTo(`/capability/notes/${RECORD.toUpperCase()}`);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
  });

  test("onto another capability's absent record opens that collection in the window", async () => {
    const desk = await deskAnswering(capabilityAddress("notes"), [200, 404, 200]);
    await desk.travelTo(recordAddress("recipes", RECORD));
    expect(desk.asked()).toEqual([
      capabilityAddress("notes"),
      recordAddress("recipes", RECORD),
      capabilityAddress("recipes"),
    ]);
    expect(desk.desk.windows()).toHaveLength(1);
    expect(desk.title()).toBe("Recipes");
    expect(desk.region().querySelector('[data-active-capability-id="recipes"]')).not.toBeNull();
    expect(desk.region().querySelector('[data-active-capability-id="notes"]')).toBeNull();
    expect(desk.written()).toEqual([`replace ${capabilityAddress("recipes")}`]);
  });

  for (const status of [409, 0]) {
    test(`refused ${status}, keeps what it held, under that name and that address`, async () => {
      const desk = await deskAnswering(capabilityAddress("notes"), [200, status]);
      await desk.travelTo(recordAddress("recipes", RECORD));
      expect(desk.desk.windows()).toHaveLength(1);
      expect(desk.title()).toBe("Notes");
      expect(desk.region().querySelector('[data-active-capability-id="notes"]')).not.toBeNull();
      expect(desk.written()).toEqual([`replace ${capabilityAddress("notes")}`]);
    });
  }
});

describe("asks that overlap", () => {
  test("an older answer turned away does not turn away the newer one", async () => {
    const older = gate();
    const newer = gate();
    const desk = await deskAnswering(capabilityAddress("notes"), [
      200,
      { status: 200, gate: older.opened },
      { status: 200, gate: newer.opened },
    ]);
    await desk.travelTo(recordAddress("notes", RECORD));
    await desk.travelTo(capabilityAddress("recipes"));
    older.open();
    await Bun.sleep(10);
    newer.open();
    await Bun.sleep(10);
    expect(desk.title()).toBe("Recipes");
    expect(desk.region().querySelector('[data-active-capability-id="recipes"]')).not.toBeNull();
    expect(desk.region().querySelector("[data-record-view]")).toBeNull();
  });

  test("a second render of the place being filled asks nothing more", async () => {
    const held = gate();
    const desk = await deskAnswering(recordAddress("notes", RECORD), [
      { status: 200, gate: held.opened },
    ]);
    // A hash change arrives as a traversal onto the same address.
    await desk.travelTo(recordAddress("notes", RECORD));
    held.open();
    await Bun.sleep(10);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    expect(desk.region().querySelector("[data-record-view]")).not.toBeNull();
  });

  test("refused over a record view, the bar goes back to that record", async () => {
    const desk = await deskAnswering(recordAddress("notes", RECORD), [200, 0]);
    await desk.travelTo(capabilityAddress("notes"));
    expect(desk.region().querySelector("[data-record-view]")).not.toBeNull();
    expect(desk.written()).toEqual([`replace ${recordAddress("notes", RECORD)}`]);
  });

  test("refused over something that is not a capability, the window goes", async () => {
    const desk = await deskAnswering(capabilityAddress("notes"), [200, 409]);
    desk.region().replaceChildren(...deskNodes("<p>A run, read and not dismissed.</p>"));
    await desk.travelTo(recordAddress("recipes", RECORD));
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
  });
});

describe("a page loaded at a collection's address", () => {
  for (const status of [404, 409, 0]) {
    test(`refused ${status} leaves the bare desk, not an address naming nothing open`, async () => {
      const desk = await deskAnswering(capabilityAddress("notes"), [status]);
      expect(desk.asked()).toEqual([capabilityAddress("notes")]);
      expect(desk.desk.windows()).toEqual([]);
      expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
    });
  }
});
