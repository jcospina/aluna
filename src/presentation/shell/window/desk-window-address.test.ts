import { describe, expect, test } from "bun:test";
import { answerTraversal, startDeskHistory, travelled } from "#shell/desk-address.js";
import {
  ACTIVE_CAPABILITY_ATTRIBUTE,
  addressAsks,
  capabilityAddress,
  capabilityIdFromAddress,
  capabilityInWindow,
  DESK_ADDRESS,
  DESK_HISTORY_STATE,
  deskHistory,
  isAnotherPlace,
  PROMPT_FORM_ID,
  pressWouldOpen,
  pushAddress,
  replaceAddress,
} from "#shell/desk-window.js";
import { WINDOW_CONTENT_ID } from "#shell/shell-dom.js";
import {
  El as ShellEl,
  desk as shellDesk,
  streamRestoration,
} from "../../../server/app.shell-double.test-support.ts";
import { renderCapabilityLogo, renderPromptNotice } from "../../../server/http/fragments.ts";
import { byId, elementsOf } from "../../../server/http/served-page.test-support.ts";
import { readSource as read } from "../../safety/source.test-support.ts";

// The address, and the whole of what it may say: `/capability/:id` and nothing below it. A search
// term, an open record and a draft die with the tab (design D14; PLAN decision 6; ARCH §6.1).

/** The address bar and its history, recorded rather than driven. */
function barAt(pathname: string, search = "") {
  const wrote: { how: string; state: unknown; address: string }[] = [];
  return {
    location: { pathname, search },
    history: {
      pushState: (state: unknown, _unused: string, address: string) =>
        wrote.push({ how: "push", state, address }),
      replaceState: (state: unknown, _unused: string, address: string) =>
        wrote.push({ how: "replace", state, address }),
      go: (delta: number) => wrote.push({ how: "go", state: delta, address: "" }),
    },
    wrote,
  };
}

/**
 * Where the desk currently thinks it is, discovered by writing one entry and reading the number
 * back off it. The count is the module's own, so a test spelling a Back has to ask.
 */
function here(): number {
  const bar = barAt("/probe");
  pushAddress("/capability/probe", bar);
  return (bar.wrote[0]?.state as { index: number }).index;
}

/** One step back, and the entry it lands on. */
function back() {
  const at = here();
  return { here: at, event: { state: { ...DESK_HISTORY_STATE, index: at - 1 } } };
}

/** One capability's identity, as the surface standing in the window carries it. */
const TASKS = {
  [ACTIVE_CAPABILITY_ATTRIBUTE]: "tasks",
  "data-active-capability-incarnation": "inc-1",
  "data-active-capability-version": "1",
};

/** A run that ended by deflecting back to the exact view it would restore. */
const deflection = () =>
  `<div data-build-restoration="capability" data-build-restoration-behavior="preserve">` +
  `<div ${Object.entries(TASKS)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ")}></div></div>${renderPromptNotice("Already here.", "refusal")}`;

/** Stand `globals` up for the length of `run`, and put back exactly what was there. */
function withGlobals(globals: Record<string, unknown>, run: () => void): void {
  const host = globalThis as Record<string, unknown>;
  const before = Object.keys(globals).map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(host, name, { value, configurable: true, writable: true });
  }
  try {
    run();
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else Reflect.deleteProperty(host, name);
    }
  }
}

/** A desk with nothing running: every traversal is taken as it always was. */
const nothingHeld = { hold: () => false };

/** One logo, as much of one as the rules under test actually touch. */
function logoNode(id: string, label: string) {
  return {
    getAttribute: (name: string) => (name === "data-capability-id" ? id : null),
    querySelector: (selector: string) =>
      selector === ".logo-label" ? { textContent: label } : null,
  };
}

/** A window with one capability's surface standing in it, or holding something else. */
function windowHolding(standing: string | null) {
  return {
    region: {
      querySelector: (selector: string) =>
        selector === `:scope > [${ACTIVE_CAPABILITY_ATTRIBUTE}]` && standing !== null
          ? { getAttribute: () => standing }
          : null,
    },
  };
}

describe("the address names the capability and nothing else", () => {
  test("there are two addresses, and the logo is fetched from the one it pushes", () => {
    expect(DESK_ADDRESS).toBe("/");
    expect(capabilityAddress("notes")).toBe("/capability/notes");
    expect(capabilityAddress("my notes")).toBe("/capability/my%20notes");
    expect(capabilityIdFromAddress(capabilityAddress("my notes"))).toBe("my notes");

    // One spelling. The press pushes what the logo is fetched from, so a reload of what
    // the press wrote asks the server for what the press asked for.
    const logo = renderCapabilityLogo({
      id: "my notes",
      label: "My notes",
      incarnation_id: "inc-1",
      version: 1,
      logo: { status: "absent", attempts: 0 },
      display_label_override: null,
    });
    // The address is the desk's to write. htmx would push on every press, the open
    // logo's included, and snapshot the whole body under the address it left.
    expect(logo).not.toContain('hx-push-url="');
  });

  test("an address naming the capability already open is not another place", () => {
    // The rule behind "focusing the already-open logo adds no duplicate": Back may not
    // walk a run of entries that all name one capability.
    expect(isAnotherPlace("/capability/notes", "/capability/notes")).toBe(false);
    expect(isAnotherPlace("/capability/notes/", "/capability/notes")).toBe(false);
    expect(isAnotherPlace("/capability/my%20notes", "/capability/my notes")).toBe(false);
    expect(isAnotherPlace("/capability/notes", "/capability/recipes")).toBe(true);
    expect(isAnotherPlace("/capability/notes", "/")).toBe(true);
    expect(isAnotherPlace("/", "/capability/notes")).toBe(true);
    expect(isAnotherPlace("/", "/")).toBe(false);
  });

  test("a push moves history once, reports where it left, and refuses to stack", () => {
    const moved = barAt("/capability/notes");
    expect(pushAddress("/capability/recipes", moved)).toBe("/capability/notes");
    expect(moved.wrote).toEqual([
      {
        how: "push",
        state: { ...DESK_HISTORY_STATE, index: expect.any(Number) },
        address: "/capability/recipes",
      },
    ]);

    // A press on the logo already open, however the bar happens to spell it.
    for (const spelling of ["/capability/notes", "/capability/notes/"]) {
      const standing = barAt(spelling);
      expect(pushAddress("/capability/notes", standing)).toBeNull();
      expect(standing.wrote).toEqual([]);
    }

    // Putting the window away comes back to the bare desk; the lamp on a desk that is
    // already bare — a build opened the window from `/` — writes nothing.
    const away = barAt("/capability/notes");
    expect(pushAddress(DESK_ADDRESS, away)).toBe("/capability/notes");
    expect(away.wrote.at(-1)?.address).toBe("/");
    expect(pushAddress(DESK_ADDRESS, barAt("/"))).toBeNull();

    // No browser, no history. The verb answers rather than throwing.
    expect(pushAddress("/capability/notes", null)).toBeNull();
  });

  test("a replace corrects the address in place, adding no entry", () => {
    const bar = barAt("/capability/recipes");
    replaceAddress("/capability/notes", bar);
    expect(bar.wrote).toEqual([
      {
        how: "replace",
        state: { ...DESK_HISTORY_STATE, index: expect.any(Number) },
        address: "/capability/notes",
      },
    ]);
    expect(() => replaceAddress("/", null)).not.toThrow();
  });

  test("the desk marks its own entries, and never htmx's", () => {
    // htmx claims the entries stamped `{ htmx: true }` and answers a Back onto one by
    // restoring a snapshot of the whole body — search term and open record included.
    expect(DESK_HISTORY_STATE).toEqual({ aluna: "desk" });
    expect(DESK_HISTORY_STATE).not.toHaveProperty("htmx");
  });

  test("what the window holds is read off the surface, and only the one standing there", async () => {
    // A build narrates beside what it displaced, so the displaced surface is still the window's.
    // The copy the run carries to put back is nested in its own subscriber and stands nowhere.
    expect(capabilityInWindow(windowHolding("notes"))).toBe("notes");
    expect(capabilityInWindow(windowHolding(null))).toBeNull();
    expect(capabilityInWindow(null)).toBeNull();

    // The fact that makes the direct-child rule true: the run's subscriber is appended to the
    // region rather than swapped over it.
    const bar = byId(await elementsOf(read("public/index.html")), PROMPT_FORM_ID);
    expect(bar.attributes.get("hx-target")).toBe(`#${WINDOW_CONTENT_ID}`);
    expect(bar.attributes.get("hx-swap")).toBe("beforeend");
  });

  test("the glue reads the surface standing in the window, never the copy a run nests", () => {
    // The restoration descriptor names what a build displaces, so it may not find that copy.
    const untouched = () => {
      const surface = new ShellEl("div", TASKS);
      surface.append(new ShellEl("div", { "data-search-state": "idle" }));
      surface.append(new ShellEl("input", { "data-capability-search-input": "" }));
      return surface;
    };
    const standing = shellDesk();
    standing.displaced.remove();
    standing.region.append(untouched());
    expect(streamRestoration(standing, deflection())).toBe(true);

    const nested = shellDesk();
    nested.displaced.remove();
    nested.subscriber.append(untouched());
    expect(streamRestoration(nested, deflection())).toBe(false);
  });

  test("an address asks for one of three things, and never for a push", () => {
    const logos = [logoNode("notes", "Notes")];
    const root = { querySelectorAll: () => logos };
    const notes = logos[0] as (typeof logos)[number];

    // A capability standing on the desk and not in the window: open it, and say which. The fetch
    // uses the capability's own address, since the bar's may carry a trailing slash.
    const open = { ask: "open" as const, logo: notes, id: "notes" };
    expect(addressAsks(root, "/capability/notes", null)).toEqual(open);
    expect(addressAsks(root, "/capability/notes/", null)).toEqual(open);
    expect(addressAsks(root, "/capability/notes", "recipes")).toEqual(open);
    // The one already in the window: nothing at all, so Back onto the address a window is
    // already at re-fetches nothing and re-titles nothing.
    expect(addressAsks(root, "/capability/notes", "notes")).toEqual({ ask: "nothing" });
    // The bare desk, and an address naming something the desk is not standing — a link to
    // a deleted capability among them (5.9/03 makes the server say so).
    expect(addressAsks(root, "/", null)).toEqual({ ask: "bare desk" });
    expect(addressAsks(root, "/capability/recipes", "notes")).toEqual({ ask: "bare desk" });
    // The cold load of that link, which is the case 5.9/03 exists for: nothing is in the
    // window yet, so the answer may not depend on something already being there.
    expect(addressAsks(root, "/capability/recipes", null)).toEqual({ ask: "bare desk" });
    expect(addressAsks(root, "/capability/recipes/", null)).toEqual({ ask: "bare desk" });
    // Nothing below identity is an address at all, so nothing below it can be asked for.
    expect(addressAsks(root, "/capability/notes/read", "notes")).toEqual({ ask: "bare desk" });
    expect(addressAsks(root, "/capability/notes/record/7", "notes")).toEqual({ ask: "bare desk" });
  });
});

// Back and Forward, and what they cost when a run is standing in the window (PLAN decision 17).
// The traversal is answered in `desk-address.js`, handed the desk's own answers.
describe("Back and Forward are the desk's to answer", () => {
  test("Back and Forward are the desk's to answer, before htmx has loaded and after", () => {
    // htmx installs its own `window.onpopstate` on `DOMContentLoaded` and chains what it finds,
    // so the property is taken on both sides of that moment, whichever script ran first. A
    // module script runs at "interactive", after parsing and before that event, so both count.
    for (const readyState of ["loading", "interactive"]) {
      const loaded: (() => void)[] = [];
      const rendered: string[] = [];
      const browser = {
        ...barAt("/capability/notes"),
        onpopstate: null as ((event: unknown) => void) | null,
      };
      const page = {
        readyState,
        body: { addEventListener: () => {} },
        addEventListener: (type: string, run: () => void) => {
          if (type === "DOMContentLoaded") loaded.push(run);
        },
      };
      withGlobals({ window: browser, document: page }, () => {
        startDeskHistory({ render: (at) => rendered.push(at), ...nothingHeld });
        browser.onpopstate = () => rendered.push("htmx answered");
        for (const run of loaded) run();
        browser.onpopstate?.({ state: null });
      });
      expect(rendered, `started while the page was ${readyState}`).toEqual(["/capability/notes"]);
    }
  });

  test("a traversal knows how far it moved, or says it cannot tell", () => {
    // The number is what the two `go` calls are sized from. An entry htmx replaced the state of
    // carries none, and guessing a direction off one would step the person somewhere else.
    expect(travelled({ aluna: "desk", index: 4 }, 6)).toBe(-2);
    expect(travelled({ aluna: "desk", index: 7 }, 6)).toBe(1);
    expect(travelled({ htmx: true }, 6)).toBeNull();
    expect(travelled(null, 6)).toBeNull();
  });

  test("a traversal nothing is holding is rendered, and writes nothing", () => {
    const bar = barAt("/capability/recipes");
    const rendered: string[] = [];
    answerTraversal(back(), { render: (at) => rendered.push(at), ...nothingHeld }, bar);
    expect(rendered).toEqual(["/capability/recipes"]);
    expect(bar.wrote).toEqual([]);
  });

  test("a held traversal is stepped back off, and taken again exactly once on a yes", () => {
    // The question is asked instead of the move, so the move is undone while it stands and taken
    // again on yes: two `go` calls of equal and opposite size leave the stack the same length.
    const bar = barAt("/capability/recipes");
    const rendered: string[] = [];
    const render = (at: string) => rendered.push(at);
    let confirm = () => {};
    const stepped = back();

    answerTraversal(
      stepped.event,
      {
        render,
        hold: (go) => {
          confirm = go;
          return true;
        },
      },
      bar,
    );
    // Nothing rendered — the window still holds the run — and the bar is back where the
    // desk actually is, with no entry written for the asking.
    expect(rendered).toEqual([]);
    expect(bar.wrote).toEqual([{ how: "go", state: 1, address: "" }]);

    // The desk's own step back arrives as a `popstate` of its own. Answering it would
    // render the address the question is still standing over.
    answerTraversal(
      { state: { ...DESK_HISTORY_STATE, index: stepped.here } },
      {
        render,
        ...nothingHeld,
      },
      bar,
    );
    expect(rendered).toEqual([]);

    confirm();
    expect(bar.wrote.at(-1)).toEqual({ how: "go", state: -1, address: "" });
    // Which arrives as an ordinary traversal with nothing left to hold it.
    answerTraversal(stepped.event, { render, ...nothingHeld }, bar);
    expect(rendered).toEqual(["/capability/recipes"]);
    expect(bar.wrote.filter((entry) => entry.how !== "go")).toEqual([]);
  });

  test("a traversal onto an entry the desk did not write is never held", () => {
    // A move onto an unstamped entry is a move out of the desk, so a question there asks about
    // nothing — and it is the one branch with no measured distance to step back.
    const bar = barAt("/somewhere-else");
    const rendered: string[] = [];
    let asked = false;
    answerTraversal(
      { state: { htmx: true } },
      {
        render: (at) => rendered.push(at),
        hold: () => {
          asked = true;
          return true;
        },
      },
      bar,
    );
    expect(asked).toBe(false);
    expect(rendered).toEqual(["/somewhere-else"]);
    expect(bar.wrote).toEqual([]);
  });

  test("the desk's own step back is swallowed once, and only the one it asked for", () => {
    // A bare flag is cleared only by the arrival it waits for, so a `go` the browser declines
    // would eat the next Back. The expectation names the entry, so it is wrong about one at worst.
    const bar = barAt("/capability/recipes");
    const rendered: string[] = [];
    const render = (at: string) => rendered.push(at);
    const stepped = back();
    answerTraversal(stepped.event, { render, hold: () => true }, bar);
    expect(bar.wrote).toEqual([{ how: "go", state: 1, address: "" }]);

    // Something other than the step the desk asked for. It is answered rather than eaten,
    // and the expectation is spent either way.
    answerTraversal(
      { state: { ...DESK_HISTORY_STATE, index: stepped.here - 2 } },
      {
        render,
        ...nothingHeld,
      },
      bar,
    );
    expect(rendered).toEqual(["/capability/recipes"]);
    answerTraversal(
      { state: { ...DESK_HISTORY_STATE, index: stepped.here - 3 } },
      {
        render,
        ...nothingHeld,
      },
      bar,
    );
    expect(rendered).toEqual(["/capability/recipes", "/capability/recipes"]);
  });
});

// Where the two verbs are reached from. One gesture, one entry; everything else corrects
// in place or writes nothing at all (design D14; ARCH §6.1).
describe("who moves the address", () => {
  test("a press on the capability already in the window opens nothing at all", () => {
    // Re-fetching would swap the collection out and straight back in, and the window
    // flickers to arrive exactly where it already was. There is no new address either.
    const notes = logoNode("notes", "Notes");
    expect(pressWouldOpen(notes, "notes")).toBe(false);
    expect(pressWouldOpen(notes, "recipes")).toBe(true);
    expect(pressWouldOpen(notes, null)).toBe(true);
    // A logo the desk cannot name is never the one already open.
    expect(pressWouldOpen(logoNode("", "Blank"), null)).toBe(true);

    // What the press does with that answer is run on a started desk in
    // `desk-window-address.desk.test.ts` ("a press on a logo").
  });

  test("no page of this desk is ever written outside the DOM", async () => {
    // htmx snapshots the whole body into `sessionStorage` before it touches history, which it
    // does on every `HX-Replace-Url`, so the search term and a draft would outlive the tab.
    const [body] = (await elementsOf(read("public/index.html"))).filter((el) => el.tag === "body");
    expect(body?.attributes.get("hx-history")).toBe("false");
  });

  test("an address below capability identity names no capability", () => {
    // What the storage keys and the restoration descriptor may carry is swept in
    // `desk-window-address.policy.ts`; the address itself names nothing below identity.
    expect(capabilityIdFromAddress("/capability/notes/record/7")).toBeNull();
  });

  test("the browser's own bar is what the verbs are handed", () => {
    // `deskHistory` is the seam every test above stands on: the real bar in a browser,
    // and nothing at all outside one.
    const browser = (globalThis as { window?: unknown }).window;
    expect(deskHistory()).toBe(browser === undefined ? null : (browser as never));
  });
});
