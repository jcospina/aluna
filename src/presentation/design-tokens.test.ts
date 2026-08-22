import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isTokenFrom,
  LINE_WEIGHT_TOKENS,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./design-tokens.ts";

// The cross-check that keeps the *names* the contract closes on bound to the stylesheet
// that holds their *values*. Values live once in `design/styles/tokens.css`; a token
// renamed or removed there fails here rather than quietly becoming an off-token value the
// gate rejects at build time — the same guard `vocabulary.test.ts` puts on the class
// allow-list.

const TOKENS_CSS = readFileSync(resolve(import.meta.dir, "../../design/styles/tokens.css"), "utf8");

/** The custom properties `:root` actually declares, by bare name. */
function declaredTokens(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of TOKENS_CSS.matchAll(/^\s*--([a-z0-9_-]+)\s*:/gim)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

const DECLARED = declaredTokens();

describe("the closed axes name only tokens High Meadow declares", () => {
  test.each([
    ["palette colour", PALETTE_COLOR_TOKENS],
    ["type size", TYPE_SIZE_TOKENS],
    ["spacing", SPACING_TOKENS],
    ["border weight", LINE_WEIGHT_TOKENS],
  ])("%s", (_axis, tokens) => {
    expect(tokens.size).toBeGreaterThan(0);
    for (const name of tokens) {
      expect(DECLARED.has(name), `design/styles/tokens.css declares no --${name}`).toBe(true);
    }
  });

  test("the palette carries every colour the handbook names and none of the chrome-only ones", () => {
    // design/design-system.md §Colour: five fills, ink at reading strengths, eight tint
    // anchors, and the reserved signal. The title-bar panes, the partial-strength ink the
    // ink system draws with, and the focus ring are chrome, not a record's to name.
    expect([...PALETTE_COLOR_TOKENS]).toEqual([
      "ground",
      "ground-deep",
      "surface",
      "surface-2",
      "ink",
      "ink-2",
      "ink-3",
      "leaf",
      "shade",
      "teal",
      "sky",
      "sun",
      "ochre",
      "clay",
      "violet",
      "signal",
    ]);
    for (const chrome of [
      "pane-1",
      "pane-5",
      "focus-ring",
      "ink-hair",
      "ink-shadow",
      "title-bar",
    ]) {
      expect(DECLARED.has(chrome)).toBe(true);
      expect(PALETTE_COLOR_TOKENS.has(chrome)).toBe(false);
    }
  });

  test("the size and spacing sets are the whole declared ladders", () => {
    const declaredType = [...DECLARED].filter((name) => name.startsWith("type-"));
    const declaredSpace = [...DECLARED].filter((name) => name.startsWith("space-"));
    expect(new Set(declaredType)).toEqual(new Set(TYPE_SIZE_TOKENS));
    expect(new Set(declaredSpace)).toEqual(new Set(SPACING_TOKENS));
  });

  test("border weight has no ladder — High Meadow states one line and no radius token", () => {
    expect([...LINE_WEIGHT_TOKENS]).toEqual(["line"]);
    expect([...DECLARED].filter((name) => name.endsWith("radius"))).toEqual([]);
  });

  test("the retired Paper & Ink vocabulary is gone from the stylesheet and the sets", () => {
    for (const retired of ["color-text", "color-accent", "border-regular", "radius-md"]) {
      expect(DECLARED.has(retired)).toBe(false);
      expect(PALETTE_COLOR_TOKENS.has(retired)).toBe(false);
      expect(LINE_WEIGHT_TOKENS.has(retired)).toBe(false);
    }
  });
});

describe("token helpers", () => {
  test("isTokenFrom accepts a bare var() and nothing else", () => {
    expect(isTokenFrom("var(--ink)", PALETTE_COLOR_TOKENS)).toBe(true);
    expect(isTokenFrom("var(--ink, red)", PALETTE_COLOR_TOKENS)).toBe(false);
    expect(isTokenFrom("var(--pane-1)", PALETTE_COLOR_TOKENS)).toBe(false);
    expect(isTokenFrom("ink", PALETTE_COLOR_TOKENS)).toBe(false);
    expect(isTokenFrom("VAR(--ink)", PALETTE_COLOR_TOKENS)).toBe(false);
  });

  test("tokenList renders the set the way a refusal names it", () => {
    expect(tokenList(LINE_WEIGHT_TOKENS)).toBe("var(--line)");
    expect(tokenList(SPACING_TOKENS)).toContain("var(--space-1), var(--space-2)");
  });
});
