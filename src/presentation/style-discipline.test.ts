import { describe, expect, test } from "bun:test";

import { sanitizeStyle } from "./style-discipline.ts";

// Unit coverage for the inline-`style` token discipline (ADR-0005 §4, amended
// 2026-07-01). `sanitizeStyle` returns the value unchanged when every declaration
// conforms (so the enforcer can leave the attribute byte-identical), the surviving
// declarations when some are dropped, or "" when none survive.

describe("sanitizeStyle — conforming values pass through unchanged", () => {
  test("token color and spacing", () => {
    const value = "color: var(--color-accent); padding: var(--space-2)";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("token type scale and border weight shorthand", () => {
    const value =
      "font-size: var(--type-lg); border: var(--border-thick) solid var(--color-border)";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("structural zero, auto, and global keywords", () => {
    const value = "margin: 0 auto; gap: var(--space-1); padding: inherit";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("free (non-owned-axis) properties for arrangement", () => {
    const value = "display: flex; align-items: center; aspect-ratio: 4 / 3; border-radius: 10px";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("a trailing semicolon is not treated as a dropped declaration", () => {
    const value = "color: var(--color-text);";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("preferred radius / shadow tokens on their free properties", () => {
    const value = "border-radius: var(--radius-md); box-shadow: var(--shadow-sm)";
    expect(sanitizeStyle(value)).toBe(value);
  });
});

describe("sanitizeStyle — off-token declarations on the owned axes are dropped", () => {
  test("raw colors: hex, named, and color functions", () => {
    expect(sanitizeStyle("color: #ff0000")).toBe("");
    expect(sanitizeStyle("color: red")).toBe("");
    expect(sanitizeStyle("color: rgb(255,0,0)")).toBe("");
    expect(sanitizeStyle("color: oklch(63% 0.16 38)")).toBe("");
  });

  test("a var() fallback cannot launder an off-token color", () => {
    expect(sanitizeStyle("color: var(--color-x, red)")).toBe("");
  });

  test("raw font size and any font-family / font shorthand", () => {
    expect(sanitizeStyle("font-size: 24px")).toBe("");
    expect(sanitizeStyle("font-family: Comic Sans")).toBe("");
    expect(sanitizeStyle("font: italic 12px serif")).toBe("");
  });

  test("raw spacing and raw border weight", () => {
    expect(sanitizeStyle("padding: 16px")).toBe("");
    expect(sanitizeStyle("margin-left: 2rem")).toBe("");
    expect(sanitizeStyle("border-width: 5px")).toBe("");
    expect(sanitizeStyle("border: 1px solid red")).toBe("");
  });

  test("wrong token namespace on an owned axis", () => {
    expect(sanitizeStyle("padding: var(--type-lg)")).toBe("");
    expect(sanitizeStyle("color: var(--space-2)")).toBe("");
  });

  test("keeps the conforming declarations and drops only the offending ones", () => {
    expect(sanitizeStyle("color: red; padding: var(--space-1); font-size: 40px")).toBe(
      "padding: var(--space-1)",
    );
  });
});

describe("sanitizeStyle — forbidden constructs are dropped", () => {
  test("url() in any form", () => {
    expect(sanitizeStyle("background: url(https://e/x.png)")).toBe("");
    expect(sanitizeStyle("background: url(javascript:alert(1))")).toBe("");
    expect(sanitizeStyle("background-image: image-set(url(a.png) 1x)")).toBe("");
  });

  test("legacy script vectors", () => {
    expect(sanitizeStyle("width: expression(alert(1))")).toBe("");
    expect(sanitizeStyle("behavior: url(x.htc)")).toBe("");
  });

  test("item-escaping position values, keeping in-flow ones", () => {
    expect(sanitizeStyle("position: fixed")).toBe("");
    expect(sanitizeStyle("position: absolute")).toBe("");
    expect(sanitizeStyle("position: sticky")).toBe("");
    expect(sanitizeStyle("position: relative")).toBe("position: relative");
    expect(sanitizeStyle("position: static")).toBe("position: static");
  });

  test("inline custom-property definitions", () => {
    expect(sanitizeStyle("--evil: red")).toBe("");
    expect(sanitizeStyle("--x: 40px; padding: var(--x)")).toBe("");
  });

  test("a data-URI carrying a semicolon does not survive the split", () => {
    expect(sanitizeStyle("background: url(data:image/png;base64,AAAA)")).toBe("");
  });
});

describe("sanitizeStyle — malformed input", () => {
  test("declarations without a colon are dropped", () => {
    expect(sanitizeStyle("color var(--color-text)")).toBe("");
    expect(sanitizeStyle("garbage")).toBe("");
  });

  test("empty and whitespace-only values", () => {
    expect(sanitizeStyle("")).toBe("");
    expect(sanitizeStyle("   ")).toBe("");
    expect(sanitizeStyle(";;;")).toBe("");
  });
});
