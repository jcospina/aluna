import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  clampPosition,
  clampSize,
  fillDesk,
  fitToDesk,
  MIN_SIZE,
  PROMPT_CLEARANCE,
  readBox,
} from "#design/desk-geometry.js";
import { setMaximised } from "#design/window-gestures.js";
import { DEV_STORAGE_KEY } from "#shell/desk-dev-panel.js";
import {
  fitBox,
  forgetOnDismissal,
  forgetPresentation,
  loadPresentation,
  localStore,
  openingGeometry,
  parsePresentation,
  presentationOf,
  savePresentation,
  WINDOW_STORAGE_KEY,
} from "#shell/desk-window.js";

// Where the window sits, how big it is, and what survives a reload (PLAN decisions 5,
// 18, 47, 48; design D9).
//
// The module hands its seams out — the record, the opening sequence, the fit, the form
// — so the questions that matter are *run* rather than grepped for. What is left as a
// statement about a file is only what a file is the right place to state: an ordering
// no return value exposes, and a rule that lives in CSS.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const rules = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");

const MODULE = code("public/desk-window.js");
const STORE = code("public/desk-window-store.js");

type Box = { x: number; y: number; w: number; h: number };
type Stored = Box & { max?: boolean; restore?: Box };

/** The clamps read a `DOMRect`; width and height are all of one they touch. */
const desk = (width: number, height: number) => ({ width, height }) as never;

/** An element, as much of one as the geometry and the form actually touch. */
function fakeEl() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const bound: string[] = [];
  const children: unknown[] = [];
  const props = new Map<string, string>();
  return {
    classes,
    attrs,
    bound,
    children,
    props,
    classList: {
      add: (n: string) => classes.add(n),
      remove: (n: string) => classes.delete(n),
      contains: (n: string) => classes.has(n),
      toggle: (n: string, on: boolean) => (on ? classes.add(n) : classes.delete(n)),
    },
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    getAttribute: (n: string) => attrs.get(n) ?? null,
    toggleAttribute: (n: string, on: boolean) => (on ? attrs.set(n, "") : attrs.delete(n)),
    append: (c: unknown) => children.push(c),
    addEventListener: (t: string) => bound.push(t),
    style: { setProperty: (n: string, v: string) => props.set(n, v) },
    querySelector: () => null,
  };
}

/** A `localStorage` stand-in, and the two ways a real one fails. */
function fakeStore(seed: Record<string, string> = {}) {
  const held = new Map(Object.entries(seed));
  return {
    held,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => {
      held.set(k, v);
    },
    removeItem: (k: string) => {
      held.delete(k);
    },
  };
}

describe("the record: one normal box and a flag", () => {
  test("what is written down while maximised is the box to give back, not the desk", () => {
    // The symptom this exists to kill: a maximised window on a wide screen writing
    // *that* screen's width minus the inset into the record, and stranding itself on a
    // narrower one. Maximised is a state, so the size is never the thing kept.
    const el = fakeEl();
    const box: Stored = { x: 100, y: 60, w: 600, h: 400 };

    setMaximised(el as never, box, true);
    fillDesk(desk(1600, 900), box);
    expect(box.w, "the live box is not the desk").toBe(1600 - 18 * 2);

    expect(presentationOf({ box, maximised: true })).toEqual({
      x: 100,
      y: 60,
      w: 600,
      h: 400,
      max: true,
    });
  });

  test("un-maximised, the record is simply the box the window is standing in", () => {
    const box = { x: 40, y: 12, w: 500, h: 320 };
    expect(presentationOf({ box, maximised: false })).toEqual({ ...box, max: false });
  });

  test("the record's whole shape is four numbers and a flag", () => {
    // Not `entry.box`: that is the desk while the window is maximised, and it carries
    // `restore` — a second geometry record, in the one key that may not hold one.
    expect(
      Object.keys(presentationOf({ box: { x: 1, y: 2, w: 3, h: 4 }, maximised: false })),
    ).toEqual(["x", "y", "w", "h", "max"]);
  });

  test("a stored box larger than the screen is pulled inside rather than reaching past it", () => {
    const narrow = desk(700, 500);
    const box = fitToDesk(narrow, { x: 1400, y: 900, w: 1200, h: 800 });
    expect(box.x + box.w).toBeLessThanOrEqual(700);
    expect(box.y + box.h).toBeLessThanOrEqual(500 - PROMPT_CLEARANCE);
    expect(box.w).toBeGreaterThanOrEqual(MIN_SIZE.w);
    expect(box.h).toBeGreaterThanOrEqual(MIN_SIZE.h);
  });
});

describe("opening a window on what was remembered", () => {
  // `openingGeometry` is the step that turns a parsed record back into a standing
  // window, and its order is the whole of it. Run end to end here, because the failure
  // it prevents is silent: get the order wrong and the desk's own size quietly becomes
  // the remembered box.

  test("a maximised record comes back maximised and still knows what to give back", () => {
    const el = fakeEl();
    const state = openingGeometry(
      el as never,
      { box: { x: 100, y: 60, w: 600, h: 520 }, max: true },
      desk(1600, 900),
      false,
    );

    expect(state.maximised).toBe(true);
    expect(el.classes.has("is-maximised")).toBe(true);
    // Recomputed against the screen it came back on, never replayed from the one it left.
    expect(state.box.w).toBe(1600 - 36);
    expect(el.props.get("--win-w")).toBe(`${1600 - 36}px`);

    // And the round trip is lossless: what goes back to storage is what came out of it.
    expect(presentationOf(state)).toEqual({ x: 100, y: 60, w: 600, h: 520, max: true });
  });

  test("un-maximising after a reload gives back the box, clamped to this screen", () => {
    const el = fakeEl();
    const narrow = desk(800, 600);
    const state = openingGeometry(
      el as never,
      { box: { x: 100, y: 60, w: 600, h: 520 }, max: true },
      narrow,
      false,
    );

    setMaximised(el as never, state.box, false);
    state.maximised = false;
    fitToDesk(narrow, state.box);

    expect(el.classes.has("is-maximised")).toBe(false);
    // The box it kept is given back and *then* clamped: 600 wide still fits inside 800;
    // 520 tall from y=60 reaches past the prompt bar's floor, so the window is pulled
    // *up* to it at the size it had rather than being cut down.
    expect(state.box).toMatchObject({ x: 100, w: 600, h: 520 });
    expect(state.box.y + state.box.h).toBe(600 - PROMPT_CLEARANCE);
  });

  test("an unmaximised record opens on its own box, clamped", () => {
    const el = fakeEl();
    const state = openingGeometry(
      el as never,
      { box: { x: 900, y: 18, w: 794, h: 462 }, max: false },
      desk(1000, 700),
      false,
    );
    expect(state.maximised).toBe(false);
    expect(el.classes.has("is-maximised")).toBe(false);
    expect(state.box.x + state.box.w).toBe(1000);
    expect(state.sized, "a remembered box is a preference on any screen").toBe(true);
  });

  test("nothing remembered opens centred on the desk, above the prompt bar", () => {
    // The room left over is halved and spent evenly — to both sides, and above and
    // below as well. The desk it is centred in is the room a window may stand in: the
    // surface less the strip the prompt bar holds, so an equal gap above and below is
    // an equal gap to the two edges the window actually has.
    const el = fakeEl();
    const state = openingGeometry(el as never, { box: null, max: false }, desk(1280, 720), false);
    expect(state.box.w).toBeGreaterThan(MIN_SIZE.w);
    expect(state.box.y + state.box.h).toBeLessThanOrEqual(720 - PROMPT_CLEARANCE);
    expect(state.box.x, "unequal side gaps").toBe(1280 - state.box.x - state.box.w);
    const floor = 720 - PROMPT_CLEARANCE;
    expect(state.box.y, "unequal gaps above and below").toBe(floor - state.box.y - state.box.h);
    expect(state.sized).toBe(true);
  });

  test("a desk with no room to halve gives the window back the top edge", () => {
    // `fitToDesk` has the last word: below a window's minimum height there is nothing
    // left to halve, and centring may not push the window off the top to pretend there
    // is. The one floor is the desk's, never a second one written here — and this is
    // why there is no inset floor under the halved room. `clampPosition`'s top is 0, so
    // a higher floor of this module's own could only ever disagree with the one that
    // wins; an invariant either way, which is what this pins. The centring above is
    // what a lost `y` would fail.
    const el = fakeEl();
    const state = openingGeometry(el as never, { box: null, max: false }, desk(900, 200), false);
    expect(state.box.h).toBe(MIN_SIZE.h);
    expect(state.box.y).toBe(0);
  });

  test("a desk with no edges yet places nothing, and calls no box its own", () => {
    // A deferred module runs before `@import`ed stylesheets apply, so the layer can
    // measure zero. Fitting to a desk of no size is the smallest box there is, in the
    // corner — and a re-fit can now be followed by a write, so it would be remembered.
    const el = fakeEl();
    const state = openingGeometry(el as never, { box: null, max: false }, desk(0, 0), false);
    expect(el.props.size, "a window was placed on a desk with no edges").toBe(0);
    expect(state.sized, "a box authored against nothing is not a preference").toBe(false);

    // And the observer that reports the desk arriving re-fits it properly.
    expect(fitBox(state, desk(1280, 720), false)).toBe(true);
    expect(state.box.w).toBeGreaterThan(MIN_SIZE.w);
  });

  test("the frame is built only after the element is the size it will be", () => {
    // An ordering no return value exposes: the window's chrome measures the element it
    // is given, so a frame drawn before the box lands is drawn for the wrong window.
    expect(MODULE).toMatch(/openingGeometry\(el, [\s\S]*?new AlunaWindow\(el/);
  });
});

describe("a bad preference cannot stop the desk loading", () => {
  const fresh = { box: null, max: false };

  test("nothing that is not a record is believed, and nothing throws", () => {
    // A presentation preference is the shell's to keep and never the shell's to depend
    // on: whatever comes back, an addressed capability still opens.
    expect(parsePresentation(null)).toEqual(fresh);
    expect(parsePresentation("")).toEqual(fresh);
    expect(parsePresentation("{ not json")).toEqual(fresh);
    expect(parsePresentation("null")).toEqual(fresh);
    expect(parsePresentation("7")).toEqual(fresh);
    expect(parsePresentation('"a string"')).toEqual(fresh);
    expect(parsePresentation(undefined)).toEqual(fresh);
    // An array is `typeof "object"`, so it reaches the box question and fails it there.
    expect(parsePresentation("[1,2,3]")).toEqual(fresh);
    expect(parsePresentation("[]")).toEqual(fresh);
  });

  test("geometry that is not four finite numbers is not geometry", () => {
    // All or nothing: three numbers and a missing fourth is not a box, and filling the
    // gap from the default would place a window somewhere the user never put one.
    for (const raw of [
      '{"x":0,"y":0,"w":400}',
      '{"x":0,"y":0,"w":400,"h":null}',
      '{"x":0,"y":0,"w":400,"h":"300"}',
      '{"x":0,"y":0,"w":400,"h":1e999}',
      '{"x":0,"y":0,"w":400,"h":[300]}',
      "{}",
    ]) {
      expect(parsePresentation(raw).box, `${raw} was read as a box`).toBeNull();
    }
    // `NaN` is not JSON, so it arrives as the token `null` — covered above — but the
    // guard is on the value rather than on the syntax, so a hand-built record fails too.
    expect(parsePresentation(JSON.stringify({ x: 0, y: 0, w: 400, h: Number.NaN })).box).toBeNull();
  });

  test("a flag that is not a boolean is not maximised", () => {
    expect(parsePresentation('{"x":1,"y":2,"w":300,"h":200,"max":"true"}')).toEqual({
      box: { x: 1, y: 2, w: 300, h: 200 },
      max: false,
    });
    expect(parsePresentation('{"x":1,"y":2,"w":300,"h":200,"max":1}').max).toBe(false);
    expect(parsePresentation('{"x":1,"y":2,"w":300,"h":200,"max":true}').max).toBe(true);
    // A record missing the flag entirely is a window that was not maximised.
    expect(parsePresentation('{"x":1,"y":2,"w":300,"h":200}').max).toBe(false);
  });

  test("a good box survives a bad flag, and each half falls back on its own", () => {
    const partial = parsePresentation('{"x":5,"y":5,"w":300,"h":200,"max":{}}');
    expect(partial.box).toEqual({ x: 5, y: 5, w: 300, h: 200 });
    expect(partial.max).toBe(false);
    // And the other way round: a flag with no box leaves the default box standing.
    expect(parsePresentation('{"max":true}')).toEqual({ box: null, max: true });
  });

  test("no record can smuggle a second geometry in beside the first", () => {
    // `restore` is the box a maximised window gives back. It is derived, never stored,
    // and a record that tried to carry one would be the extra geometry the single key
    // exists to forbid.
    const smuggled = parsePresentation(
      '{"x":1,"y":2,"w":300,"h":200,"max":true,"restore":{"x":9,"y":9,"w":9,"h":9}}',
    );
    expect(smuggled.box).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(smuggled.box).not.toHaveProperty("restore");
  });

  test("a record cannot reach through the parse to touch anything else", () => {
    // `JSON.parse` gives `__proto__` as an *own* property rather than a setter, so this
    // cannot pollute — but the record is the one thing on this surface that arrives from
    // outside the program, so the claim is worth holding rather than assuming.
    expect(parsePresentation('{"__proto__":{"polluted":1}}').box).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("storage the browser refuses to open is storage that remembers nothing", () => {
    // Run, not grepped. A browser told to block site data throws on the access itself,
    // and a throw on page load is the one thing a preference may never cause.
    const throws = {
      getItem() {
        throw new Error("The operation is insecure.");
      },
      setItem() {
        throw new Error("The operation is insecure.");
      },
    };
    expect(loadPresentation(throws)).toEqual(fresh);
    expect(loadPresentation(null)).toEqual(fresh);
    expect(() =>
      savePresentation({ box: { x: 1, y: 2, w: 3, h: 4 }, maximised: false }, false, throws),
    ).not.toThrow();
    expect(() =>
      savePresentation({ box: { x: 1, y: 2, w: 3, h: 4 }, maximised: false }, false, null),
    ).not.toThrow();

    // A store that is simply not there — a runtime with no `localStorage` at all.
    expect(localStore()).toBeNull();
  });

  test("a record that survives the parse is the one that comes back", () => {
    const store = fakeStore({ [WINDOW_STORAGE_KEY]: '{"x":11,"y":22,"w":333,"h":244,"max":true}' });
    expect(loadPresentation(store)).toEqual({ box: { x: 11, y: 22, w: 333, h: 244 }, max: true });
  });
});

describe("a dismissed window is forgotten", () => {
  const fresh = { box: null, max: false };

  test("forgetting drops the record, so the next window opens where a first one does", () => {
    const store = fakeStore({ [WINDOW_STORAGE_KEY]: '{"x":11,"y":22,"w":333,"h":244,"max":true}' });
    forgetPresentation(store);
    expect(loadPresentation(store)).toEqual(fresh);
    expect([...store.held.keys()]).toEqual([]);
  });

  test("a window dismissed forgets; a desk that had none to dismiss does not", () => {
    // The whole rule, run rather than read. The second half is what keeps the feature:
    // a cold load at `/` renders the bare desk with nothing mounted, and a record of a
    // window the browser was closed on may not be wiped by arriving at the desk.
    const record = '{"x":11,"y":22,"w":333,"h":244,"max":false}';

    const nothingUp = fakeStore({ [WINDOW_STORAGE_KEY]: record });
    expect(forgetOnDismissal(false, nothingUp)).toBe(false);
    expect(nothingUp.getItem(WINDOW_STORAGE_KEY)).toBe(record);

    const dismissed = fakeStore({ [WINDOW_STORAGE_KEY]: record });
    expect(forgetOnDismissal(true, dismissed)).toBe(true);
    expect(dismissed.getItem(WINDOW_STORAGE_KEY)).toBeNull();
  });

  test("forgetting reaches only this window's key", () => {
    // The developer panel's record (5.6/04) sits in the same store and is its own
    // window's business. Closing a capability window may not close that one.
    const store = fakeStore({
      [WINDOW_STORAGE_KEY]: '{"x":11,"y":22,"w":333,"h":244}',
      [DEV_STORAGE_KEY]: '{"x":9,"y":9,"w":320,"h":600,"open":true}',
    });
    forgetPresentation(store);
    expect([...store.held.keys()]).toEqual([DEV_STORAGE_KEY]);
  });

  test("a phone forgets, even though it never remembers", () => {
    // The asymmetry with `savePresentation` is deliberate. The phone rule stops a
    // screen-sized box being *authored* as a desktop preference; there is no box here
    // to author, only the user's own gesture. A window dismissed on a narrow browser is
    // the same one window ending, so the record ends with it rather than surviving on a
    // technicality and standing the next desktop window in the old place.
    const store = fakeStore({ [WINDOW_STORAGE_KEY]: '{"x":11,"y":22,"w":333,"h":244}' });
    savePresentation({ box: { x: 0, y: 0, w: 390, h: 780 }, maximised: false }, true, store);
    expect(store.getItem(WINDOW_STORAGE_KEY)).toBe('{"x":11,"y":22,"w":333,"h":244}');
    forgetPresentation(store);
    expect(store.getItem(WINDOW_STORAGE_KEY)).toBeNull();
    // The store is the *first* argument, and there is no second one to be told the form
    // in. Restoring a phone parameter would leave it undefined here — falsy, so the
    // assertions above would still pass while every real phone stopped forgetting.
    expect(forgetPresentation.length, "`forgetPresentation` grew a parameter").toBe(1);
  });

  test("a dismissal is the only way a window going away reaches the record", () => {
    // The lamp and a Back onto the bare desk are one gesture wearing two faces — the
    // lamp pushes the very address Back arrives at — so either forgets. Nothing else
    // does. `forgetOnDismissal` is where the rule is decided, and it is run in
    // `desk-window-geometry.test.ts`; here is only the wiring into it.
    expect(MODULE).toMatch(
      /export function dismissWindow\(\) \{\s*return forgetOnDismissal\(putAway\(\), localStore\(\)\);\s*\}/,
    );

    // A bare-desk answer covers two different things, and only one is a dismissal: an
    // address naming a capability that is not on the ground gets the same answer, and
    // that is the address turning out to be wrong rather than the user closing a window.
    const bare = /ask === "bare desk"\) \{([\s\S]*?)\n {4}return;/.exec(MODULE)?.[1] ?? "";
    expect(bare, "no bare-desk branch").not.toBe("");
    expect(bare).toMatch(
      /if \(pathname === DESK_ADDRESS\) \{\s*dismissWindow\(\);\s*return;\s*\}\s*putAway\(\);/,
    );
    // And the wrong address is corrected rather than left standing. Without this the bar
    // goes on naming a capability nobody can open, which is the cost
    // `correctUnfilledAddress` itself calls the worse of the two.
    expect(bare).toContain("correctUnfilledAddress(pathname, DESK_ADDRESS)");

    // The other two ways a window goes away: emptied by a deletion, and opened for a
    // read that never filled it. Neither may erase a box the user authored.
    const unfilled = /function putAwayUnfilledWindow\([\s\S]*?\n\}/.exec(MODULE)?.[0] ?? "";
    expect(unfilled, "no `putAwayUnfilledWindow`").not.toBe("");
    expect(unfilled).not.toContain("dismissWindow");
    expect(MODULE).toMatch(/PUT_WINDOW_AWAY_EVENT, \(\) => \{\s*putAway\(\);/);
    // Two call sites and the declaration itself: a fourth match is a third dismissal.
    expect(MODULE.match(/dismissWindow\(\)/g), "a third dismissal").toHaveLength(3);
  });

  test("storage that cannot be cleared is storage a desk still works without", () => {
    const throws = {
      getItem: () => null,
      setItem() {},
      removeItem() {
        throw new Error("The operation is insecure.");
      },
    };
    expect(() => forgetPresentation(throws)).not.toThrow();
    expect(() => forgetPresentation(null)).not.toThrow();
    // A store old enough, or fake enough, to hold only the two methods the record is
    // otherwise kept with.
    expect(() => forgetPresentation({ getItem: () => null, setItem() {} })).not.toThrow();
  });
});

describe("one record, and no extra key", () => {
  test("a whole session of a window writes one key and no other", () => {
    // The capability window's is one of exactly two presentation records the browser
    // holds; the developer panel's (5.6/04) is the other. A second key from here — a
    // maximised flag filed apart from the box it belongs to — is the drift to prevent.
    const store = fakeStore();
    const state = { box: { x: 40, y: 40, w: 600, h: 400 } as Stored, maximised: false };

    savePresentation(state, false, store);
    setMaximised(fakeEl() as never, state.box, true);
    state.maximised = true;
    fillDesk(desk(1600, 900), state.box);
    savePresentation(state, false, store);

    expect([...store.held.keys()]).toEqual([WINDOW_STORAGE_KEY]);
    expect(WINDOW_STORAGE_KEY).toBe("aluna.desk.window.v1");
    // And the value is the normal box beside the flag — never the desk it is filling.
    expect(JSON.parse(store.held.get(WINDOW_STORAGE_KEY) as string)).toEqual({
      x: 40,
      y: 40,
      w: 600,
      h: 400,
      max: true,
    });
  });

  test("a redundant write is not made, and the store is what decides that", () => {
    // Compared against what storage actually holds rather than a copy kept in this tab:
    // the record is shared with every tab on the origin — and with whatever clears it.
    let writes = 0;
    const held = fakeStore();
    const counting = {
      getItem: held.getItem,
      setItem: (k: string, v: string) => {
        writes += 1;
        held.setItem(k, v);
      },
    };
    const state = { box: { x: 40, y: 40, w: 600, h: 400 }, maximised: false };

    savePresentation(state, false, counting);
    savePresentation(state, false, counting);
    savePresentation(state, false, counting);
    expect(writes, "the same record was written more than once").toBe(1);

    // Cleared from outside — another tab, or a Forget — and the next save writes again
    // rather than trusting a mirror this tab kept.
    held.held.clear();
    savePresentation(state, false, counting);
    expect(writes).toBe(2);
  });

  test("a phone writes nothing at all", () => {
    // Ignored, not overwritten: the desktop box and flag are exactly where they were
    // when the screen widens again.
    const kept = '{"x":240,"y":18,"w":794,"h":462,"max":true}';
    const store = fakeStore({ [WINDOW_STORAGE_KEY]: kept });
    savePresentation({ box: { x: 0, y: 0, w: 390, h: 780 }, maximised: false }, true, store);
    expect(store.held.get(WINDOW_STORAGE_KEY)).toBe(kept);
  });
});

describe("the desk changing size is a thing something reacts to", () => {
  test("the window listener the shipped scripts were missing is there", () => {
    // Three sources, because they no longer move together: the query says which form
    // this is, `resize` is the ordinary case, and the layer is watched because the floor
    // and the minimum are in rem — a reader raising their text size grows both without
    // the viewport moving at all.
    expect(MODULE).toContain("window.matchMedia(PHONE)");
    expect(MODULE).toContain('query.addEventListener("change", onResize)');
    expect(MODULE).toContain('window.addEventListener("resize", onResize)');
    expect(MODULE).toContain("new ResizeObserver(onResize).observe(layer)");
    // Installed before either opener, so the first window mounted knows its form, and
    // installed once however many times the desk is started — the three have no way off.
    expect(MODULE).toMatch(
      /watchViewport\(root, layer\);[\s\S]*?root\.addEventListener\(\s*"click"/,
    );
    expect(MODULE).toMatch(/if \(watching\) return;\s*watching = true;/);
  });

  test("every resize re-reads the floor before it clamps to it", () => {
    // An ordering, so it is read where it is written. The floor is a rem length read
    // back from the stylesheet, not a constant: held from module load, a maximised
    // window would keep the floor it was fitted to and slide under a bar that grew.
    const watch = /const onResize = \(\) => \{([\s\S]*?)\n {2}\};/.exec(MODULE)?.[1] ?? "";
    expect(watch, "no `onResize`").not.toBe("");
    expect(watch).toContain("refreshGeometry()");
    expect(watch.indexOf("refreshGeometry()")).toBeLessThan(watch.indexOf("refit(mounted)"));
    // The form is settled before the window is fitted to it.
    expect(watch.indexOf("syncForm(mounted, phone)")).toBeLessThan(watch.indexOf("refit(mounted)"));
  });

  test("a live resize clamps what is remembered rather than trusting it", () => {
    const state = { box: { x: 900, y: 40, w: 700, h: 500 }, maximised: false, sized: true };
    expect(fitBox(state, desk(1600, 900), false)).toBe(true);
    expect(state.box).toMatchObject({ x: 900, y: 40, w: 700, h: 500 });

    expect(fitBox(state, desk(1000, 600), false)).toBe(true);
    expect(state.box.x + state.box.w).toBeLessThanOrEqual(1000);
    expect(state.box.y + state.box.h).toBeLessThanOrEqual(600 - PROMPT_CLEARANCE);
  });

  test("a clamp is not a preference, so a passing narrow screen does not erase one", () => {
    // `fitToDesk` only ever pulls a box in. Written back on every tick, one transient
    // narrowing — a browser dragged small, a sidebar opened, a tablet turned — would
    // erode the remembered box for good, with no way back to the screen it was authored
    // on. Only a crossing is written, and the phone writes nothing.
    const onResize = /const onResize = \(\) => \{([\s\S]*?)\n {2}\};/.exec(MODULE)?.[1] ?? "";
    expect(onResize).toMatch(/if \(was !== phone\) remember\(mounted\);/);
    expect(onResize.match(/remember\(/g), "the resize path writes unconditionally").toHaveLength(1);

    // The three places a box is authored, and the only three that write.
    //
    // The gesture's is guarded on the window still being the one on the desk. Taking a
    // frame out of the page releases the pointer capture a drag runs on, and the browser
    // answers with a `lostpointercapture` the gesture reads as an ending — so a Back
    // pressed mid-drag reaches `onEnd` after the teardown, and an unguarded write would
    // put the box of a just-dismissed window straight back over the record it dropped.
    expect(MODULE).toMatch(/onEnd: \(\) => \{\s*if \(mounted === entry\) remember\(entry\);\s*\}/);
    expect(MODULE).toMatch(/syncMaximiseLamp\(entry\);\s*remember\(entry\);/);
    expect(MODULE.match(/remember\(/g), "a fourth place writes").toHaveLength(3);
    // And it is the phone guard that every one of them goes through.
    expect(MODULE).toContain("savePresentation(entry, phone, localStore())");
  });

  test("re-fitting cannot feed the observer that triggered it", () => {
    // The box is written as custom properties on a window absolutely positioned inside
    // the layer, so nothing a re-fit does can resize the layer being watched.
    expect(code("design/scripts/desk-geometry.js")).toContain('el.style.setProperty("--win-w"');
    const layer = rules("design/styles/components/desk.css");
    expect(layer).toMatch(/\.desk__windows\s*\{[^}]*position:\s*absolute/);
    expect(layer).toMatch(/\.window--desk\s*\{[^}]*position:\s*absolute/);
  });
});

describe("the desk's edges hold every gesture", () => {
  // The clamps are `desk-geometry.js`'s, and every gesture goes through them. Read in
  // Bun they answer from their own fallbacks, which is the point: these are the
  // numbers a browser that never applied the stylesheet would use, and the rules have
  // to hold on those too.
  const size = { width: 1280, height: 720 };
  const floor = size.height - PROMPT_CLEARANCE;
  const bounds = desk(size.width, size.height);

  test("a drag stops above the prompt bar and inside the other three edges", () => {
    // The tail of a records list is exactly where a user scrolls; under the bar it is
    // neither readable nor clickable.
    const box = clampPosition(bounds, { x: 5000, y: 5000, w: 400, h: 300 });
    expect(box.y + box.h).toBe(floor);
    expect(box.x + box.w).toBe(size.width);

    const back = clampPosition(bounds, { x: -900, y: -900, w: 400, h: 300 });
    expect(back).toMatchObject({ x: 0, y: 0 });
    // A drag moves a window and never resizes one.
    expect(back).toMatchObject({ w: 400, h: 300 });
  });

  test("a resize stops on the same floor, and never below the minimum", () => {
    const grown = clampSize(bounds, { x: 0, y: 0, w: 9000, h: 9000 });
    expect(grown.h).toBe(floor);
    expect(grown.w).toBe(size.width);

    const shrunk = clampSize(bounds, { x: 20, y: 20, w: 1, h: 1 });
    expect(shrunk).toMatchObject({ w: MIN_SIZE.w, h: MIN_SIZE.h });
    // A resize drags the bottom-right corner; the top-left stays where it was.
    expect(shrunk).toMatchObject({ x: 20, y: 20 });
  });

  test("maximise fills the desk down to that same floor", () => {
    const filled = fillDesk(bounds, { x: 300, y: 40, w: 400, h: 300 });
    expect(filled.y + filled.h).toBe(size.height - PROMPT_CLEARANCE - filled.y);
    expect(filled.h).toBe(size.height - filled.y * 2 - PROMPT_CLEARANCE);
    expect(filled.w).toBe(size.width - filled.x * 2);
  });

  test("a window forced to its minimum is pulled up to the floor, not through it", () => {
    // `fitToDesk` clamps position, then size, then position again. The size step is
    // allowed to refuse — it floors at the minimum — so without the second pass those
    // pixels are spent downward, into the one strip no window may enter.
    const short = desk(1280, 270);
    const box = fitToDesk(short, { x: 40, y: 18, w: 600, h: 140 });
    expect(box.h).toBe(MIN_SIZE.h);
    expect(box.y + box.h, "the window overshot the prompt bar's floor").toBe(
      270 - PROMPT_CLEARANCE,
    );
  });

  test("a desk too short to hold a minimum window keeps the window, and says so", () => {
    // The one place the two rules cannot both hold. A window smaller than its minimum
    // is not a window, so the minimum wins and the bar is overlapped rather than the
    // window being crushed. Pinned so the choice is a decision and not a surprise.
    const tiny = desk(1280, 200);
    expect(200 - PROMPT_CLEARANCE).toBeLessThan(MIN_SIZE.h);
    const box = fitToDesk(tiny, { x: 0, y: 0, w: 600, h: 400 });
    expect(box.h).toBe(MIN_SIZE.h);
    expect(box.y).toBe(0);
  });

  test("maximise is floored too, so a short desk cannot compute away the window", () => {
    // The one path that computes a size instead of clamping one. Below the inset plus
    // the strip it produced a height of zero or less, which is not a length —
    // `height: var(--win-h)` falls back to `auto` and the window stops being maximised.
    const filled = fillDesk(desk(200, 100), { x: 0, y: 0, w: 400, h: 300 });
    expect(filled.w).toBe(MIN_SIZE.w);
    expect(filled.h).toBe(MIN_SIZE.h);
    expect(filled.h).toBeGreaterThan(0);
  });
});

describe("what a remembered box is, asked in one place", () => {
  test("`readBox` is all-or-nothing, and both surfaces ask it", () => {
    expect(readBox({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(readBox({ x: 1, y: 2, w: 3 })).toBeNull();
    expect(readBox({ x: 1, y: 2, w: 3, h: "4" })).toBeNull();
    expect(readBox({ x: 1, y: 2, w: 3, h: Number.NaN })).toBeNull();
    expect(readBox(null)).toBeNull();
    expect(readBox("box")).toBeNull();
    expect(readBox([1, 2, 3, 4])).toBeNull();
    // Nothing beyond the four is carried through.
    expect(readBox({ x: 1, y: 2, w: 3, h: 4, restore: { x: 9 } })).not.toHaveProperty("restore");

    // The product and the design page believe the same things, because they ask once.
    expect(STORE).toContain("readBox(stored)");
    expect(code("design/scripts/desk.js")).toContain("readBox(stored.window)");
  });
});

describe("the floor is the token's, not this module's", () => {
  test("the window module states no length and no breakpoint of its own", () => {
    // 5.4/01 put every length in `tokens.css` and `desk-geometry.js` reads them back, so
    // the logo grid and every window stop on the same floor by construction. A number
    // restated here is that floor coming apart — and the breakpoint is the same promise
    // one layer up: the script reads `PHONE` rather than writing 720 down again.
    expect(MODULE).toContain("PROMPT_CLEARANCE");
    expect(MODULE).toContain("PHONE");
    for (const restated of ["78", "4.875", "720", "620"]) {
      expect(MODULE, `\`${restated}\` is restated here`).not.toMatch(
        new RegExp(`(?<![\\d.])${restated.replace(".", "\\.")}(?![\\d.])`),
      );
    }
    // And no width is compared by hand anywhere on the surface; the query answers it.
    expect(MODULE).not.toMatch(/innerWidth|clientWidth/);
  });

  test("no window is placed except through the geometry module", () => {
    // Every `placeWindow` call site is gated on `fitBox` having said the box is ready:
    // the opening, which must place before the frame measures it, and every later
    // re-fit. A third would be a box written to the page without meeting the floor.
    expect(MODULE.match(/placeWindow\(/g)).toHaveLength(2);
    expect(MODULE.match(/if \(fitBox\(/g)).toHaveLength(2);
    expect(MODULE).toContain("if (fitBox(state, bounds, isPhone)) placeWindow(el, box)");
    expect(MODULE).toMatch(
      /if \(fitBox\(entry, entry\.layer\.getBoundingClientRect\(\), phone\)\) \{\s*placeWindow\(entry\.el, entry\.box\);/,
    );
    // And the panel places through the same two, never a copy of them.
    expect(code("public/desk-dev-panel.js")).not.toMatch(/placeWindow\((?![\s\S]{0,40}entry\.box)/);
    expect(code("public/desk-dev-panel.js")).toMatch(
      /if \(fitBox\(entry, entry\.layer\.getBoundingClientRect\(\), phone\)\) \{\s*placeWindow\(entry\.el, entry\.box\);/,
    );
    // The gestures reach the same clamps rather than a second copy of them.
    expect(code("design/scripts/window-gestures.js")).toContain(
      'import { clampPosition, clampSize, placeWindow } from "./desk-geometry.js"',
    );
  });
});
