import { describe, expect, test } from "bun:test";
import { describeStyleViolation } from "../safety/style-discipline.ts";
import {
  isTokenFrom,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./design-tokens.ts";

// `--line` is the room reserved for the drawn line, never a value a record names.
test("a record cannot name the drawn line as a border", () => {
  expect(describeStyleViolation("border-width: var(--line)")).toContain(
    "`border` is never declared",
  );
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
    expect(tokenList(TYPE_SIZE_TOKENS)).toContain("var(--type-xs), var(--type-sm)");
    expect(tokenList(SPACING_TOKENS)).toContain("var(--space-1), var(--space-2)");
  });
});
