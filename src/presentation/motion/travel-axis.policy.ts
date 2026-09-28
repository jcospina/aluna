import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
 * Reduce Motion quiets travel, not life (PLAN decision 44). The rules are stated over stylesheet
 * text, so this holds the shipped surface to them; `travel-axis.test.ts` holds them to the rules
 * written to get around them.
 */

const ROOT = resolve(import.meta.dir, "../../..");

/**
 * Every stylesheet the product loads: `AUDITED_SHEETS`, kept complete by `contrast-audit.policy.ts`,
 * plus the two manifests it excludes for declaring no colour — a rule in one would still move.
 */
const MOTION_SHEETS = [...AUDITED_SHEETS, "design/styles/index.css", "public/app.css"];

const surface = (): Sheet[] => MOTION_SHEETS.map((name) => ({ name, css: styleSource(name) }));

/** The scripts the product ships, vendored code aside. */
const shipped = (): Script[] =>
  ["design/scripts/**/*.js", "public/**/*.js"]
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })])
    .filter((path) => !path.includes("vendor"))
    .map((name) => ({ name, source: readFileSync(join(ROOT, name), "utf8") }));

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

    // With the setting off, these are the numbers the surface always used: a 1px settle, a 2px
    // press, a 2px lift, one fast duration. The axis rewrote how they are stated, not what.
    expect(tokens.get("--travel-nudge")).toBe("calc(1px * var(--travel))");
    expect(tokens.get("--travel-press")).toBe("calc(2px * var(--travel))");
    expect(tokens.get("--travel-lift")).toBe("calc(-2px * var(--travel))");
    expect(tokens.get("--dur-travel")).toBe("calc(var(--dur-fast) * var(--travel))");
    expect(tokens.get("--dur-fast")).toBe("140ms");
  });

  test("leaves the one animation the surface runs today crawling", () => {
    // The tile that says a capability is still being built crawls in place, so it crawls for
    // everybody, the reader who asked for less motion included.
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
    const sheets = surface();
    expect(sheets.length).toBeGreaterThan(0);
    expect(travelViolations(sheets)).toEqual([]);
  });

  test("keeps its scripts off the axis's blind side", () => {
    const scripts = shipped();
    expect(scripts.length).toBeGreaterThan(0);
    expect(scriptViolations(scripts)).toEqual([]);
  });
});
