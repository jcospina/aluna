import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { declarations, styleSource } from "../contrast/contrast.js";
import { AUDITED_SHEETS } from "../contrast/contrast-audit.js";
import {
  AXIS_SHEET,
  type Script,
  type Sheet,
  scriptViolations,
  travelViolations,
} from "./travel-axis.js";

/*
 * Reduce Motion quiets travel, not life (PLAN decision 44).
 *
 * The rules themselves are in `travel-axis.ts`, stated over stylesheet text rather than
 * over files, which is what lets this file do two things instead of one: hold the shipped
 * surface to them, and hold *them* to a rule written to get around them. A check that only
 * ever runs over code that passes is a check nobody would notice going blind — and the
 * issue asks precisely that a component added later be quieted without being listed, which
 * is a claim about rules that were never written for it.
 */

const ROOT = resolve(import.meta.dir, "../../..");

/**
 * Every stylesheet the product loads. `AUDITED_SHEETS` is the audited set — kept complete
 * by `contrast-audit.test.ts`, which fails on a sheet that exists and is not in it — plus
 * the two manifests it excludes as import lists. They are excluded there because they
 * declare no colour; a rule written into one would still move.
 */
const MOTION_SHEETS = [...AUDITED_SHEETS, "design/styles/index.css", "public/app.css"];

const surface = (): Sheet[] => MOTION_SHEETS.map((name) => ({ name, css: styleSource(name) }));

/** The scripts the product ships, vendored code aside. */
const shipped = (): Script[] =>
  ["design/scripts/**/*.js", "public/**/*.js"]
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })])
    .filter((path) => !path.includes("vendor"))
    .map((name) => ({ name, source: readFileSync(join(ROOT, name), "utf8") }));

/** The token layer, and one sheet written to try the rules against it. */
const axis = (): Sheet => ({ name: AXIS_SHEET, css: styleSource(AXIS_SHEET) });
const probe = (css: string): string[] => travelViolations([axis(), { name: "probe.css", css }]);

/** What the token layer says, with the media query's own `--travel: 0` set aside. */
const stated = (): Map<string, string> =>
  new Map(
    [
      ...styleSource(AXIS_SHEET)
        .replace(/@media[^{]*prefers-reduced-motion[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/, "")
        .matchAll(/(--(?:travel[\w-]*|dur-travel|dur-fast)):\s*([^;]+);/g),
    ].map(([, name, value]) => [name as string, (value as string).trim()]),
  );

describe("the axis itself", () => {
  test("is a scale of one, and every travelling distance is that scale times a number", () => {
    const tokens = stated();
    expect(tokens.get("--travel"), "the axis is not on at full strength by default").toBe("1");

    // With the setting off, these are the numbers the surface always used: a 1px settle
    // under the pointer, a 2px press into the paper, a 2px lift off the ground, and the
    // one fast duration. The axis rewrote how they are stated, not what they are.
    expect(tokens.get("--travel-nudge")).toBe("calc(1px * var(--travel))");
    expect(tokens.get("--travel-press")).toBe("calc(2px * var(--travel))");
    expect(tokens.get("--travel-lift")).toBe("calc(-2px * var(--travel))");
    expect(tokens.get("--dur-travel")).toBe("calc(var(--dur-fast) * var(--travel))");
    expect(tokens.get("--dur-fast")).toBe("140ms");
  });

  test("replaced the blanket reset rather than moving it", () => {
    // `public/css/a11y.css` held one `*` rule that flattened every animation on the
    // surface, life included. Its other half was a second focus ring; with both gone the
    // sheet held nothing, and a file that wins by loading last is what both decisions
    // removed.
    expect(
      existsSync(join(ROOT, "public/css/a11y.css")),
      "the blanket reduced-motion reset is back",
    ).toBe(false);
  });

  // The exclusion that makes the list a rule rather than an enumeration: a background is
  // a fill, not content, so nothing a reader is following moves when it moves. That is
  // exactly what the working tile's crawl is, and why it stays on for everybody.
  test("a crawling fill is not travel, because nothing a reader follows moves with it", () => {
    expect(
      probe(`
        .p { animation: p-crawl 2s linear infinite; }
        @keyframes p-crawl { to { background-position: 40px 0; } }
      `),
    ).toEqual([]);
  });

  test("leaves the one animation the surface runs today crawling", () => {
    // The tile that says a capability is still being built. It crawls in place, so it
    // crawls for everybody — the reader who asked for less motion included, who is the one
    // most owed the news that something is still on its way.
    const working = declarations("design/styles/components/desk.css", ["animation"]).find(
      ({ selector }) => selector === ".logo-tile--working",
    );
    expect(working?.value, "the working tile stopped saying that something is coming").toContain(
      "tile-working",
    );
  });
});

describe("the shipped surface", () => {
  test("travels only on the axis", () => {
    expect(travelViolations(surface())).toEqual([]);
  });

  test("keeps its scripts off the axis's blind side", () => {
    expect(scriptViolations(shipped())).toEqual([]);
  });

  test("takes a new component in without naming it anywhere", () => {
    // The issue's own demo, run here rather than only by hand: a component nothing has
    // heard of, written with the ordinary primitives, answers to the axis it never names.
    expect(
      probe(`
        .thing { transition: translate var(--dur-travel) var(--ease-rise); }
        .thing:hover { translate: var(--travel-nudge) var(--travel-nudge); }
        .thing:active { translate: var(--travel-press) var(--travel-press); }
        .thing__mark { transition: scale var(--dur-fast) ease; }
        .thing__mark.is-on { scale: 1.2; }
        .thing__spinner { animation: thing-spin var(--dur-rise) linear infinite; }
        @keyframes thing-spin { to { rotate: 1turn; } }
      `),
    ).toEqual([]);
  });
});

/**
 * Every way around the axis that has been thought of, each written as the rule somebody
 * would actually write. A row that stops failing is a hole, not a tidy-up.
 */
const BYPASSES: Readonly<Record<string, string>> = {
  "a press that states its own distance": `
    .p { transition: translate var(--dur-travel) ease; }
    .p:active { translate: 2px 2px; }`,
  "a distance the other way, which a check reading for positives misses": `
    .p:hover { translate: 0 -40px; }`,
  "a unit newer than the check": `
    .p:hover { translate: 0 4dvh; }`,
  "a percentage in front, laundering the component behind it": `
    .p:hover { translate: 0% 40px; }`,
  "a distance inside a calc": `
    .p:hover { translate: 0 calc(50% - 4dvh); }`,
  "a distance laundered through a name of its own": `
    .p { --jump: 40px; }
    .p:hover { translate: 0 var(--jump); }`,
  "a name that looks like the axis and is declared away from it": `
    .p { --travel-jump: 40px; }
    .p:hover { translate: 0 var(--travel-jump); }`,
  "a state the selector list does not know": `
    .p.dragging { translate: 0 40px; }`,
  "travel through the transform shorthand": `
    .p { transition: transform var(--dur-travel) ease; }
    .p:hover { transform: translateY(-40px); }`,
  "a transition that puts the time first": `
    .p { transition: var(--dur-rise) transform ease; }
    .p:hover { transform: translate(0%, -40px); }`,
  "a transition of everything at once": `
    .p { transition: 440ms all ease; }
    .p:hover { top: 40px; }`,
  "content pushed aside rather than moved": `
    .p { transition: padding-left var(--dur-rise) ease; }
    .p:hover { padding-left: 40px; }`,
  "a turn about an origin outside the box, which is a sweep across the surface": `
    .p { transform-origin: 0 400px; transition: rotate var(--dur-fast) ease; }
    .p:hover { rotate: 20deg; }`,
  "a keyframe that flies": `
    .p { animation: p-fly 1s infinite; }
    @keyframes p-fly { from { left: 0; } to { left: 300px; } }`,
  "a keyframe whose steps are written together": `
    .p { animation: p-drift 2s infinite; }
    @keyframes p-drift { 0%, 40% { translate: 0 0; } 60%, 100% { translate: 0 40px; } }`,
  "a keyframe under the shorthand that carries both axes": `
    @keyframes p-turn { to { transform: rotate(1turn); } }`,
  "in-place life dragged onto the travel duration": `
    .p { transition: opacity var(--dur-travel) ease; }`,
  "a transition stated in longhands the shorthand rule cannot see": `
    .p { transition-property: translate; transition-duration: 440ms; }`,
  "the per-component opt-in, come back": `
    @media (prefers-reduced-motion: no-preference) {
      .p { transition: translate var(--dur-travel) ease; }
    }`,
  "a second answer to the preference": `
    @media (prefers-reduced-motion: reduce) { .p { transition: none; } }`,
  "content slid by moving the clip that shows it": `
    .p { transition: clip-path 400ms ease; }
    .p:hover { clip-path: inset(0 0 0 40px); }`,
  "a thing carried along an offset path": `
    .p { transition: offset-distance 1s ease; }
    .p:hover { offset-distance: 60%; }`,
  "an image slid inside the frame that holds it": `
    .p { transition: object-position var(--dur-rise) ease; }
    .p:hover { object-position: 40px 0; }`,
  "a drawn line's own end, moved": `
    .p { animation: p-stretch 1s infinite; }
    @keyframes p-stretch { from { x2: 0; } to { x2: 300; } }`,
};

describe("a rule written to get around the axis", () => {
  for (const [what, css] of Object.entries(BYPASSES)) {
    test(`fails: ${what}`, () => {
      expect(probe(css), `${what} passed the check`).not.toEqual([]);
    });
  }
});

/** The same, for the scripts — where a stylesheet check cannot see at all. */
const SCRIPTED: Readonly<Record<string, string>> = {
  "an element animated somewhere else": `el.animate([{ translate: "0 -400px" }, { translate: "0 0" }], { duration: 600 });`,
  "frames handed over in a variable, out of sight": `el.animate(FRAMES, { duration: 600 });`,
  "one frame, which travels from wherever the element is": `el.animate([{ transform: "translateY(400px)" }], { duration: 600 });`,
  "a transition written from the script": `el.style.transition = "translate 600ms ease";`,
  "a script asking the OS what the axis already knows": `const quiet = matchMedia("(prefers-reduced-motion: reduce)").matches;`,
};

describe("a script written to get around the axis", () => {
  for (const [what, source] of Object.entries(SCRIPTED)) {
    test(`fails: ${what}`, () => {
      expect(scriptViolations([{ name: "probe.js", source }]), `${what} passed`).not.toEqual([]);
    });
  }

  test("passes: an arrival that grows into itself where it stands", () => {
    expect(
      scriptViolations([
        {
          name: "probe.js",
          source: `el.animate([{ opacity: 0, scale: "0.96" }, { opacity: 1, scale: "1" }], { duration: 180 });`,
        },
      ]),
    ).toEqual([]);
  });
});
