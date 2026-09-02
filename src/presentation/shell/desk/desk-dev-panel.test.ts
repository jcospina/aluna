// The developer panel: the one second window, and the last one.
//
// D13 is a single named exception to D1, not the first step towards a window manager.
// What is pinned here is everything that would quietly turn it into one — a third
// window, a z-index that climbs, an address of its own — plus the two halves of "it is
// read-only": the panel carries no controls at all, nothing in it mutates canonical
// state, and the only thing it writes anywhere is the second of exactly two
// presentation records.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EDGE, PROMPT_CLEARANCE } from "#design/desk-geometry.js";
import { DEV_STAGES } from "#design/devpanel.js";
import {
  DEV_SEED_SELECTOR,
  DEV_STORAGE_KEY,
  DEV_TILE_SELECTOR,
  devDefaultBox,
  STAGE_PAYLOAD_EVENT,
  STAGES_CLEARED_EVENT,
  storedOpenFlag,
} from "#shell/desk-dev-panel.js";
import { BACK_Z, FRONT_Z, joinStack, leaveStack, raise, standingCount } from "#shell/desk-stack.js";
import { WINDOW_STORAGE_KEY } from "#shell/desk-window.js";

const ROOT = resolve(import.meta.dir, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const PANEL = code("public/desk-dev-panel.js");
const WINDOW = code("public/desk-window.js");
const WINDOW_STORE = code("public/desk-window-store.js");
const STACK = code("public/desk-stack.js");
const GLUE = code("public/app.js");
const SHELL = read("public/index.html");
const FRAGMENTS = read("src/server/http/fragments.ts");
const DESK_CSS = read("design/styles/components/desk.css");

/** The desk, as the geometry module measures one. */
const desk = (width: number, height: number) =>
  ({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
  }) as unknown as Parameters<typeof devDefaultBox>[0];

/** A window as the stack sees it: something to mark, and a frame to tell. */
function stackMember() {
  const marks = { focused: false, z: "" };
  return {
    marks,
    el: {
      classList: {
        toggle(name: string, on: boolean) {
          if (name === "is-focused") marks.focused = on;
        },
      },
      style: {
        setProperty(_: string, value: string) {
          marks.z = value;
        },
      },
    },
    win: { setFocused: () => {} },
  };
}

describe("it is the second window, and there is no third", () => {
  test("stacking is a pair, not a counter", () => {
    const capability = stackMember();
    const panel = stackMember();

    joinStack(capability);
    expect(capability.marks.focused).toBe(true);
    expect(capability.marks.z).toBe(FRONT_Z);

    // Opening the panel puts it in front — the thing you just asked for is the thing
    // you are looking at — and the capability window steps back one slot. Not down a
    // counter: there are two slots and that is the whole of it.
    joinStack(panel);
    expect(panel.marks.z).toBe(FRONT_Z);
    expect(capability.marks.z).toBe(BACK_Z);
    expect(capability.marks.focused).toBe(false);
    expect(standingCount()).toBe(2);

    raise(capability);
    expect(capability.marks.z).toBe(FRONT_Z);
    expect(panel.marks.z).toBe(BACK_Z);

    // Whatever is left when one goes is the only window, so it is the front one — and
    // on a phone that is the difference between the survivor showing and a blank desk.
    leaveStack(capability);
    expect(panel.marks.z).toBe(FRONT_Z);
    expect(panel.marks.focused).toBe(true);
    leaveStack(panel);
    expect(standingCount()).toBe(0);
  });

  test("a window that is already up still comes forward when it is asked for", () => {
    // The press that opens nothing is still a press on the logo of the thing you want
    // to look at. Without this the capability standing behind the panel had no way
    // back — and below the breakpoint, where only the frontmost window is in the page
    // at all, no way back on screen. Same for a build: it narrates into the window it
    // finds, so that window has to be the one in front.
    expect(WINDOW).toMatch(
      /if \(pressWouldOpen\([\s\S]{0,340}\n\s*if \(mounted\) raise\(mounted\);/,
    );
    expect(WINDOW).toMatch(
      /if \(mounted\) raise\(mounted\);\s*else\s*openWindow\(THINKING_WINDOW_TITLE/,
    );
    // And every opening raises, so a capability swapped into a standing window is
    // never left behind the panel either.
    expect(WINDOW).toMatch(/mounted = windowForOpening\([\s\S]{0,400}raise\(mounted\);/);
  });

  test("the address wins on load; a restored panel stands behind it", () => {
    // Nobody asked for the panel on this visit — a remembered preference did. The URL
    // asked for the capability, so that is what is in front. A lone restored panel is
    // still raised, because a window behind nothing is a blank desk on a phone.
    expect(PANEL).toMatch(/openPanel\(root, root\.querySelector\(DEV_TILE_SELECTOR\), false\)/);
    expect(STACK).toMatch(
      /if \(front \|\| standing\.size === 1\) raise\(member\);\s*else lower\(member\)/,
    );
  });

  test("nothing counts z-indexes up, and no third window is ever built", () => {
    // Two literals and no arithmetic: a stack that could grow is a window manager.
    expect(STACK).not.toMatch(/\+\+|\+= *1|Math\.max/);
    // The panel builds exactly one window and nothing builds another.
    expect(PANEL.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
    expect(WINDOW.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
  });

  test("only the frontmost is exposed on a phone, and neither box is overwritten", () => {
    // The window is the screen below the breakpoint, so the one behind is not behind
    // anything — it is underneath the whole surface, and taken out of the page.
    expect(DESK_CSS).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.window--desk\.is-unfocused \{\s*display: none;/,
    );
    // Presentation only: the desktop *box* is read past, never written over, which is
    // `savePresentation`'s own phone guard rather than a second rule here.
    expect(WINDOW_STORE).toContain("if (isPhone) return;");
    expect(PANEL).toMatch(/savePresentation\(mounted, phone, localStore\(\), DEV_STORAGE_KEY/);
  });
});

describe("the tile is the way in, and it is not a capability", () => {
  test("it never appears in the capability list and is never confused for one", () => {
    expect(DEV_TILE_SELECTOR).toBe("[data-dev-tile]");
    expect(SHELL).toContain("data-dev-tile");
    // The desk's logo handlers key off `data-capability-logo`. The tile carries none of
    // it, which is what stops every one of them from ever treating it as a capability.
    const tile = SHELL.slice(
      SHELL.indexOf("data-dev-tile") - 400,
      SHELL.indexOf("Developer</span>"),
    );
    expect(tile).not.toContain("data-capability-logo");
    expect(tile).not.toContain("data-capability-id");
    // And the server never renders one: the tile is furniture, so nothing about it
    // comes from the registry.
    expect(FRAGMENTS).not.toContain("data-dev-tile");
  });

  test("both surfaces draw the same mark, and it is a drawing rather than type", () => {
    // The handbook builds the tile in script and the shell ships it as static markup,
    // so the mark exists twice and has already been edited by hand more than once.
    // A drifted pair is a developer checking the product against a tile that is not
    // the product's.
    const marks = read("design/scripts/desk-logo.js");
    const paths = [...marks.matchAll(/"(M[\d\s.LH]+)"/g)].map((match) => match[1]);
    expect(paths).toHaveLength(2);
    for (const d of paths) expect(SHELL).toContain(`<path d="${d}" />`);
    const viewBox = /DEV_ICON_VIEWBOX = "([^"]+)"/.exec(marks)?.[1];
    const stroke = /DEV_ICON_STROKE = "([^"]+)"/.exec(marks)?.[1];
    expect(SHELL).toContain(`viewBox="${viewBox}"`);
    expect(SHELL).toContain(`stroke-width="${stroke}"`);

    // A subject's weight, not `--line`. The boundary on this tile is its edge; a
    // hairline on the glass reads as type someone left there rather than a drawing.
    expect(Number(stroke)).toBeGreaterThan(4);
    // And the mark is composed against the glass rather than centred in it: the CSS
    // hands it the whole face and the coordinates do the placing.
    expect(DESK_CSS).toMatch(/\.logo-tile--dev svg \{[^}]*width: 100%;/);
    expect(DESK_CSS).not.toMatch(/\.logo-tile--dev svg \{[^}]*place-self: center;/);
  });

  test("re-pressing the open panel's tile focuses it; only the clay lamp puts it away", () => {
    // A tile that toggled would put away the panel a developer pressed while reading
    // it. Focus is what every desk does, and it is what the capability logo does too.
    expect(PANEL).toMatch(/if \(mounted\) \{\s*raise\(mounted\);\s*return mounted;\s*\}/);
    expect(PANEL).not.toContain("togglePanel");
    expect(PANEL).toMatch(/action === "putaway"\) closePanel\(\)/);
  });
});

describe("read-only means read-only", () => {
  test("nothing in the panel mutates canonical state", () => {
    // The strongest form available: this file has never heard of a record, a schema or
    // a capability's state, so there is no path from it to any of them.
    for (const canonical of ["fetch(", "XMLHttpRequest", "hx-post", "hx-delete", '"POST"']) {
      expect(PANEL, `the panel reaches for \`${canonical}\``).not.toContain(canonical);
    }
    // Whole words, so the panel's own `recordStage` — which files a payload it was
    // handed — is not mistaken for knowing what a capability's record is.
    for (const noun of ["capability", "records", "schema", "registry", "incarnation"]) {
      expect(PANEL, `the panel knows what a \`${noun}\` is`).not.toMatch(
        new RegExp(`\\b${noun}\\b`, "i"),
      );
    }
  });

  test("the panel is never in the address", () => {
    // `/capability/:id` names a capability and nothing else (design D14). The panel is
    // furniture, so it has no address to be in — and unlike the capability window's
    // clay lamp, closing it pushes nothing.
    for (const address of ["pushState", "replaceState", "location", "history"]) {
      expect(PANEL, `the panel writes \`${address}\``).not.toContain(address);
    }
    expect(WINDOW).toContain("pushAddress(DESK_ADDRESS, deskHistory())");
  });

  test("the panel carries no controls, only readouts", () => {
    // Two windows is not a layout worth managing, so there is nothing here to press:
    // the panel is eight readouts and the frame's own two lamps. Anything that turned
    // up in here would be a control hidden behind a developer surface.
    expect(PANEL).not.toContain('createElement("button")');
    expect(PANEL).not.toContain("btn--");
  });

  test("the payloads it shows are a copy of a stream, never a source", () => {
    // Kept whether the panel is open or not, so a developer who starts a build and then
    // reaches for the tile still finds every stage that has already run.
    expect(PANEL).toContain("const stages = new Map();");
    expect(PANEL).toMatch(/stages\.set\(key, payload\);/);
    expect(PANEL).toMatch(/replayStages\(mounted\)/);
  });
});

describe("the second presentation record, and the last", () => {
  test("carries one box, the maximised flag, and whether it was open", () => {
    expect(DEV_STORAGE_KEY).toBe("aluna.desk.dev.v1");
    expect(DEV_STORAGE_KEY).not.toBe(WINDOW_STORAGE_KEY);
    // The extra flag is the one thing only this window has. The box beside it is the
    // *normal* one — `presentationOf` reads `restore ?? box` — so a maximised size is
    // never written here either.
    expect(PANEL).toMatch(
      /savePresentation\(mounted, phone, localStore\(\), DEV_STORAGE_KEY, \{\s*open: true/,
    );
    // And the flag alone is written through its own path, which preserves whatever box
    // is down — including none at all, which is what a panel opened but never moved
    // leaves behind.
    expect(PANEL).toMatch(/box \? \{ \.\.\.box, max: stored\?\.max === true, open \} : \{ open \}/);
  });

  test("a bad record still opens the panel, and a bad flag still opens the desk", () => {
    // A presentation preference is the shell's to keep and never the shell's to depend
    // on. The flag is read on its own so a record whose box is nonsense still says
    // whether the panel was standing.
    const store = (raw: string | null) => ({ getItem: () => raw, setItem: () => {} });
    expect(storedOpenFlag(store("{"))).toBe(false);
    expect(storedOpenFlag(store("null"))).toBe(false);
    expect(storedOpenFlag(store("[]"))).toBe(false);
    expect(storedOpenFlag(store('{"open":"yes"}'))).toBe(false);
    expect(storedOpenFlag(store('{"x":"nope","open":true}'))).toBe(true);
    expect(storedOpenFlag(null)).toBe(false);
    expect(
      storedOpenFlag({
        getItem() {
          throw new Error("site data blocked");
        },
        setItem: () => {},
      }),
    ).toBe(false);
  });

  test("opening the panel authors no box, and putting it away is heard on a phone", () => {
    // Two failures that live in the same place. Writing the full record at mount
    // persisted a box the user never chose — and on a cold load, where the desk still
    // measures zero, persisted `MIN_SIZE` in the corner as the box this panel opens
    // on for good. And routing the flag through `savePresentation` meant its phone
    // guard swallowed it: a panel put away on a phone came back on every phone load
    // with nothing the user could do about it. The flag is written on its own now,
    // the box is left exactly as it was found, and the box itself is only ever
    // written where `fitBox` says there were edges to fit to.
    expect(PANEL).toMatch(/rememberOpen\(true\)/);
    expect(PANEL).toMatch(/rememberOpen\(false\)/);
    expect(PANEL).toMatch(/function remember\(\) \{\s*if \(!mounted\?\.sized\) return;/);
    // `rememberOpen` carries no phone guard, because a flag is not a desktop box.
    const flagWriter = PANEL.slice(
      PANEL.indexOf("function rememberOpen("),
      PANEL.indexOf("function refit("),
    );
    expect(flagWriter).not.toContain("phone");
    expect(flagWriter).toContain("readBox(stored)");
  });

  test("the panel writes its own key and never the capability window's", () => {
    // `syncForm` in `desk-window.js` binds gestures whose finished drag is remembered
    // under the capability window's key. A panel that reused it would quietly write its
    // box into the other window's record and strand both, so it keeps its own.
    expect(PANEL).toContain("export function syncDevForm(");
    expect(PANEL).not.toMatch(/\bsyncForm\(/);
    expect(PANEL).not.toContain("WINDOW_STORAGE_KEY");
  });
});

describe("where the panel opens", () => {
  test("a narrow column at the right edge, above the prompt bar's floor", () => {
    const bounds = desk(1280, 720);
    const box = devDefaultBox(bounds);

    // Against the edge, because the whole point of the exception is that it sits
    // beside what it is reporting on rather than over it.
    expect(box.x + box.w).toBe(bounds.width - EDGE);
    expect(box.y).toBe(EDGE);
    // Narrower than the capability window's 62%, because a payload is read a line at a
    // time and a wide column is worse.
    expect(box.w).toBeLessThan(Math.round(bounds.width * 0.62));
    // And it stops on the same floor the logo grid and the other window stop on.
    expect(box.y + box.h).toBeLessThanOrEqual(bounds.height - PROMPT_CLEARANCE);
  });

  test("a desk too small for the column still gets a clamped box, never a negative one", () => {
    const box = devDefaultBox(desk(320, 240));
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

describe("the seam a classic script reaches the panel across", () => {
  test("both ends agree on the two event names", () => {
    expect(STAGE_PAYLOAD_EVENT).toBe("aluna:stage-payload");
    expect(STAGES_CLEARED_EVENT).toBe("aluna:stages-cleared");
    expect(GLUE).toContain(`STAGE_PAYLOAD_EVENT = "${STAGE_PAYLOAD_EVENT}"`);
    expect(GLUE).toContain(`STAGES_CLEARED_EVENT = "${STAGES_CLEARED_EVENT}"`);
  });

  test("every preview listener names a stage the panel actually builds", () => {
    // The listeners used to name a `<pre>` in the shell. There is no such element now —
    // the panel is a window that may not be standing — so what a listener names has to
    // be one of the eight, or its payload lands nowhere at all.
    const named = [...FRAGMENTS.matchAll(/\["[a-z-]+-preview", "([a-z-]+)"\]/g)].map(
      (match) => match[1] ?? "",
    );
    expect(named.length).toBeGreaterThan(0);
    const keys = new Set(DEV_STAGES.map((stage) => stage.key));
    for (const stage of named) expect(keys.has(stage)).toBe(true);
    expect(FRAGMENTS).not.toContain("data-preview-target");
    // The terminal error files under `commit`, not under the Gate whose verdict
    // already arrived — filing it there overwrote the verdict with the error that
    // followed it, and captioned the Gate block as something it no longer held.
    expect(FRAGMENTS).toContain('["build-error-preview", "commit"]');
  });

  test("only an admitted build empties the panel", () => {
    // The clear used to ride an out-of-band swap inside the subscriber fragment, so
    // it landed only when the server returned one. Moved to the request it would fire
    // on every refusal — a blank prompt, a queued sibling, a 500 — wiping the
    // lifecycle history the page seeded, which nothing restores until a reload.
    expect(GLUE).toMatch(/htmx:afterSwap[\s\S]{0,600}STAGES_CLEARED_EVENT/);
    expect(GLUE).toContain("jobId === clearedForJob");
    expect(GLUE).not.toMatch(/htmx:beforeRequest[\s\S]{0,200}STAGES_CLEARED_EVENT/);
  });

  test("the tile stands last however the logos arrive", () => {
    // Every logo that arrives after first paint is appended to the end of the layer
    // out of band (`hx-swap-oob="beforeend:#capability-logos"`), which left the
    // developer tile stranded mid-grid until the next reload put it back.
    expect(DESK_CSS).toMatch(/\.logo--dev \{\s*order: 1;/);
    expect(FRAGMENTS).toContain('CAPABILITY_LOGO_LAYER_TARGET = "#capability-logos"');
    expect(FRAGMENTS).toMatch(/beforeend:\$\{CAPABILITY_LOGO_LAYER_TARGET\}/);
  });

  test("the one stage the server already knows rides the page", () => {
    // Lifecycle metrics and committed versions are what the platform has already done,
    // not what a stream will say — so they are seeded onto the page and filed when the
    // panel starts, which is what makes the version history survive a refresh.
    expect(DEV_SEED_SELECTOR).toBe("[data-dev-stage-seed]");
    expect(SHELL).toContain('data-dev-stage-seed="metrics"');
    expect(read("src/server/http/cached-view.ts")).toContain('data-dev-stage-seed="metrics"');
    // An empty seed is a resting stage, not an empty payload dressed as one.
    expect(PANEL).toMatch(/if \(stage && payload\) recordStage\(stage, payload\)/);
  });
});
