import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { answerTraversal, travelled } from "#shell/desk-address.js";
import {
  ACTIVE_CAPABILITY_ATTRIBUTE,
  addressAsks,
  CAPABILITY_LOGO_SELECTOR,
  capabilityAddress,
  capabilityIdFromAddress,
  capabilityInWindow,
  DESK_ADDRESS,
  DESK_HISTORY_STATE,
  deskHistory,
  isAnotherPlace,
  pressWouldOpen,
  pushAddress,
  replaceAddress,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "#shell/desk-window.js";
import { renderCapabilityLogo } from "../../../server/http/fragments.ts";

// The address, and the whole of what it may say. `/capability/:id` names the capability
// in the window and nothing below it; a search term, an open record and a half-typed edit
// live in the DOM and die with the tab (design D14; PLAN decision 6; ARCH §6.1).
//
// The module hands its history out the way it hands its storage out, so the contract is
// run rather than grepped: a bar double records what was written to it. What is left as a
// statement about a file is only what a file is the right place to state.

const ROOT = resolve(import.meta.dir, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Source with comments stripped, for questions about what the code does. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const SHELL = read("public/index.html");
const MODULE = code("public/desk-window.js");
/** The address and the history it is written into, lifted out of the module above. */
const ADDRESS = code("public/desk-address.js");
const STORE = code("public/desk-window-store.js");
const PANEL = code("public/desk-dev-panel.js");
const GLUE = code("public/app.js");

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
 * Where the desk currently thinks it is, discovered by writing one entry and reading the
 * number back off it. The count is the module's own, so a test that wants to spell a Back
 * has to ask rather than assume.
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
    expect(logo).toContain(`hx-get="${capabilityAddress("my notes")}"`);
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

  test("what the window holds is read off the surface, and only the one standing there", () => {
    // A build narrates beside what it displaced, so the displaced surface is still the
    // window's — which is the whole of "a build does not change the address". The copy
    // the run carries to put back is nested inside its own subscriber and is standing
    // nowhere yet, so it may never be mistaken for the answer.
    expect(ACTIVE_CAPABILITY_ATTRIBUTE).toBe("data-active-capability-id");
    expect(capabilityInWindow(windowHolding("notes"))).toBe("notes");
    expect(capabilityInWindow(windowHolding(null))).toBeNull();
    expect(capabilityInWindow(null)).toBeNull();

    // The fact that makes the direct-child rule true, pinned where it is written: the
    // run's subscriber is appended to the region rather than swapped over it.
    expect(SHELL).toMatch(
      /hx-post="\/prompt"[\s\S]{0,300}hx-target="#spec-build-output"[\s\S]{0,120}hx-swap="beforeend"/,
    );
    expect(read("src/server/http/fragments.ts")).toContain(`${ACTIVE_CAPABILITY_ATTRIBUTE}="`);
    // The glue reads it back the same way everywhere it reads it — the restoration
    // descriptor names what a build displaces, so it may not find the nested copy either.
    expect(GLUE).not.toContain('document.querySelector("[data-active-capability-id]")');
    expect(GLUE).toContain(":scope > [data-active-capability-id]");
  });

  test("an address asks for one of three things, and never for a push", () => {
    const logos = [logoNode("notes", "Notes")];
    const root = { querySelectorAll: () => logos };
    const notes = logos[0] as (typeof logos)[number];

    // A capability standing on the desk and not in the window: open it, and say which it
    // is — the fetch uses the capability's own address rather than the one in the bar,
    // which may carry a trailing slash the route does not answer to.
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

// Back and Forward, and what they cost when a run is standing in the window
// (PLAN decision 17). The traversal is answered in `desk-address.js`, handed the desk's
// own answers rather than reaching into the window for them.
describe("Back and Forward are the desk's to answer", () => {
  test("Back and Forward are the desk's to answer, and answering pushes nothing", () => {
    // htmx installs its own `window.onpopstate` on `DOMContentLoaded` and chains whatever
    // it finds, so taking the property only before that moment would leave htmx wrapping
    // this one and still restoring a body snapshot for its own entries. Taken on both
    // sides of that moment, this is independent of which script ran first.
    expect(ADDRESS).toContain("window.onpopstate = (event) =>");
    expect(ADDRESS).toContain(
      'document.addEventListener("DOMContentLoaded", take, { once: true })',
    );
    expect(ADDRESS).toMatch(/take\(\);\s*if \(typeof document !== "undefined"/);

    // The load-time opener and the answer to Back are one function, so the frame and the
    // address cannot drift, and neither writes history. The history module is handed that
    // one function rather than reaching for it, so there is still only one of it.
    expect(MODULE).toMatch(/render: \(landed\) => renderAddress\(root, landed\),/);
    expect(MODULE).toMatch(/\}\);\s*renderAddress\(root, pathname\);/);
    const answer = /function renderAddress\(root, pathname\) \{[\s\S]*?\n\}/.exec(MODULE)?.[0];
    expect(answer, "no `renderAddress`").toBeDefined();
    expect(answer).not.toContain("pushAddress");
    expect(answer).not.toContain("replaceAddress");
  });

  test("a traversal knows how far it moved, or says it cannot tell", () => {
    // The number is what the two `go` calls are sized from. An entry htmx replaced the
    // state of on its way past carries none, and guessing a direction off one would step
    // the person somewhere they never asked to be.
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
    // The question is asked *instead of* the move, so the move is undone while it stands
    // and taken again if the person says yes — two `go` calls of equal and opposite size,
    // which is what leaves the stack neither an entry wider nor an entry shorter
    // (PLAN decision 17).
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
    // A move onto an unstamped entry is a move *out* of the desk — the page unloads and
    // takes the run with it whatever anyone answers, so a question there would be a
    // question about nothing. It is also the one branch that could not be undone: there is
    // no measured distance to step back, so holding it would mean rewriting an entry the
    // desk does not own, and a back-out would leave that entry clobbered.
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
    // A bare flag is cleared only by the arrival it waits for, so a `go` the browser
    // silently declines — a delta past the end of the session's history — would leave it
    // set and eat the next Back the person actually pressed. The expectation names the
    // entry instead, so it is wrong about one traversal at worst.
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

    // htmx resolves a press into a request from a listener on the logo itself, after
    // every capture listener and without consulting `defaultPrevented`. Cancelling
    // `htmx:beforeRequest` is the only thing that stops the fetch.
    expect(MODULE).toContain('root.addEventListener("htmx:beforeRequest"');
    expect(MODULE).toContain(
      "if (!pressWouldOpen(elt, settledCapabilityInWindow(mounted)) || leavingIsBeingAsked()) {",
    );
    // Matched, never `closest`: a faceless tile's one-attempt POST fires from a span
    // inside the logo and must not be cancelled with it.
    expect(MODULE).toContain("elt.matches(CAPABILITY_LOGO_SELECTOR)");
    expect(MODULE).not.toContain("elt.closest(CAPABILITY_LOGO_SELECTOR)");
    expect(CAPABILITY_LOGO_SELECTOR).toBe("[data-capability-logo]");

    // A run in the window is not a capability standing in it: the press is entitled to
    // take the window back off the build it displaced — and off an ending it is holding,
    // which is still covering that capability's collection.
    expect(MODULE).toMatch(
      /function settledCapabilityInWindow\(entry\) \{[\s\S]{0,160}buildRunIn\(entry\.el\) !== null\) return null;/,
    );
  });

  test("the press and the clay lamp are the two gestures that push", () => {
    expect(MODULE).toContain(
      'const attempted = id !== null && id !== "" ? capabilityAddress(id) : null;',
    );
    expect(MODULE).toContain("pushAddress(attempted, deskHistory())");
    expect(MODULE).toMatch(
      /action === "putaway"[\s\S]{0,80}pushAddress\(DESK_ADDRESS, deskHistory\(\)\)/,
    );
    // A press that answered unsuccessfully never took the window, so the entry it made is
    // written back over rather than stepped off.
    // A press that answered unsuccessfully never took the window: the entry it made is
    // written back over, and only while the bar is still carrying it.
    expect(MODULE).toContain("standDownUnsuccessfulPress(root, logo, region, attempted, cameFrom)");
    expect(MODULE).toMatch(
      /putAwayUnfilledWindow\(region\) && attempted !== null\)[\s\S]{0,60}correctUnfilledAddress\(attempted, cameFrom \?\? DESK_ADDRESS\)/,
    );
    // An addressed open that never fills leaves the bare desk rather than a live address
    // naming a capability nobody is looking at.
    expect(MODULE).toMatch(
      /putAwayUnfilledWindow\(region\)\) correctUnfilledAddress\(pathname, DESK_ADDRESS\)/,
    );
    // The correction stands down where the user has moved on since. It lives with the
    // other verbs that move the bar — it reaches for nothing else — and `desk-window.js`
    // re-exports it, so the desk's rules are still reached through the one face they have.
    expect(ADDRESS).toMatch(
      /export function correctUnfilledAddress\(attempted, back\) \{[\s\S]{0,200}isAnotherPlace\(bar\.location\.pathname, attempted\)\) return;/,
    );
  });

  test("a Back onto the bare desk cancels an open still waiting for a desk to measure", () => {
    // A press and a submit cancel a waiting open by mounting a window, which the
    // observer asks about before opening anything. A Back takes a window *down*, so it
    // cannot say it that way — without this, a Back during a cold load is answered by
    // the window opening anyway, at the address just left, in the box just dismissed.
    const source = code("public/desk-window.js");
    const bare = /ask === "bare desk"\) \{([\s\S]*?)\n {4}return;/.exec(source)?.[1] ?? "";
    expect(bare).toContain("stopWaitingForDesk();");
    const waiting = /function whenDeskIsLaidOut\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(waiting, "no `whenDeskIsLaidOut`").not.toBe("");
    // Overtaken as well as ended: a second addressed open may not leave the first
    // observer watching the layer for the life of the page.
    expect(waiting).toMatch(
      /function whenDeskIsLaidOut\(root, open\) \{\s*stopWaitingForDesk\(\);/,
    );
    expect(waiting).toContain("waitingForDesk = observer;");
  });

  test("the answer to a swap corrects the spelling, and only a real activation pushes", () => {
    // A correction asks whether the bar is exactly right where a push asks only whether it
    // is somewhere else — which is what strips a query string and a trailing slash, both
    // below capability identity and neither ever written here.
    expect(MODULE).toContain(
      'if (bar.location.pathname !== next || bar.location.search !== "") replaceAddress(next, bar);',
    );
    // A `commit` is a real pointer activation; every restoration puts back what the build
    // displaced and navigated nowhere, even when it lands after the address has moved on.
    expect(GLUE).toContain("restorationKind: undefined, activated: true");
    expect(GLUE).toContain(
      "tellDeskTheWindowTookCapability(finishTerminalPresentation(event.target))",
    );
    // One ending navigates, and it is the commit. Counted rather than merely present:
    // a second `activated: true` anywhere in the glue is a second thing claiming to have
    // taken the window, and the address would be pushed for something that put back what
    // a build displaced.
    expect(GLUE.match(/activated: true/g)?.length).toBe(1);
  });

  test("history is written in one place, and only ever with an address", () => {
    // Two verbs, one call each, in the module that owns the address. Nothing else in the
    // window's life cycle reaches history, so nothing below capability identity has
    // anywhere in this module to be written down. (`app.js` still applies the two
    // `HX-Replace-Url` corrections the server dictates; both write an address and neither
    // pushes — the assertions in the glue test below are what pin that.)
    expect(ADDRESS.match(/history\.pushState/g)).toHaveLength(1);
    expect(ADDRESS.match(/history\.replaceState/g)).toHaveLength(1);
    expect(MODULE).not.toContain("history.pushState");
    expect(MODULE).not.toContain("history.replaceState");
    expect(MODULE).not.toContain("window.history");
    expect(ADDRESS).not.toContain("window.history");
  });

  test("no page of this desk is ever written outside the DOM", () => {
    // htmx snapshots the whole body into `sessionStorage` before it touches history, and
    // it touches history on every `HX-Replace-Url` a deletion route answers with. The
    // search term, the open record and a half-typed edit would outlive the tab there.
    expect(SHELL).toContain('<body hx-history="false">');
  });

  test("the glue says what happened and the desk decides what the address does", () => {
    // One rule for "already there", in one place. The glue cannot import the module, so it
    // reports what happened rather than keeping a second copy of the rule.
    expect(WINDOW_TOOK_CAPABILITY_EVENT).toBe("aluna:window-took-capability");
    expect(GLUE).toContain(`new CustomEvent("${WINDOW_TOOK_CAPABILITY_EVENT}"`);
    expect(GLUE).not.toContain("history.pushState");
    // A swap corrects; the one terminal that is a navigation pushes. An evolution's commit
    // and every non-activating terminal carry the id the address already names.
    expect(GLUE).toMatch(/htmx:afterSwap[\s\S]{0,300}tellDeskTheWindowTookCapability\(false\)/);
    expect(GLUE).toContain(
      "tellDeskTheWindowTookCapability(finishTerminalPresentation(event.target))",
    );
    expect(MODULE).toMatch(
      /addEventListener\(WINDOW_TOOK_CAPABILITY_EVENT[\s\S]{0,200}addressTheWindow\(/,
    );
  });

  test("nothing below capability identity is written down anywhere", () => {
    // The address, the two storage keys, and the Builder's restoration descriptor are the
    // three places something could survive the tab, and none may carry a search term, an
    // open record or a draft.
    expect(capabilityIdFromAddress("/capability/notes/record/7")).toBeNull();
    expect(STORE).toContain('WINDOW_STORAGE_KEY = "aluna.desk.window.v1"');
    expect(PANEL).toContain('DEV_STORAGE_KEY = "aluna.desk.dev.v1"');

    // Two records, one per allowed window, and no third — the count is the promise
    // (design D9). Read off every key the whole shell names rather than off the two
    // files that are supposed to name them, so a third key added anywhere in `public/`
    // is what fails this rather than a careful reader.
    const shellKeys = new Set(
      readdirSync(join(ROOT, "public"))
        .filter((name) => name.endsWith(".js"))
        .flatMap((name) => [...code(`public/${name}`).matchAll(/"aluna\.desk\.[^"]+"/g)])
        .map((match) => match[0]),
    );
    expect([...shellKeys].sort()).toEqual(['"aluna.desk.dev.v1"', '"aluna.desk.window.v1"']);

    // And no write names a key inline: every one goes through `savePresentation`, which
    // is handed one of the two constants above.
    expect(MODULE + PANEL).not.toMatch(/setItem\(\s*"/);
    const descriptor = read("src/pipeline/jobs/restoration.ts");
    expect(descriptor).toContain("readonly capabilityId: string;");
    expect(descriptor).toContain("readonly incarnationId: string;");
    for (const below of ["search", "record", "draft", "query"]) {
      expect(descriptor).not.toContain(`readonly ${below}`);
    }
  });

  test("the browser's own bar is what the verbs are handed", () => {
    // `deskHistory` is the seam every test above stands on: the real bar in a browser,
    // and nothing at all outside one.
    const browser = (globalThis as { window?: unknown }).window;
    expect(deskHistory()).toBe(browser === undefined ? null : (browser as never));
  });
});
