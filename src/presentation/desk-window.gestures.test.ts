// The other half of `desk-window.test.ts`: the pointer gestures a window answers, who owns
// the way back out of it, and the sentences the architecture and the address keep in step.
// Split out when the one file grew past what a file should hold.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { trackPointer } from "#design/window-gestures.js";
import {
  CAPABILITY_LOGO_SELECTOR,
  capabilityIdFromAddress,
  logoFor,
  logoTitle,
  PROMPT_FORM_ID,
} from "#shell/desk-window.js";
import { code as stripComments } from "./source.test-support.ts";

// The window, checked where it is written down. It is created and destroyed by the
// client, so most of what has to hold is a statement about a file rather than about a
// served page: the shell ships a layer and a module and no content area of its own, the
// module owns the frame the design draws, and the two lamps are the only life cycle the
// chrome offers (PLAN decisions 1 and 2; design D1, D3, D12).

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Source with comments stripped, for questions about what the code does. */
const code = (path: string) => stripComments(read(path));

/** One rule's body, by exact selector. Flat: nesting is not used in these sheets. */

const SHELL = read("public/index.html");

describe("dragging and resizing", () => {
  const gestures = code("design/scripts/window-gestures.js");

  test("the three gestures are written once and used by both desks", () => {
    // The same rule the frame keeps: `window.js` draws every window and no surface
    // gets a simpler one of its own. Two copies of a drag is how the design's grip
    // and the product's came to disagree about being a button.
    for (const consumer of ["public/desk-window.js", "design/scripts/desk.js"]) {
      const source = code(consumer);
      expect(source, `${consumer} does not use the shared gestures`).toMatch(
        /addWindowDrag,\s*addWindowGrip,\s*setMaximised\s*}\s*from\s*"[^"]*window-gestures\.js"/,
      );
      // No second implementation left behind in either caller. (The design's desk
      // keeps a `pointerdown` of its own to bring a window to the front — that is
      // stacking, not a gesture — so the test is what a gesture actually needs.)
      expect(source, `${consumer} still tracks a drag of its own`).not.toContain("pointermove");
      expect(source, `${consumer} still builds a grip of its own`).not.toContain("window__grip");
      expect(source, `${consumer} still lists the gesture endings`).not.toContain("pointercancel");
    }
  });

  test("the window drags by its title bar and by nothing else", () => {
    expect(gestures).toMatch(/export function addWindowDrag\(bar, host\)/);
    expect(gestures).toMatch(/bar\.addEventListener\("pointerdown"/);
    // A press on a lamp is not the start of a drag.
    expect(gestures).toContain('target.closest(".lamp")');
    expect(code("public/desk-window.js")).toContain("addWindowDrag(entry.win.bar, host)");
  });

  test("every way a gesture can end unbinds the move listener", () => {
    // Without `pointercancel` and `lostpointercapture` the move listener stays
    // attached, the window follows a pointer with no button held, and every later drag
    // stacks another live listener. One `trackPointer` for both gestures, so the two
    // cannot come apart.
    expect(gestures).toContain(
      'export const DRAG_ENDINGS = ["pointerup", "pointercancel", "lostpointercapture"]',
    );
    // Bound once and unbound once, in the one place both gestures go through.
    expect(
      gestures.match(/for \(const ending of DRAG_ENDINGS\) handle\.addEventListener/g),
    ).toHaveLength(1);
    expect(
      gestures.match(/for \(const name of DRAG_ENDINGS\) handle\.removeEventListener/g),
    ).toHaveLength(1);
    expect(gestures.match(/trackPointer\(/g)).toHaveLength(3);
  });

  // A device that reports both touch and mouse delivers two `pointerdown`s with different
  // ids, and every listener answered both: two drags over one box, each writing what the
  // other had just written.
  test("one gesture answers one pointer, and nothing a second one sends", () => {
    const bound = new Map<string, (event: unknown) => void>();
    const handle = {
      setPointerCapture: () => {},
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        bound.set(type, listener),
      removeEventListener: (type: string) => bound.delete(type),
    };
    const moved: number[] = [];
    let ended = 0;
    trackPointer(
      handle as never,
      { pointerId: 7 },
      (move) => moved.push(move.clientX),
      () => (ended += 1),
    );

    bound.get("pointermove")?.({ pointerId: 9, clientX: 100 });
    bound.get("pointerup")?.({ pointerId: 9 });
    expect(moved, "a second pointer moved the window").toEqual([]);
    expect(ended, "a second pointer ended the gesture").toBe(0);
    expect(bound.has("pointermove")).toBe(true);

    bound.get("pointermove")?.({ pointerId: 7, clientX: 40 });
    bound.get("pointerup")?.({ pointerId: 7 });
    expect(moved).toEqual([40]);
    expect(ended).toBe(1);
    expect(bound.size).toBe(0);
  });

  // The grip is inside the window, so the press that starts a resize also reaches the
  // window's own raise listener — and stopping it there stopped the raise too, leaving the
  // one window you are actively resizing behind the one you are not.
  test("a press on the grip brings its window forward", () => {
    expect(gestures).toMatch(
      /grip\.addEventListener\("pointerdown",[\s\S]*?event\.stopPropagation\(\);[\s\S]*?host\.onStart\?\.\(\);/,
    );
  });

  test("the corner grip is pointer geometry, not a control that does nothing", () => {
    expect(gestures).toContain('const grip = document.createElement("div")');
    expect(gestures).toContain('grip.setAttribute("aria-hidden", "true")');
    // A `<button>` here would advertise a tab stop whose Enter does nothing; the leaf
    // lamp is the size change a keyboard can make.
    expect(gestures).not.toContain('createElement("button")');
  });

  test("a maximised window is neither dragged nor resized", () => {
    // One question, asked by both gestures through the host the desk hands them.
    expect(gestures.match(/if \(host\.standDown\?\.\(\)\) return;/g)).toHaveLength(2);
    expect(code("public/desk-window.js")).toContain("standDown: () => entry.maximised");
  });
});

describe("who opens the window", () => {
  test("both openers run before htmx resolves the target they create", () => {
    const source = code("public/desk-window.js");
    // Capture phase, on the document: htmx resolves `hx-target` from a listener on the
    // element itself, which runs after every capture listener above it. The `true` is
    // what makes the region exist by the time htmx looks for it.
    expect(source.match(/\n {4}true,\n {2}\);/g)).toHaveLength(2);
    expect(source).toContain(`form.id !== PROMPT_FORM_ID`);
    expect(PROMPT_FORM_ID).toBe("spec-build-form");
    expect(SHELL).toContain(`id="${PROMPT_FORM_ID}"`);
  });

  test("a second capability swaps what is inside the frame rather than adding one", () => {
    // The rule itself is executed against doubles in `capability-swap.test.ts`; this is
    // the wiring — the one opener, going through it.
    const source = code("public/desk-window.js");
    expect(source).toContain(
      "mounted = windowForOpening(mounted, () => mount(root, title), title, openedBy);",
    );
    expect(source).toContain("entry.win.setTitle(title)");
  });
});

describe("the architecture says what the shell is now", () => {
  const architecture = read("docs/architecture.md");

  test("§6.1 draws the boundary in one sentence, with nothing to enumerate", () => {
    // One sentence carries it, so future desk furniture needs no further amendment —
    // and it still stands between the browser and any re-implementation of capability
    // logic (PLAN decision 2).
    expect(architecture).toContain(
      "> The shell may remember how things look to the user. It never decides what is",
    );
    expect(architecture).toContain("> true. Window geometry, maximised state and where the user");
    expect(architecture).toContain("> the server's alone.");
  });

  test("the page is no longer described as one that never changes", () => {
    // Retired because it stopped being true here: the window is created and destroyed.
    expect(architecture).not.toMatch(/never changes after first load/i);
    expect(architecture).not.toMatch(/single static HTML page/i);
    expect(architecture).toContain("The page is not inert after first load");
  });
});

describe("the address names the capability, and the desk says what exists", () => {
  test("an address is a capability or nothing at all", () => {
    expect(capabilityIdFromAddress("/capability/notes")).toBe("notes");
    expect(capabilityIdFromAddress("/capability/notes/")).toBe("notes");
    expect(capabilityIdFromAddress("/capability/my%20notes")).toBe("my notes");
    expect(capabilityIdFromAddress("/")).toBeNull();
    expect(capabilityIdFromAddress("/capability/")).toBeNull();
    // Nothing below the id is an address: a record, a search and a draft die with the
    // tab, so there is never a second segment to parse.
    expect(capabilityIdFromAddress("/capability/notes/read")).toBeNull();
    // A malformed escape names no capability rather than throwing on page load.
    expect(capabilityIdFromAddress("/capability/%E0%A4%A")).toBeNull();
  });

  test("a logo is found by reading ids back, never by a selector built from one", () => {
    // A capability id is a string this module did not author. Reading the attribute
    // back needs no escaping; a selector assembled from one does.
    const logos = [
      logoNode('a"],[data-capability-logo][x="', "Tricky"),
      logoNode("notes", "  Notes  "),
    ];
    const root = { querySelectorAll: () => logos };

    expect(logoFor(root, "notes")).toBe(logos[1] as (typeof logos)[number]);
    expect(logoTitle(logoFor(root, "notes") as (typeof logos)[number])).toBe("Notes");
    expect(logoFor(root, "recipes")).toBeNull();
    expect(logoFor(root, 'a"],[data-capability-logo][x="')).toBe(
      logos[0] as (typeof logos)[number],
    );
  });

  test("the selector the module looks for is the one the server writes", () => {
    expect(CAPABILITY_LOGO_SELECTOR).toBe("[data-capability-logo]");
    expect(read("src/web/fragments.ts")).toContain("data-capability-logo");
  });
});

/** One logo, as much of one as the two rules above actually touch. */
function logoNode(id: string, label: string) {
  return {
    getAttribute: (name: string) => (name === "data-capability-id" ? id : null),
    querySelector: (selector: string) =>
      selector === ".logo-label" ? { textContent: label } : null,
  };
}
