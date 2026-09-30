import { describe, expect, test } from "bun:test";

import { WINDOW_CONTENT_ID } from "#shell/desk/window/desk-window.js";
import {
  ruleBody as body,
  codeOf as code,
  readSource as read,
  rules,
} from "../../../safety/source.test-support.ts";

// The window, checked where it is written down. It is created and destroyed by the client, so
// this is a statement about files (PLAN decisions 1 and 2; design D1, D3, D12);
// `desk-window.test.ts` runs the module.

const SHELL = read("public/index.html");
const MODULE = read("public/desk/window/desk-window.js");

describe("the shell ships a window layer and no content area", () => {
  test("the window is not in the page: the client makes it", () => {
    // The window, its title bar, its lamps and its region are all made by the client (run in
    // `desk-window.desk.test.ts`). A shell that carried any of them would be a second
    // implementation to keep in step.
    expect(SHELL).not.toContain("window__bar");
    expect(SHELL).not.toContain("window--desk");
    expect(SHELL).not.toContain(`id="${WINDOW_CONTENT_ID}"`);
    expect(SHELL).not.toContain("data-content-region");
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
  test("the window is never detached with htmx's `remove`", () => {
    // `htmx.remove` is `removeChild` and runs no cleanup, so detaching with it would leave the SSE
    // extension holding an EventSource and fire `htmx:sseClose` from a detached node.
    // The swap it goes through instead is run above ("the teardown releases, then lets htmx…").
    expect(code("public/desk/window/desk-window.js")).not.toMatch(/htmx\(\)\?\.remove/);
  });
});

describe("two lamps, and there is no minimise", () => {
  test("nothing anywhere on the shipped surface offers a minimise", () => {
    // Asked past the comments, which say at length why there is none.
    for (const path of [
      "public/index.html",
      "public/desk/window/desk-window.js",
      "public/app.js",
      "design/scripts/window/window.js",
      "design/styles/components/window.css",
      "design/styles/components/desk.css",
    ]) {
      const source = code(path).replace(/<!--[\s\S]*?-->/g, "");
      expect(source, `${path} offers a minimise`).not.toMatch(/minimi[sz]e/i);
    }
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
    expect(code("public/desk/window/desk-window.js")).toContain(
      'import { AlunaWindow } from "../../../design/scripts/window/window.js"',
    );
    expect(MODULE).not.toContain("createElementNS");
    expect(MODULE).not.toContain("<path");
    expect(MODULE).not.toContain("buildFrame");
  });

  test("the geometry module ships with the page that uses it", () => {
    // The floor it reads is the prompt bar's, and every clamp goes through it.
    const imported =
      /import \{([^}]*)\} from "\.\.\/\.\.\/\.\.\/design\/scripts\/desk\/desk-geometry\.js"/.exec(
        code("public/desk/window/desk-window.js"),
      )?.[1] ?? "";
    for (const helper of ["fillDesk", "fitToDesk", "placeWindow"]) {
      expect(imported.split(",").map((name) => name.trim())).toContain(helper);
    }
    // The clamps reach it through the shared gestures rather than a second copy.
    expect(code("design/scripts/window/window-gestures.js")).toContain(
      'import { clampPosition, clampSize, placeWindow } from "../desk/desk-geometry.js"',
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
    // A collection is a vertical list, so a sideways scrollbar is always a bug, and `auto` makes
    // it routine: a drawn element keeps its old layer width until the redraw lands.
    const region = body(rules("public/css/shell.css"), ".desk-window__region");
    expect(region).toMatch(/overflow-x:\s*hidden/);
    expect(region).not.toMatch(/overflow:\s*auto/);

    // The one thing a clip could otherwise put out of reach.
    expect(region).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test("a pressed or focused record does not grow a sideways scrollbar", () => {
    // `:hover` and `:active` nudge a record 1-2px and `:focus-visible` rings it 5px out. The
    // window body's padding is outside the scroller, so that reach needs a gutter of its own.
    const collection = rules("public/css/collection.css");
    // The press states its distance as a travel token (PLAN decision 44), so the gutter is
    // measured from the token the rule names, and Reduce Motion does not shrink it.
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

    // The gutter is on a child of the scroller rather than the scroller itself: a scroll
    // container's own bottom padding is often left out of the scrollable overflow area.
    const surface = body(rules("public/css/demo.css"), ".capability-surface");
    const gutter = /padding:\s*var\(--(space-\d)\)/.exec(surface)?.[1];
    expect(gutter, "the capability surface has no gutter").toBeDefined();
    const tokens = read("design/styles/tokens.css");
    const rem = Number(new RegExp(`--${gutter}:\\s*([\\d.]+)rem`).exec(tokens)?.[1]);
    expect(rem * 16).toBeGreaterThanOrEqual(reach);
  });

  test("the records region is a second scroller, and it is guttered on all four sides", () => {
    // The records region is a second scroller and needs the same two things: a gutter as wide as
    // a card's reach, and a sideways clip. Without them the last card's line came out half-weight.
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

    // Pulled back out by exactly as much, and on every side, so nothing moves: the cards keep
    // their alignment with the rail above and the list keeps its height.
    expect(region).toMatch(new RegExp(`margin:\\s*calc\\(-1 \\* var\\(--${gutter}\\)\\)`));
    for (const side of ["inline", "block", "top", "bottom", "left", "right"]) {
      expect(region, `a one-sided \`padding-${side}\` leaves an edge to clip against`).not.toMatch(
        new RegExp(`padding-${side}:`),
      );
    }
  });
});

describe("the create form takes the window", () => {
  const fields = rules("public/css/fields.css");

  test("the height chain from the window to the action row is unbroken", () => {
    // Only a definite height can put anything on the window's bottom edge, and a flex item that
    // forgets `min-height: 0` refuses to shrink below its content and pushes the scroll up.
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
    // They diverged while create was a panel above the list and edit filled a modal. Both fill the
    // surface they arrive on now, so the shape is stated once, in one rule, with no exception.
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
});
