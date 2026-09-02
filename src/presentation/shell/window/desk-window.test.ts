import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { setMaximised, trackPointer } from "#design/window-gestures.js";
import {
  PUT_WINDOW_AWAY_EVENT,
  startDeskWindow,
  tearDownWindow,
  WINDOW_CONTENT_ID,
  WINDOW_CONTENT_REGION,
  WINDOW_LAYER_SELECTOR,
  windowLayer,
} from "#shell/desk-window.js";
import { code as stripComments } from "../../safety/source.test-support.ts";

// The window, checked where it is written down. It is created and destroyed by the
// client, so most of what has to hold is a statement about a file rather than about a
// served page: the shell ships a layer and a module and no content area of its own, the
// module owns the frame the design draws, and the two lamps are the only life cycle the
// chrome offers (PLAN decisions 1 and 2; design D1, D3, D12).

const ROOT = resolve(import.meta.dir, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A stylesheet with its comments stripped — a rule is what the browser sees. */
const rules = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");

/** Source with comments stripped, for questions about what the code does. */
const code = (path: string) => stripComments(read(path));

/** One rule's body, by exact selector. Flat: nesting is not used in these sheets. */
function body(css: string, selector: string): string {
  const match = new RegExp(
    `(?:^|[},])\\s*${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`,
  ).exec(css);
  expect(match?.[1], `no \`${selector}\` rule`).toBeDefined();
  return match?.[1] as string;
}

const SHELL = read("public/index.html");
const MODULE = read("public/desk-window.js");

describe("the shell ships a window layer and no content area", () => {
  test("the layer is in the page and the window is not", () => {
    expect(SHELL).toContain('<div class="desk__windows"></div>');
    expect(SHELL).toContain('<script type="module" src="/static/desk-window.js"></script>');

    // The window, its title bar, its lamps and its region are all made by the client.
    // A shell that carried any of them would be a second implementation to keep in step.
    expect(SHELL).not.toContain("window__bar");
    expect(SHELL).not.toContain("window--desk");
    expect(SHELL).not.toContain(`id="${WINDOW_CONTENT_ID}"`);
    expect(SHELL).not.toContain("data-content-region");
  });

  test("the module finds the layer by the selector the shell writes", () => {
    expect(WINDOW_LAYER_SELECTOR).toBe(".desk__windows");
    expect(SHELL).toContain('class="desk__windows"');
  });

  test("a missing layer throws rather than opening nothing in silence", () => {
    // The other half of 5.3/02's promise. A desk that cannot mount a window looks
    // exactly like a capability that refused to open, and the two want opposite fixes.
    expect(() => windowLayer({ querySelector: () => null })).toThrow(
      "The desk's window layer is missing.",
    );
    const layer = { name: "the layer" };
    expect(
      windowLayer({
        querySelector: (selector: string) => (selector === WINDOW_LAYER_SELECTOR ? layer : null),
      }),
    ).toBe(layer as never);
  });

  test("the layer is demanded at startup, not at the first press", () => {
    // A shell shipped without one would otherwise render a desk that looks entirely
    // normal and fail on the user's first click — the confusion the throw prevents.
    expect(() =>
      startDeskWindow({ querySelector: () => null, addEventListener: () => {} } as never, "/"),
    ).toThrow("The desk's window layer is missing.");
  });

  test("both openers listen in the capture phase", () => {
    // htmx resolves `hx-target` from a listener on the element itself, which runs
    // after every capture listener on the document. The capture flag is what makes
    // the window — and the region every existing swap addresses — exist first.
    const captured: string[] = [];
    const bubbled: string[] = [];
    startDeskWindow(
      {
        querySelector: () => ({}),
        addEventListener: (type: string, _fn: unknown, capture?: boolean) =>
          (capture === true ? captured : bubbled).push(type),
      } as never,
      "/",
    );
    expect(captured).toEqual(["click", "submit"]);
    expect(bubbled).toContain(PUT_WINDOW_AWAY_EVENT);
  });

  test("the shell's own content area is gone from every surface that styled it", () => {
    for (const path of ["public/index.html", "public/css/shell.css", "public/css/demo.css"]) {
      const source = read(path).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "");
      expect(source, `${path} still carries the retired content area`).not.toMatch(
        /content__active|intro__output|class="intro"/,
      );
    }
    expect(rules("public/css/shell.css")).not.toContain(".content ");
    expect(rules("public/css/shell.css")).not.toContain(".content::after");
  });
});

describe("the window holds the one content region", () => {
  test("the region is created by the client, named, and marked", () => {
    expect(WINDOW_CONTENT_ID).toBe("spec-build-output");
    expect(WINDOW_CONTENT_REGION).toBe("the window's content");
    expect(MODULE).toContain("region.id = WINDOW_CONTENT_ID");
    expect(MODULE).toContain("region.dataset.contentRegion = WINDOW_CONTENT_REGION");
  });

  test("the release event is the region rule's own, imported rather than restated", () => {
    expect(MODULE).toContain('import { RELEASE_REGION_EVENT } from "./region-scope.js"');
  });

  test("the teardown releases, then lets htmx clean up, then detaches", () => {
    // The order is the whole rule. The release is the only moment an htmx request
    // inside the region can still be aborted, and htmx's cleanup only closes a build's
    // EventSource while the node carrying it is still connected — which is why the
    // window is swapped empty rather than removed with `htmx.remove`, which is
    // `removeChild` and runs no cleanup at all.
    const order: string[] = [];
    const opener = { isConnected: true, focus: () => order.push("focus opener") };
    const entry = {
      el: { remove: () => order.push("detach") } as never,
      region: {
        dispatchEvent: (event: CustomEvent) => order.push(`release:${event.type}`),
      } as never,
      win: { destroy: () => order.push("stop observing") } as never,
      openedBy: opener as never,
    };
    tearDownWindow(entry, {
      swap: (target: unknown, content: string, spec: { swapStyle: string }) => {
        order.push(`htmx cleanup:${content === "" ? "emptied" : "?"}:${spec.swapStyle}`);
        expect(target).toBe(entry.el);
      },
    });

    expect(order).toEqual([
      "release:aluna:release-region",
      "htmx cleanup:emptied:innerHTML",
      "stop observing",
      "detach",
      "focus opener",
    ]);
  });

  test("focus goes back to what opened the window, unless it has gone too", () => {
    // A keyboard user who presses the clay lamp would otherwise lose focus to `<body>`
    // and have to tab the whole desk again to reach the logo that brings it back.
    const build = (isConnected: boolean, sink: string[]) => ({
      el: { remove: () => {} } as never,
      region: { dispatchEvent: () => {} } as never,
      win: { destroy: () => {} } as never,
      openedBy: { isConnected, focus: () => sink.push("focused") } as never,
    });
    const kept: string[] = [];
    tearDownWindow(build(true, kept), undefined);
    expect(kept).toEqual(["focused"]);

    // A logo removed by the very deletion that emptied the window is not somewhere to
    // throw focus at.
    const gone: string[] = [];
    tearDownWindow(build(false, gone), undefined);
    expect(gone).toEqual([]);
  });

  test("the classic-script glue and the window agree on both strings", () => {
    // `app.js` is a classic script and cannot import a module, so it restates the
    // region's id and the put-away event. Neither may drift from the module that
    // owns them — the same answer `region-scope.js` and `app.js` give for the
    // release event.
    const glue = read("public/app.js");
    expect(glue).toContain(`const WINDOW_REGION_ID = "${WINDOW_CONTENT_ID}";`);
    expect(glue).toContain(`const PUT_WINDOW_AWAY_EVENT = "${PUT_WINDOW_AWAY_EVENT}";`);
    expect(MODULE).toContain("root.addEventListener(PUT_WINDOW_AWAY_EVENT");
  });

  test("a window left holding nothing is put away", () => {
    // A deletion with nothing to restore empties the region: the capability is gone,
    // its logo is gone, and an empty frame still titled with what was deleted is the
    // one thing left saying otherwise.
    const glue = code("public/app.js");
    expect(glue).toContain("function regionHoldsNothing(region)");
    expect(glue).toContain("putAwayEmptyWindow(output)");
    expect(glue).toMatch(/target\.id === WINDOW_REGION_ID/);
  });

  test("the window is never detached with htmx's `remove`", () => {
    // `htmx.remove` is `removeChild` and runs no cleanup at all, so detaching with it
    // would leave the SSE extension holding an open EventSource for a build streaming
    // into a node that is no longer anywhere — and the `htmx:sseClose` that unlocks
    // the prompt bar would be fired from a detached node and never reach the document.
    // The behavioural proof is the teardown test above; this keeps the trap shut.
    expect(code("public/desk-window.js")).not.toMatch(/htmx\(\)\?\.remove/);
    expect(code("public/desk-window.js")).toContain('swapStyle: "innerHTML"');
  });
});

describe("two lamps, and there is no minimise", () => {
  test("the design ships exactly maximise and put away", () => {
    const window = read("design/scripts/window.js");
    const lamps = /const LAMPS = \[([\s\S]*?)\];/.exec(window)?.[1] ?? "";

    expect(lamps).toContain('action: "maximise"');
    expect(lamps).toContain("lamp--leaf");
    expect(lamps).toContain('action: "putaway"');
    expect(lamps).toContain("lamp--clay");
    expect(lamps.match(/action:/g)).toHaveLength(2);
  });

  test("nothing anywhere on the shipped surface offers a minimise", () => {
    // Asked past the comments, which say at length why there is none.
    for (const path of [
      "public/index.html",
      "public/desk-window.js",
      "public/app.js",
      "design/scripts/window.js",
      "design/styles/components/window.css",
      "design/styles/components/desk.css",
    ]) {
      const source = code(path).replace(/<!--[\s\S]*?-->/g, "");
      expect(source, `${path} offers a minimise`).not.toMatch(/minimi[sz]e/i);
    }
  });

  test("the leaf lamp reports whether it is pressed", () => {
    // Maximise is a toggle. Without this the only way to know a window is maximised is
    // to look at it, which is not a way a screen reader has.
    expect(MODULE).toContain('lamp?.setAttribute("aria-pressed"');
  });

  test("the clay lamp dismisses, and a dismissed window is not remembered", () => {
    const source = code("public/desk-window.js");
    expect(source).toMatch(/action === "maximise"\) toggleMaximise\(entry\)/);
    // The lamp still means *put away*, and it is no longer silent when there is a run
    // to lose: it asks first, and does exactly the same thing on a yes (5.8/04).
    expect(source).toMatch(
      /action === "putaway"\) \{\s*const away = \(\) => \{\s*dismissWindow\(\);/,
    );
    expect(source).toContain("if (!askBeforeLeaving(entry.el, away)) away();");
    // The logo stays where it was and the same click brings the window back — centred,
    // the way a first window opens. A dismissed window is over, so the box it stood in
    // is not a preference every window after it inherits. The address moves too, to the
    // bare desk (D14).
    const putAway = /export function putAway\(\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    expect(putAway, "no `putAway`").not.toBe("");
    expect(putAway).not.toContain("savePresentation");
    const tearDown = /export function tearDownWindow\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(tearDown).not.toContain("savePresentation");
  });
});

describe("the frame is drawn, and drawn once", () => {
  test("the window declares no border of its own", () => {
    const css = rules("design/styles/components/window.css");
    expect(body(css, ".window")).toContain("background: transparent");
    expect(body(css, ".window")).not.toContain("border");
    // The two SVG layers the frame is actually drawn on.
    expect(css).toContain(".window__ground");
    expect(css).toContain(".window__ink");
  });

  test("the product borrows the design's window rather than drawing a second one", () => {
    expect(MODULE).toContain('import { AlunaWindow } from "../design/scripts/window.js"');
    expect(MODULE).not.toContain("createElementNS");
    expect(MODULE).not.toContain("<path");
    expect(MODULE).not.toContain("buildFrame");
  });

  test("the geometry module ships with the page that uses it", () => {
    // 5.4/01 left this module written and unwired, for the window to be its first
    // consumer. The floor it reads is the prompt bar's, and every clamp goes through it.
    expect(MODULE).toContain('from "../design/scripts/desk-geometry.js"');
    for (const helper of ["fillDesk", "fitToDesk", "placeWindow", "PROMPT_CLEARANCE"]) {
      expect(MODULE, `the window does not use ${helper}`).toContain(helper);
    }
    // The clamps reach it through the shared gestures rather than a second copy.
    expect(code("design/scripts/window-gestures.js")).toContain(
      'import { clampPosition, clampSize, placeWindow } from "./desk-geometry.js"',
    );
  });
});

describe("the window's content region scrolls, and only when it should", () => {
  test("the region is the scroller and the window is not", () => {
    const region = body(rules("public/css/shell.css"), ".desk-window__region");
    expect(region).toMatch(/overflow-y:\s*auto/);
    expect(region).toMatch(/min-height:\s*0/);
  });

  test("it scrolls down and never sideways", () => {
    // A collection is a vertical list, so a sideways scrollbar on one is always a bug
    // — and it cannot be left to `auto`, because the drawn line makes the bug routine.
    // The ink system sizes each layer in pixels when it draws, so a drawn element that
    // has just been made narrower keeps a layer as wide as it used to be until the
    // redraw lands. Resizing the window by its corner is that, every frame: under
    // `overflow-x: auto` each one flicks a horizontal scrollbar in and out.
    const region = body(rules("public/css/shell.css"), ".desk-window__region");
    expect(region).toMatch(/overflow-x:\s*hidden/);
    expect(region).not.toMatch(/overflow:\s*auto/);

    // The one thing a clip could otherwise put out of reach.
    expect(region).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test("a pressed or focused record does not grow a sideways scrollbar", () => {
    // `:hover` and `:active` nudge a record 1–2px and `:focus-visible` rings it 5px
    // out (3px outline at a 2px offset). The window body's padding is outside the
    // scroller, so without a gutter of its own that nudge lands outside the scroller's
    // box: a list that never wanted horizontal scrolling grows a horizontal scrollbar
    // the moment a card is hovered, and the ring is clipped at both edges.
    const collection = rules("public/css/collection.css");
    // The press states its distance as a travel token rather than a number (PLAN
    // decision 44), so the gutter is measured from the token the rule names — a press
    // that gets deeper still sizes this, and one that is quieted for Reduce Motion does
    // not shrink the gutter, because the scrollbar it prevents is the full-motion case.
    const token = /\.capability-item:active\s*\{[^}]*translate:\s*var\((--travel-[a-z-]+)\)/.exec(
      collection,
    );
    const press = token
      ? new RegExp(`${token[1]}:\\s*calc\\((\\d+)px`).exec(rules("design/styles/tokens.css"))
      : null;
    // The card states no ring of its own — there is one, in the token layer's base
    // stylesheet — so the gutter is sized against that one rather than a copy of it.
    const ring = /:focus-visible\s*\{[^}]*outline:\s*(\d+)px[^}]*outline-offset:\s*(\d+)px/.exec(
      rules("design/styles/base.css"),
    );
    expect(token?.[1], "the press states a raw distance rather than the travel axis").toBeDefined();
    expect(press?.[1], "no `:active` press travel to size the gutter against").toBeDefined();
    expect(ring?.[1], "no focus ring to size the gutter against").toBeDefined();
    const reach = Math.max(
      Number(press?.[1] ?? 0),
      Number(ring?.[1] ?? 0) + Number(ring?.[2] ?? 0),
    );

    // The gutter is on a child of the scroller rather than on the scroller itself: a
    // scroll container's own bottom padding has a long history of being left out of
    // the scrollable overflow area, and where it is, the tail of a list is unreachable.
    const surface = body(rules("public/css/demo.css"), ".capability-surface");
    const gutter = /padding:\s*var\(--(space-\d)\)/.exec(surface)?.[1];
    expect(gutter, "the capability surface has no gutter").toBeDefined();
    const tokens = read("design/styles/tokens.css");
    const rem = Number(new RegExp(`--${gutter}:\\s*([\\d.]+)rem`).exec(tokens)?.[1]);
    expect(rem * 16).toBeGreaterThanOrEqual(reach);
  });

  test("the records region is a second scroller, and it is guttered on all four sides", () => {
    // The window's region is not the only scroller in a collection: the records region
    // scrolls the list under a search rail that stays put, so it needs the same two
    // things the window's does — a gutter wide enough for everything a card reaches past
    // its own box, and, sideways, a clip behind it. Every edge of that scrollport cut
    // through the reach: hovering a card grew a horizontal scrollbar on a vertical list,
    // and at the foot of a long list the last card's bottom line came out half-weight,
    // its outer half clipped away.
    const region = body(rules("public/css/collection.css"), ".capability-records");
    expect(region).toMatch(/overflow-x:\s*hidden/);
    expect(region).not.toMatch(/overflow:\s*auto/);

    const gutter = /padding:\s*var\(--(space-\d)\)/.exec(region)?.[1];
    expect(gutter, "the records region has no gutter").toBeDefined();
    const tokens = read("design/styles/tokens.css");
    const rem = Number(new RegExp(`--${gutter}:\\s*([\\d.]+)rem`).exec(tokens)?.[1]);
    // The furthest a card reaches out of its box: the 3px ring at its 2px offset. The
    // drawn line reaches ~2px and the press 2px, and both are inside that.
    expect(rem * 16).toBeGreaterThanOrEqual(5);

    // Pulled back out by exactly as much, and on every side, so nothing moves: the cards
    // keep their alignment with the rail above and the list keeps its height, and the
    // gutter is spent on the surface's padding rather than on the list's own box.
    expect(region).toMatch(new RegExp(`margin:\\s*calc\\(-1 \\* var\\(--${gutter}\\)\\)`));
    for (const side of ["inline", "block", "top", "bottom", "left", "right"]) {
      expect(region, `a one-sided \`padding-${side}\` leaves an edge to clip against`).not.toMatch(
        new RegExp(`padding-${side}:`),
      );
    }
  });
});

describe("the three gestures", () => {
  test("every way a gesture can end unbinds the move listener", () => {
    // Without `pointercancel` and `lostpointercapture` the move listener stays
    // attached, the window follows a pointer with no button held, and every later
    // gesture stacks another live listener.
    for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
      const bound = new Map<string, () => void>();
      const handle = {
        setPointerCapture: () => {},
        addEventListener: (type: string, fn: () => void) => bound.set(type, fn),
        removeEventListener: (type: string) => bound.delete(type),
      };
      let ended = 0;
      trackPointer(
        handle as never,
        { pointerId: 1 },
        () => {},
        () => (ended += 1),
      );
      expect(bound.has("pointermove"), `no move listener before ${ending}`).toBe(true);

      bound.get(ending)?.();
      expect(bound.size, `${ending} left listeners attached`).toBe(0);
      expect(ended).toBe(1);
    }
  });

  test("maximise keeps the box it takes, and gives exactly that box back", () => {
    // Maximised is a state, never a size: a window that comes back on a different
    // screen fills that screen instead of the one it left.
    const classes = new Set<string>();
    const el = {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
    };
    type Box = { x: number; y: number; w: number; h: number };
    const box: Box & { max?: boolean; restore?: Box } = { x: 300, y: 40, w: 470, h: 330 };

    setMaximised(el as never, box, true);
    expect(box.restore).toEqual({ x: 300, y: 40, w: 470, h: 330 });
    expect(box.max).toBe(true);
    expect(classes.has("is-maximised")).toBe(true);

    Object.assign(box, { x: 18, y: 18, w: 1244, h: 606 });
    setMaximised(el as never, box, false);
    expect(box).toMatchObject({ x: 300, y: 40, w: 470, h: 330, max: false });
    expect(box.restore).toBeUndefined();
    expect(classes.has("is-maximised")).toBe(false);
  });
});

describe("the create form takes the window", () => {
  const fields = rules("public/css/fields.css");

  test("the height chain from the window to the action row is unbroken", () => {
    // Only a definite height can put anything on the window's bottom edge. Every link
    // states both halves — take the space, and be allowed to give it back — because a
    // flex item that forgets `min-height: 0` refuses to shrink below its content and
    // pushes the scroll one level up, which is where a sticky row starts drifting.
    const links: [string, string][] = [
      ["public/css/shell.css", ".desk-window__region"],
      ["public/css/demo.css", ".capability-surface"],
      ["public/css/collection.css", ".capability-collection"],
      [
        "public/css/collection.css",
        ".capability-collection__list,\n.capability-collection__create",
      ],
      // The record view is the third thing the window can hold, and it is a link in the
      // same chain: the collection's place, taken by a column that ends on the same edge.
      ["public/css/record-view.css", ".capability-record-view"],
      ["public/css/fields.css", ".capability-create-form,\n.capability-edit-form"],
      ["public/css/fields.css", ".capability-create-form__fields,\n.capability-edit-form__fields"],
    ];
    for (const [sheet, selector] of links) {
      const rule = body(rules(sheet), selector);
      expect(rule, `${selector} does not claim the height`).toMatch(/flex:\s*1 1 auto/);
      expect(rule, `${selector} cannot give the height back`).toMatch(/min-height:\s*0/);
    }
    // The two views are shown by the same flag, so they are the same link twice.
    expect(rules("public/css/collection.css")).toContain(".capability-collection__list,");
  });

  test("the fields scroll and the action row is stuck to the bottom", () => {
    // Stated as `sticky` rather than left to flex order: a row that merely came last
    // scrolls away with the last field on a form longer than the window.
    const actions = body(
      fields,
      ".capability-create-form__actions,\n.capability-edit-form__actions",
    );
    expect(actions).toMatch(/position:\s*sticky/);
    expect(actions).toMatch(/bottom:\s*0/);
    expect(actions).toMatch(/background:\s*var\(--surface\)/);

    const scroller = body(
      fields,
      ".capability-create-form__fields,\n.capability-edit-form__fields",
    );
    expect(scroller).toMatch(/overflow-y:\s*auto/);
    expect(scroller).toMatch(/min-height:\s*0/);
  });

  test("create and edit are one shape, not two", () => {
    // They diverged while create was a panel above the list and edit filled a modal.
    // Both fill the surface they arrive on now, and the modal's height override went
    // with the modal — so the shape is stated once, in one rule, with no exception.
    const form = body(fields, ".capability-create-form,\n.capability-edit-form");
    expect(form).toMatch(/flex:\s*1 1 auto/);
    expect(form).toMatch(/min-height:\s*0/);
    expect(fields).not.toMatch(/height:\s*100%/);
  });
});

describe("the title bar", () => {
  test("a long title truncates rather than growing the bar", () => {
    const title = body(rules("design/styles/components/window.css"), ".window__title");

    // `min-width: 0` is the load-bearing one: without it a flex item refuses to shrink
    // below its content, and the title pushes the lamps off the end of a locked bar.
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/white-space:\s*nowrap/);
  });

  test("the full title stays readable where a truncated one cannot be", () => {
    expect(read("design/scripts/window.js")).toContain("this.titleEl.title = title");
  });

  test("a retitled window retitles its lamps", () => {
    // A lamp announcing the capability before last is worse than one announcing
    // nothing, because it is confidently wrong.
    const window = read("design/scripts/window.js");
    expect(window).toContain("#nameLamps()");
    expect(window).toMatch(/setTitle\(title\) \{[\s\S]*?this\.#nameLamps\(\);/);
  });

  test("the window is a named landmark", () => {
    expect(MODULE).toContain('el.setAttribute("aria-labelledby", win.titleEl.id)');
  });
});
