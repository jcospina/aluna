// Who moves the address, settled by running the desk: `public/desk/window/desk-window.js` started the way the
// page starts it, on logos the server renders, with the browser's bar and htmx recording what they
// are asked. One gesture, one entry; everything else corrects in place or writes nothing at all
// (design D14; ARCH §6.1).

import { afterEach, describe, expect, test } from "bun:test";
import { CONTENT_REGION_SELECTOR } from "#shell/core/region-scope.js";
import { BUILD_JOB_ID_ATTRIBUTE } from "#shell/core/shell-dom.js";
import {
  capabilityAddress,
  DESK_ADDRESS,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "#shell/desk/window/desk-window.js";
import { renderCapabilitySurface } from "../../../../server/http/fragments/fragments.ts";
import { type El, pressLamp } from "../standing-desk.test-support.ts";
import {
  deskNodes,
  serverLogo,
  type ViewportDesk,
  viewportDesk,
} from "../viewport-desk.test-support.ts";

const LOGOS = [serverLogo("notes", "Notes"), serverLogo("recipes", "Recipes")];

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

async function deskAt(pathname: string, answer?: () => Promise<unknown>, laidOut = true) {
  screen = await viewportDesk({ pathname, logos: LOGOS, answer, laidOut });
  const opened = screen;
  const bar = opened.desk.address;
  // The start stamps the entry it loaded into, spelled as it stands, and writes nothing else.
  expect(bar.written[0]).toBe(`replace ${pathname}`);
  return {
    ...opened,
    /** What the desk wrote to the bar after it started, the start's own stamp left out. */
    written: () => bar.written.slice(1),
    logo: (name: string) => opened.desk.root.querySelector(`[aria-label="Open ${name}"]`) as El,
    press: (on: El) => on.dispatchEvent({ type: "click", target: on } as never),
    /** A request the desk sees htmx about to make, and whether the desk cancelled it. */
    request(elt: El) {
      let cancelled = false;
      opened.desk.doc.dispatchEvent({
        type: "htmx:beforeRequest",
        detail: { elt },
        preventDefault: () => {
          cancelled = true;
        },
      } as never);
      return cancelled;
    },
    region: () => opened.desk.windows()[0]?.querySelector(CONTENT_REGION_SELECTOR) ?? null,
  };
}

/** What the server swaps in when a capability opens: its surface, standing in the region. */
function land(region: El | null, id: string) {
  region?.append(
    ...deskNodes(renderCapabilitySurface({ id, incarnation_id: "i", version: 1 }, "")),
  );
}

describe("a press on a logo", () => {
  test("opens the window under the logo's name and pushes the logo's own address", async () => {
    const desk = await deskAt(DESK_ADDRESS);
    desk.press(desk.logo("Notes"));
    const [el] = desk.desk.windows();
    expect(el?.querySelector("h2")?.textContent).toBe("Notes");
    expect(desk.written()).toEqual([`push ${capabilityAddress("notes")}`]);
    // One spelling: the press pushes what the logo is fetched from.
    expect(desk.logo("Notes").getAttribute("hx-get")).toBe(capabilityAddress("notes"));
  });

  test("on the capability already standing in the window asks the server for nothing", async () => {
    // htmx resolves a press into a request from a listener on the logo itself, without consulting
    // `defaultPrevented`, so cancelling `htmx:beforeRequest` is the only thing that stops it.
    const desk = await deskAt(DESK_ADDRESS);
    desk.press(desk.logo("Notes"));
    land(desk.region(), "notes");
    expect(desk.request(desk.logo("Notes"))).toBe(true);
    expect(desk.request(desk.logo("Recipes"))).toBe(false);
    // A faceless tile's one-attempt POST fires from inside the logo, and is not this press.
    expect(desk.request(desk.logo("Notes").children[0] as El)).toBe(false);
  });

  test("on a capability a run has covered is a way back to it, and goes ahead", async () => {
    const desk = await deskAt(DESK_ADDRESS);
    desk.press(desk.logo("Notes"));
    land(desk.region(), "notes");
    desk.region()?.append(...deskNodes(`<section ${BUILD_JOB_ID_ATTRIBUTE}="build-1"></section>`));
    expect(desk.request(desk.logo("Notes"))).toBe(false);
  });

  test("that answers unsuccessfully takes its window back and puts the address back", async () => {
    const desk = await deskAt(DESK_ADDRESS);
    const notes = desk.logo("Notes");
    desk.press(notes);
    desk.desk.doc.dispatchEvent({
      type: "htmx:afterRequest",
      detail: { elt: notes, successful: false },
    } as never);
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([
      `push ${capabilityAddress("notes")}`,
      `replace ${DESK_ADDRESS}`,
    ]);
  });
});

describe("a press that fails", () => {
  test("from a capability's own address puts that address back, not the bare desk", async () => {
    // Loaded at Recipes, whose read is still coming: the press on Notes pushes, fails, and the
    // address it came from is Recipes, still standing in the bar's history behind it.
    const desk = await deskAt(capabilityAddress("recipes"), () => new Promise(() => {}));
    const notes = desk.logo("Notes");
    desk.press(notes);
    desk.desk.doc.dispatchEvent({
      type: "htmx:afterRequest",
      detail: { elt: notes, successful: false },
    } as never);
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([
      `push ${capabilityAddress("notes")}`,
      `replace ${capabilityAddress("recipes")}`,
    ]);
  });

  for (const unnamed of ["no id", "an empty id"]) {
    test(`on a logo with ${unnamed} pushes nothing, so puts nothing back`, async () => {
      const desk = await deskAt(capabilityAddress("recipes"), () => new Promise(() => {}));
      const nameless = desk.logo("Notes");
      if (unnamed === "no id") nameless.removeAttribute("data-capability-id");
      else nameless.setAttribute("data-capability-id", "");
      desk.press(nameless);
      expect(desk.desk.windows()).toHaveLength(1);
      expect(desk.written()).toEqual([]);
      desk.desk.doc.dispatchEvent({
        type: "htmx:afterRequest",
        detail: { elt: nameless, successful: false },
      } as never);
      expect(desk.desk.windows()).toEqual([]);
      expect(desk.written()).toEqual([]);
    });
  }
});

describe("a press that fails late", () => {
  test("leaves the address where the person has since put it", async () => {
    // A logo attempt can run for the better part of a minute, and the person may have moved on.
    const desk = await deskAt(DESK_ADDRESS);
    const notes = desk.logo("Notes");
    desk.press(notes);
    desk.desk.address.pathname = capabilityAddress("recipes");
    desk.desk.doc.dispatchEvent({
      type: "htmx:afterRequest",
      detail: { elt: notes, successful: false },
    } as never);
    expect(desk.written()).toEqual([`push ${capabilityAddress("notes")}`]);
  });
});

describe("the clay lamp", () => {
  test("puts the window away and pushes the bare desk", async () => {
    const desk = await deskAt(DESK_ADDRESS);
    desk.press(desk.logo("Notes"));
    pressLamp(desk.desk.windows()[0] as El, "putaway");
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written().at(-1)).toBe(`push ${DESK_ADDRESS}`);
  });
});

describe("an address the page loads at", () => {
  test("opens with the read the logo's own press asks for, and writes nothing", async () => {
    // Held open: a read that has not answered yet is a window still waiting to be filled.
    const desk = await deskAt(`${capabilityAddress("notes")}/`, () => new Promise(() => {}));
    const region = desk.region();
    const [asked, ...more] = desk.htmx.requests;
    expect(more).toEqual([]);
    expect(asked).toMatchObject({
      verb: "GET",
      path: capabilityAddress("notes"),
      context: { target: region, swap: "innerHTML" },
    });
    // From an element of the address's own, outside the window: not the logo, since htmx queues a
    // second request from one element and a press listens to the logo's own endings.
    const source = asked?.context.source as El;
    expect(source).not.toBe(desk.logo("Notes"));
    expect(source.isConnected).toBe(true);
    expect(desk.desk.windows()[0]?.contains(source)).toBe(false);
    expect(desk.written()).toEqual([]);
  });

  test("that never fills leaves the bare desk rather than an address nobody is looking at", async () => {
    const desk = await deskAt(capabilityAddress("notes"));
    await Bun.sleep(0);
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([`replace ${DESK_ADDRESS}`]);
  });

  test("a Back is answered by the same opener, and writes nothing", async () => {
    // The read lands a turn later, the way a network answer does, into the window it opened.
    const desk = await deskAt(capabilityAddress("notes"), async () => {
      await Bun.sleep(1);
      land(screen?.desk.windows()[0]?.querySelector(CONTENT_REGION_SELECTOR) ?? null, "notes");
    });
    await Bun.sleep(5);
    expect(desk.desk.windows()).toHaveLength(1);

    desk.desk.address.pathname = DESK_ADDRESS;
    const popstate = (
      (globalThis as unknown as { window: unknown }).window as {
        onpopstate: (event: unknown) => void;
      }
    ).onpopstate;
    popstate({ state: null });
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.written()).toEqual([]);
  });

  test("a Back onto the bare desk cancels an open still waiting for a desk to measure", async () => {
    // A press and a submit cancel a waiting open by mounting a window. A Back takes a window down,
    // so without this a Back during a cold load is answered by the window opening anyway.
    const desk = await deskAt(capabilityAddress("notes"), undefined, false);
    expect(desk.desk.windows()).toEqual([]);
    desk.desk.address.pathname = DESK_ADDRESS;
    (
      (globalThis as unknown as { window: unknown }).window as {
        onpopstate: (event: unknown) => void;
      }
    ).onpopstate({
      state: null,
    });
    desk.layOut();
    expect(desk.desk.windows()).toEqual([]);
    expect(desk.htmx.requests).toEqual([]);
  });

  test("the newest of two waiting opens is the one that opens", async () => {
    const desk = await deskAt(capabilityAddress("notes"), undefined, false);
    desk.desk.address.pathname = capabilityAddress("recipes");
    (
      (globalThis as unknown as { window: unknown }).window as {
        onpopstate: (event: unknown) => void;
      }
    ).onpopstate({
      state: null,
    });
    desk.layOut();
    expect(desk.htmx.requests.map(({ path }) => path)).toEqual([capabilityAddress("recipes")]);
  });
});

describe("the window changing hands", () => {
  test("corrects the spelling of the bar, and only a navigation pushes", async () => {
    const desk = await deskAt(DESK_ADDRESS);
    desk.press(desk.logo("Notes"));
    const took = (navigated: boolean) =>
      desk.desk.doc.dispatchEvent({ type: WINDOW_TOOK_CAPABILITY_EVENT, detail: { navigated } });
    // Nothing standing in the window yet names no address to correct to.
    const pressed = desk.written().length;
    took(false);
    expect(desk.written()).toHaveLength(pressed);
    land(desk.region(), "notes");
    // A bar already exactly right is left alone; a trailing slash alone is still corrected.
    took(false);
    expect(desk.written()).toHaveLength(pressed);
    desk.desk.address.pathname = `${capabilityAddress("notes")}/`;
    took(false);
    expect(desk.written()).toHaveLength(pressed + 1);
    expect(desk.written().at(-1)).toBe(`replace ${capabilityAddress("notes")}`);
    desk.desk.address.pathname = `${capabilityAddress("notes")}/`;
    desk.desk.address.search = "?q=milk";
    took(false);
    expect(desk.written().at(-1)).toBe(`replace ${capabilityAddress("notes")}`);
    took(false);
    expect(desk.written().filter((entry) => entry.startsWith("push"))).toHaveLength(1);
    // Exactly the right path is not enough: a query string from outside is corrected away too.
    desk.desk.address.pathname = capabilityAddress("notes");
    desk.desk.address.search = "?q=milk";
    took(false);
    expect(desk.written().at(-1)).toBe(`replace ${capabilityAddress("notes")}`);
    expect(desk.desk.address.search).toBe("");
    desk.region()?.replaceChildren();
    land(desk.region(), "recipes");
    took(true);
    expect(desk.written().at(-1)).toBe(`push ${capabilityAddress("recipes")}`);
    expect(desk.desk.windows()[0]?.querySelector("h2")?.textContent).toBe("Recipes");
  });
});
