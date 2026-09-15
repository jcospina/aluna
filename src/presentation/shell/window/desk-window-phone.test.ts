import { describe, expect, test } from "bun:test";

import { PHONE, PROMPT_CLEARANCE } from "#design/desk-geometry.js";
import {
  DESK_GROUND_SELECTOR,
  deskGround,
  fitBox,
  openingGeometry,
  PHONE_CLASS,
  syncForm,
} from "#shell/desk-window.js";
import {
  codeOf as code,
  readSource as read,
  rules,
  under,
} from "../../safety/source.test-support.ts";
import { desk, fakeEl, type Stored } from "./desk-window.test-support.ts";

// Below the breakpoint the window is the screen, and the script is told so (PLAN decisions 47 and
// 48; design D9). What the script does when told, plus the two widths sheets may break on.

const MODULE = code("public/desk-window.js");

/** A window, as much of one as `syncForm` touches — lamp, bar, and the gestures. */
function fakeWindow() {
  const el = fakeEl();
  const lamp = fakeEl();
  const bar = fakeEl();
  el.querySelector = (() => lamp) as never;
  return { entry: { el, win: { bar }, gestures: false }, lamp, bar };
}

/**
 * `addWindowGrip` builds its handle with `document`, which Bun does not have. The property is put
 * back exactly as found, because the shell's classic scripts self-start on a `document` they see.
 */
function withDocument<T>(run: () => T): T {
  const before = Reflect.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: { createElement: () => fakeEl() },
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

describe("below the breakpoint the window is the screen, and the script is told so", () => {
  test("the breakpoint the script reads is the one the stylesheet breaks on", () => {
    expect(PHONE).toBe("(max-width: 720px)");
    expect(rules("design/styles/components/desk.css")).toContain("@media (max-width: 720px)");
  });

  test("the phone class is set on the ground rather than only read", () => {
    expect(PHONE_CLASS).toBe("desk--phone");
    expect(DESK_GROUND_SELECTOR).toBe(".shell");
    expect(read("public/index.html")).toContain('class="shell"');
    expect(MODULE).toContain("ground?.classList.toggle(PHONE_CLASS, phone)");

    // And the ground is found structurally, so a page without one is not a crash.
    const ground = fakeEl();
    expect(deskGround({ querySelector: (s: string) => (s === ".shell" ? ground : null) })).toBe(
      ground as never,
    );
    expect(deskGround({ querySelector: () => null })).toBeNull();
    expect(deskGround({ querySelector: () => ({ notAnElement: true }) })).toBeNull();
    expect(deskGround({} as never)).toBeNull();
  });

  test("the drag and the grip do not bind at all below the breakpoint", () => {
    // Not bound and then stood down: a window that opens on a phone gets no grip
    // element and no drag listener, rather than a grip the stylesheet has to hide.
    const { entry, bar } = fakeWindow();
    withDocument(() => syncForm(entry as never, true));
    expect(entry.gestures).toBe(false);
    expect(entry.el.children, "a grip was built for a phone").toHaveLength(0);
    expect(bar.bound, "a drag was bound on a phone").toHaveLength(0);
  });

  test("crossing up binds them, and crossing back and forth binds them once", () => {
    const { entry, bar } = fakeWindow();
    withDocument(() => {
      syncForm(entry as never, true);
      syncForm(entry as never, false);
      syncForm(entry as never, true);
      syncForm(entry as never, false);
    });
    expect(entry.gestures).toBe(true);
    expect(entry.el.children, "a second grip was built").toHaveLength(1);
    expect(bar.bound, "a second drag was bound").toEqual(["pointerdown"]);
  });

  test("the title bar stops claiming a phone's touches when it stops being draggable", () => {
    // `.window__bar--draggable` carries `touch-action: none`. Left on a phone, the browser hands
    // every touch starting on the title bar to a drag that stands itself down.
    const draggable = /\.window__bar--draggable\s*\{([^}]*)\}/.exec(
      rules("design/styles/components/desk.css"),
    )?.[1];
    expect(draggable, "no `.window__bar--draggable` rule").toBeDefined();
    expect(draggable).toMatch(/touch-action:\s*none/);

    const { entry, bar } = fakeWindow();
    withDocument(() => syncForm(entry as never, false));
    expect(bar.classList.contains("window__bar--draggable")).toBe(true);
    withDocument(() => syncForm(entry as never, true));
    expect(bar.classList.contains("window__bar--draggable")).toBe(false);
  });

  test("no dead maximise lamp on a phone, and it comes back above the breakpoint", () => {
    // The window already is the screen, so the leaf lamp has nothing to toggle, and `hidden`
    // takes it out of the focus order rather than leaving a tab stop whose Enter does nothing.
    const { entry, lamp } = fakeWindow();
    withDocument(() => syncForm(entry as never, true));
    expect(lamp.attrs.has("hidden")).toBe(true);
    withDocument(() => syncForm(entry as never, false));
    expect(lamp.attrs.has("hidden")).toBe(false);

    // `.lamp` declares no `display` of its own, so `[hidden]` is not overridden.
    expect(rules("design/styles/components/window.css")).not.toMatch(/\.lamp\s*\{[^}]*display:/);
    // And the action is shut too, for a `window:lamp` that arrives some other way.
    expect(MODULE).toMatch(/function toggleMaximise\(entry\) \{\s*if \(phone\) return;/);
  });

  test("a maximised window that is already up stands its gestures down when narrowed", () => {
    // The half a listener can do: `addWindowDrag` binds to the bar and offers no way
    // back off it, so a window carried into the phone form answers through the host.
    expect(MODULE).toContain("standDown: () => entry.maximised || phone");
    expect(
      code("design/scripts/window-gestures.js").match(/if \(host\.standDown\?\.\(\)\) return;/g),
    ).toHaveLength(2);
  });

  test("the crossing down leaves the desktop box exactly as it found it", () => {
    const box = { x: 240, y: 18, w: 794, h: 462 };
    const state = { box: { ...box }, maximised: false, sized: true };
    expect(fitBox(state, desk(400, 800), true), "a phone placed the window").toBe(false);
    expect(state.box).toEqual(box);
  });

  test("the crossing up restores and clamps the box the phone was handed", () => {
    // Desk to phone to a narrower desk, in one sequence: the box survives the phone and meets the
    // new desk's edges on the way back, rather than returning to a screen that is gone.
    const state = { box: { x: 900, y: 18, w: 794, h: 462 }, maximised: false, sized: true };
    fitBox(state, desk(1600, 900), false);
    expect(state.box.x).toBe(806);

    fitBox(state, desk(400, 800), true);
    expect(state.box.x, "the phone moved it").toBe(806);

    expect(fitBox(state, desk(1000, 700), false)).toBe(true);
    expect(state.box.x + state.box.w).toBe(1000);
    expect(state.box.y + state.box.h).toBeLessThanOrEqual(700 - PROMPT_CLEARANCE);
  });

  test("a maximised window crosses both ways and comes back maximised", () => {
    const state = {
      box: { x: 100, y: 60, w: 600, h: 400, max: true, restore: { x: 100, y: 60, w: 600, h: 400 } },
      maximised: true,
      sized: true,
    };
    fitBox(state, desk(1600, 900), false);
    fitBox(state, desk(400, 800), true);
    expect(state.box, "the phone recomputed a maximised box").toMatchObject({ w: 1600 - 36 });
    fitBox(state, desk(900, 700), false);
    expect(state.box).toMatchObject({ w: 900 - 36, h: 700 - 36 - PROMPT_CLEARANCE });
    expect(state.box.restore).toEqual({ x: 100, y: 60, w: 600, h: 400 });
  });

  test("a box a phone authored does not become the desktop's on the way back up", () => {
    // A window opened below the breakpoint with nothing remembered was fitted to a screen it
    // filled, so it is no preference: the desk is asked for a first box when there is one.
    const el = fakeEl();
    const state = openingGeometry(el as never, { box: null, max: false }, desk(390, 800), true);
    expect(state.sized, "a phone authored a desktop preference").toBe(false);
    expect(el.props.size, "a phone placed the window").toBe(0);

    expect(fitBox(state, desk(1600, 900), false)).toBe(true);
    expect(state.box.w).toBeGreaterThan(600);
    expect(state.sized, "the desk's box is a preference now").toBe(true);

    // Maximised, the first box is the one to give back — the live box is the desk.
    const max: { box: Stored; maximised: boolean; sized: boolean } = {
      box: { x: 0, y: 18, w: 220, h: 560, max: true },
      maximised: true,
      sized: false,
    };
    fitBox(max, desk(1600, 900), false);
    expect(max.box).toMatchObject({ w: 1600 - 36 });
    expect(max.box.restore?.w, "un-maximising would hand back a phone's box").toBeGreaterThan(600);
  });
});

describe("the focus order advertises nothing it cannot do", () => {
  test("the corner grip is pointer geometry rather than a keyboard control", () => {
    const gestures = code("design/scripts/window-gestures.js");
    expect(gestures).toContain('const grip = document.createElement("div")');
    expect(gestures).toContain('grip.setAttribute("aria-hidden", "true")');
    expect(gestures).not.toContain("tabIndex");
    expect(gestures).not.toContain("tabindex");
    expect(gestures).not.toContain('createElement("button")');
    // And it is not reachable by pointer on a phone either.
    expect(rules("design/styles/components/desk.css")).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.window__grip \{\s*display: none;/,
    );
  });

  test("what is left in the window's focus order is two real buttons", () => {
    // The lamps are the whole of the window's chrome and both are `<button>`. The leaf lamp is the
    // size change a keyboard can make, which lets the grip stay out of the order entirely.
    const windowScript = code("design/scripts/window.js");
    expect(windowScript).toContain('const button = document.createElement("button")');
    expect(windowScript).toContain('button.type = "button"');
    expect(windowScript.match(/{ action: "\w+"/g)).toHaveLength(2);
    expect(code("public/desk-window-frame.js")).toContain('setAttribute("aria-pressed"');
  });

  test("the design page's own desk keeps the same two promises", () => {
    // `design/scripts/desk.js` is the other consumer of the shared gestures (PLAN decision 47).
    // It bound both gestures on a phone and left the maximise lamp in the focus order.
    const deskScript = code("design/scripts/desk.js");
    expect(deskScript).toContain('toggleAttribute("hidden", phone)');
    expect(deskScript).toContain('classList.toggle("window__bar--draggable", !phone)');
    expect(deskScript).toMatch(/if \(phone \|\| entry\.gestures\) return;/);
    expect(deskScript.match(/addWindowGrip\(/g)).toHaveLength(1);
    expect(deskScript.match(/addWindowDrag\(/g)).toHaveLength(1);
  });
});

describe("the desk breaks at 720px and forms at 620px", () => {
  /** Every stylesheet the product's own page loads, read off disk rather than listed. */
  const SHEETS = ["public/app.css", ...under("public/css", "*.css").sort()];

  test("the sweep looks at every sheet the shell imports, not a list that can go stale", () => {
    // A literal list is a sweep that stops sweeping the day someone adds a file.
    const entry = read("public/app.css");
    for (const sheet of SHEETS) {
      if (sheet === "public/app.css") continue;
      expect(entry, `${sheet} is not imported by app.css`).toContain(sheet.replace("public/", ""));
    }
    expect(SHEETS.length).toBeGreaterThan(8);
  });

  test("every media query on the shipped surface is one of those two numbers", () => {
    // The built app's 768 and 480 were derived for the sidebar-and-modal layout being deleted, as
    // was the 639.98 beside them. Two numbers now, both the design's.
    for (const path of SHEETS) {
      for (const [, width] of rules(path).matchAll(
        /@media[^{]*?(?:max|min)-width:\s*([\d.]+)px/g,
      )) {
        expect([path, width]).toEqual([path, expect.stringMatching(/^(720|620)$/)]);
      }
    }
  });

  test("the design's own two are the same two, and its other queries never reach the desk", () => {
    expect(rules("design/styles/components/desk.css")).toContain("@media (max-width: 720px)");
    expect(rules("design/styles/components/form-controls.css")).toContain(
      "@media (max-width: 620px)",
    );

    // `layout.css` and `doc.css` ship with the token layer and carry 900px and 760px, which is
    // the handbook's own document furniture and not a third breakpoint on the desk.
    const shell = read("public/index.html") + read("src/server/http/fragments.ts");
    for (const selector of ["cols", "numbers", "gallery"]) {
      expect(shell, `the shell renders \`.${selector}\``).not.toMatch(
        new RegExp(`class="[^"]*\\b${selector}\\b`),
      );
    }
  });

  test("the surfaces that carried a retired breakpoint now carry a live one", () => {
    // Named individually, because a sweep dropping a rule would satisfy the query test above.
    // Below the breakpoint the window is the screen, so the one behind is taken out of the page.
    expect(rules("design/styles/components/desk.css")).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.window--desk\.is-unfocused \{\s*display: none;/,
    );
    // The modal's own three width rules left with the modal. A record fills the window it opened
    // in, so no shipped sheet sizes a record against the screen.
    for (const path of SHEETS) {
      for (const [query] of rules(path).matchAll(/@media[^{]*\{[^@]*?\}/gs)) {
        expect(query, `${path} sizes the record against the viewport`).not.toContain(
          "capability-record-view",
        );
      }
    }
  });

  test("what is inside the window asks the window, not the screen behind it", () => {
    // The window is resized to any width on a viewport of any width, so a rule inside it that
    // asks the viewport is asking the wrong box: a 276px window on 1920px kept the 1920px layout.
    expect(rules("public/css/shell.css")).toMatch(
      /\.desk-window__region \{[^}]*container: window \/ inline-size/,
    );
    expect(rules("public/css/collection.css")).toMatch(
      /@container window \(max-width: 620px\) \{\s*\.capability-collection__header \{/,
    );
    expect(rules("public/css/deletion.css")).toMatch(
      /@container window \(max-width: 620px\) \{\s*\.capability-deletion \{/,
    );
  });

  test("only what the viewport really decides is left on a viewport query", () => {
    // What is left on a viewport query is genuinely the screen's: the phone form and the
    // panel that floats over the whole page.
    const inWindow = ["capability-collection__header", "capability-deletion"];
    for (const path of SHEETS) {
      for (const [query] of rules(path).matchAll(/@media[^{]*\{[^@]*?\}/gs)) {
        for (const selector of inWindow) {
          expect(query, `${path} still asks the viewport about .${selector}`).not.toContain(
            selector,
          );
        }
      }
    }
  });

  test("the phone still gets the prompt bar's strip reserved under the window's list", () => {
    // Below the breakpoint the stylesheet places the window and the geometry that stops
    // one above the bar is overridden, so the strip is reserved again as content.
    expect(rules("public/css/shell.css")).toMatch(
      /@media \(max-width: 720px\) \{\s*\.desk-window__region::after \{[^}]*height: var\(--prompt-clearance\);/,
    );
  });
});
