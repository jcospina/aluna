// Addresses the desk opens a window for, settled by running the desk (`public/desk/window/desk-window.js`)
// the way the page starts it. A record address asks for the record; a record that is not there
// leaves its capability open with the address corrected in place (ADR-0010).

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import { PROMPT_FORM_ID } from "#shell/core/shell-dom.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import {
  capabilityAddress,
  DESK_ADDRESS,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "#shell/desk/window/desk-window.js";
import { notesSpec } from "../../../../registry/spec/spec.test-support.ts";
import { createCapabilityActionRecord } from "../../../../runtime/data/index.ts";
import { NOT_FOUND_FRAGMENT } from "../../../../runtime/router/wire/failure-responses.ts";
import { renderCapabilitySurface } from "../../../../server/http/fragments/fragments.ts";
import { renderableFromSpec, renderPresentedRecordView } from "../../../index.ts";
import type { El } from "../standing-desk.test-support.ts";
import {
  deskNodes,
  serverLogo,
  type ViewportDesk,
  viewportDesk,
} from "../viewport-desk.test-support.ts";

const RECORD = randomUUID();
const LOGOS = [serverLogo("notes", "Notes"), serverLogo("recipes", "Recipes")];

/** How one request ends, given a turn to land in, or held until `gate` opens. */
interface Ending {
  readonly status: number;
  readonly gate?: Promise<void>;
}

let screen: ViewportDesk | undefined;
/** Whether each request was asked from inside the window, as `public/app.js` reads it. */
let askedFromWindow: boolean[] = [];
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A gate a test opens when it has done what it needs to while a request is in flight. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** What the server sends a request it answers: a record's view, or a collection's scaffolding. */
function answerFor(path: string): string {
  const [, , id = "", record] = path.split("/");
  const surface = { id, incarnation_id: "i", version: 1 };
  if (record === undefined) return renderCapabilitySurface(surface, "");
  const capability = renderableFromSpec(notesSpec({ id }));
  const stored = createCapabilityActionRecord({
    id: record,
    created_at: "2026-10-04T00:00:00.000Z",
    text: "Buy figs",
    pinned: false,
  });
  return renderCapabilitySurface(surface, renderPresentedRecordView(capability, stored));
}

/**
 * End request `index` where and in the order htmx 2 ends it: `htmx:beforeSwap` and
 * `htmx:afterSwap` on the target, then on the element that asked a refusal and
 * `htmx:afterRequest` (a severed request sends `htmx:afterRequest` before `htmx:sendError`), each
 * naming that element as `requestConfig.elt`. A success is swapped in, and so is a refusal asked from inside the window
 * (`public/app.js`), unless a listener said otherwise.
 */
async function end(index: number, ending: Ending) {
  await (ending.gate ?? Bun.sleep(1));
  const asked = screen?.htmx.requests[index];
  const source = asked?.context.source as El | undefined;
  const target = asked?.context.target as El | undefined;
  const { status } = ending;
  const inWindow = target?.contains(source) === true;
  askedFromWindow[index] = inWindow;
  const detail = {
    requestConfig: { elt: source },
    xhr: { status },
    shouldSwap: status === 200 || (status !== 0 && inWindow),
  };
  const send = (on: El | undefined, type: string, more = {}) =>
    on?.dispatchEvent({ type, bubbles: true, detail: Object.assign(detail, more) } as never);
  const outcome = status === 0 ? {} : { successful: status === 200 };
  if (status === 0) {
    send(source, "htmx:afterRequest", outcome);
    send(source, "htmx:sendError");
    return;
  }
  swap(target, detail, status === 200 ? answerFor(asked?.path ?? "") : null, send);
  if (status !== 200) send(source, "htmx:responseError");
  send(source, "htmx:afterRequest", outcome);
}

/** A swap's half of an ending: asked about, then drawn if nobody said no. */
function swap(
  target: El | undefined,
  detail: { shouldSwap: boolean },
  answer: string | null,
  send: (on: El | undefined, type: string) => void,
) {
  send(target, "htmx:beforeSwap");
  if (!detail.shouldSwap) return;
  target?.replaceChildren(...deskNodes(answer ?? NOT_FOUND_FRAGMENT));
  send(target, "htmx:afterSwap");
}

/** The desk loaded at `pathname`, each request ending the next way, in turn. */
async function deskAnswering(
  pathname: string,
  endings: readonly (Ending | number)[],
  hearPromptBar?: (event: { detail?: unknown }) => void,
) {
  const queue = endings.map((one) => (typeof one === "number" ? { status: one } : one));
  let asks = 0;
  askedFromWindow = [];
  screen = await viewportDesk({
    pathname,
    logos: LOGOS,
    answer: () => end(asks++, queue.shift() ?? { status: 0 }),
  });
  if (hearPromptBar) screen.desk.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, hearPromptBar);
  await Bun.sleep(10);
  const opened = screen;
  const logo = (name: string) =>
    opened.desk.root.querySelector(`[aria-label="Open ${name}"]`) as El;
  const region = () => opened.htmx.requests[0]?.context.target as El;
  return {
    ...opened,
    logo,
    region,
    asked: () => opened.htmx.requests.map(({ path }) => path),
    written: () => opened.desk.address.written.slice(1),
    title: () => opened.desk.windows()[0]?.querySelector("h2")?.textContent,
    /** A Back or Forward onto `next`, answered by the desk's own traversal listener. */
    async travelTo(next: string) {
      opened.desk.address.pathname = next;
      const bar = (globalThis as unknown as { window: { onpopstate: (e: unknown) => void } })
        .window;
      bar.onpopstate({ state: null });
      await Bun.sleep(10);
    },
    /** The window changing hands, as `public/app.js` says it after every swap. */
    tookCapability() {
      opened.desk.doc.dispatchEvent({
        type: WINDOW_TOOK_CAPABILITY_EVENT,
        detail: { navigated: false },
      } as never);
    },
  };
}

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
    expect(askedFromWindow).toEqual([false, true]);
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
