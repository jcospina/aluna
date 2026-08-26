import { describe, expect, test } from "bun:test";

import { describeStyleViolation, sanitizeStyle } from "./style-discipline.ts";

// Unit coverage for the inline-`style` token discipline (ADR-0005 §4, amended 2026-07-01
// and re-derived against High Meadow in epic 5.1). `sanitizeStyle` returns the value
// unchanged when every declaration conforms (so the enforcer can leave the attribute
// byte-identical), the surviving declarations when some are dropped, or "" when none
// survive. `describeStyleViolation` reports the same verdict in words.

describe("sanitizeStyle — conforming values pass through unchanged", () => {
  test("palette colour and spacing", () => {
    const value = "color: var(--ink); padding: var(--space-2)";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("type scale and a palette fill — the separation a record has instead of a border", () => {
    const value = "font-size: var(--type-lg); background-color: var(--sun)";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("structural zero, auto, and global keywords", () => {
    const value = "margin: 0 auto; gap: var(--space-1); padding: inherit";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("free (non-owned-axis) properties for arrangement", () => {
    const value = "display: flex; align-items: center; aspect-ratio: 4 / 3; min-height: 12rem";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("a trailing semicolon is not treated as a dropped declaration", () => {
    const value = "color: var(--ink-2);";
    expect(sanitizeStyle(value)).toBe(value);
  });

  test("every High Meadow token on each closed axis", () => {
    // The whole set, not a sample: a renamed or dropped token has to fail loudly here
    // rather than quietly become an off-token value at build time.
    for (const name of [
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
    ]) {
      expect(sanitizeStyle(`color: var(--${name})`)).toBe(`color: var(--${name})`);
    }
    for (const name of ["xs", "sm", "base", "md", "lg", "xl", "title", "display"]) {
      expect(sanitizeStyle(`font-size: var(--type-${name})`)).toBe(
        `font-size: var(--type-${name})`,
      );
    }
    for (let step = 1; step <= 8; step += 1) {
      expect(sanitizeStyle(`padding: var(--space-${step})`)).toBe(`padding: var(--space-${step})`);
    }
  });
});

describe("sanitizeStyle — off-token declarations on the closed axes are dropped", () => {
  test("raw colours: hex, named, and colour functions", () => {
    expect(sanitizeStyle("color: #ff0000")).toBe("");
    expect(sanitizeStyle("color: red")).toBe("");
    expect(sanitizeStyle("color: rgb(255,0,0)")).toBe("");
    expect(sanitizeStyle("color: oklch(63% 0.16 38)")).toBe("");
  });

  test("the retired Paper & Ink vocabulary resolves to nothing and is off-token", () => {
    expect(sanitizeStyle("color: var(--color-text)")).toBe("");
    expect(sanitizeStyle("background-color: var(--color-border)")).toBe("");
  });

  test("a colour outside the palette — chrome-only tokens are not the record's to name", () => {
    expect(sanitizeStyle("background-color: var(--pane-3)")).toBe("");
    expect(sanitizeStyle("color: var(--focus-ring)")).toBe("");
    expect(sanitizeStyle("color: var(--ink-hair)")).toBe("");
  });

  test("a var() fallback cannot launder an off-token colour", () => {
    expect(sanitizeStyle("color: var(--ink, red)")).toBe("");
  });

  test("raw font size", () => {
    expect(sanitizeStyle("font-size: 24px")).toBe("");
    expect(sanitizeStyle("font-size: 1.2rem")).toBe("");
  });

  test("raw spacing", () => {
    expect(sanitizeStyle("padding: 16px")).toBe("");
    expect(sanitizeStyle("margin-left: 2rem")).toBe("");
  });

  // The ways around the boundary ban that do not spell "border". A ban keyed on a property
  // name is only as good as the list of ways to draw a line, so each of these is a line
  // the ban would otherwise have pushed a generated record toward.
  test("an ink fill is a frame, so `--ink` never fills a box", () => {
    // An `--ink` block wrapped round a `--surface` block is a border at whatever thickness
    // the padding says — drawn beside the hand-drawn line rather than instead of it. The
    // handbook already said `--ink` fills nothing; before the ban it cost nothing to leave
    // that unenforced, because a record wanting a frame could just declare one.
    for (const declaration of [
      "background-color: var(--ink)",
      "background: var(--ink)",
      "background-color: var(--ink-2)",
      "background-color: var(--ink-3)",
      "background-image: var(--ink)",
      "fill: var(--ink)",
    ]) {
      expect(sanitizeStyle(declaration), declaration).toBe("");
      expect(describeStyleViolation(declaration), declaration).toContain("never a fill");
    }

    // Ink still sets type and still strokes a path, and every other fill is untouched.
    for (const kept of [
      "color: var(--ink)",
      "color: var(--ink-2)",
      "stroke: var(--ink)",
      "background-color: var(--surface)",
      "background-color: var(--sun)",
      "background-color: transparent",
    ]) {
      expect(sanitizeStyle(kept), kept).toBe(kept);
    }

    // And an off-palette fill keeps the palette's own refusal: it is not an ink problem.
    expect(describeStyleViolation("background: white")).toContain("colour is picked from");
  });

  test("a line has no weight left to name, whatever property asks for one", () => {
    // Retiring the border-weight axis left no thickness token anywhere on the surface, so
    // a property whose value *is* a thickness has no value it may take. Refusing it says
    // that, rather than letting a raw length through on a property no axis happens to own.
    for (const declaration of [
      "-webkit-text-stroke: 2px currentcolor",
      "-webkit-text-stroke: 2px black",
      "-webkit-text-stroke-width: 3px",
      "text-decoration-thickness: 6px",
      "text-underline-offset: 4px",
    ]) {
      expect(sanitizeStyle(declaration), declaration).toBe("");
      expect(describeStyleViolation(declaration), declaration).toBeDefined();
    }

    expect(sanitizeStyle("text-decoration: underline")).toBe("text-decoration: underline");
  });

  // The fourth ban. Nothing about the value saves it: the one weight the retired axis
  // named is refused beside a raw one, and so are the two edges that are a border under
  // another name. `border-spacing` is a table metric that draws nothing and stays on the
  // spacing axis, which is what keeps this a boundary ban rather than a prefix sweep.
  test("a boundary of any kind, at any weight", () => {
    for (const declaration of [
      "border: var(--line) solid var(--ink)",
      "border: 1px solid red",
      "border-width: 5px",
      "border-width: var(--line)",
      "border-top: var(--line) solid var(--ink)",
      "border-inline-start-width: var(--line)",
      "border-color: var(--ink)",
      "border-style: solid",
      "outline: var(--line) solid var(--ink)",
      "outline-width: var(--line)",
      "outline-offset: var(--space-1)",
      "column-rule: var(--line) solid var(--ink)",
    ]) {
      expect(sanitizeStyle(declaration), declaration).toBe("");
      expect(describeStyleViolation(declaration), declaration).toContain(
        "`border` is never declared",
      );
    }

    expect(sanitizeStyle("border-spacing: var(--space-2)")).toBe("border-spacing: var(--space-2)");
    expect(sanitizeStyle("border-spacing: 4px")).toBe("");
    expect(sanitizeStyle("border-collapse: collapse")).toBe("border-collapse: collapse");
  });

  test("wrong token namespace on a closed axis", () => {
    expect(sanitizeStyle("padding: var(--type-lg)")).toBe("");
    expect(sanitizeStyle("color: var(--space-2)")).toBe("");
  });

  test("keeps the conforming declarations and drops only the offending ones", () => {
    expect(sanitizeStyle("color: red; padding: var(--space-1); font-size: 40px")).toBe(
      "padding: var(--space-1)",
    );
  });
});

describe("sanitizeStyle — the three never-declared properties", () => {
  test("font family, in every form", () => {
    expect(sanitizeStyle("font-family: Comic Sans")).toBe("");
    expect(sanitizeStyle("font-family: var(--font-body)")).toBe("");
    expect(sanitizeStyle("font: italic 12px serif")).toBe("");
  });

  test("border-radius, including a zero and every longhand", () => {
    // A square corner is the absence of a declaration, so even `0` is a declaration too
    // many — there is nothing to pick from.
    expect(sanitizeStyle("border-radius: 8px")).toBe("");
    expect(sanitizeStyle("border-radius: 0")).toBe("");
    expect(sanitizeStyle("border-top-left-radius: 8px")).toBe("");
    expect(sanitizeStyle("border-bottom-right-radius: 50%")).toBe("");
    expect(sanitizeStyle("border-start-start-radius: 8px")).toBe("");
    expect(sanitizeStyle("border-end-end-radius: 8px")).toBe("");
    expect(sanitizeStyle("-webkit-border-radius: 8px")).toBe("");
  });

  test("box-shadow, including the silently-invalid token form", () => {
    // `var(--shadow-window)` expands to `5 6 0.24` — a bare `<x> <y> <alpha>` triple, not a
    // CSS shadow. It paints nothing and reports nothing; only the ban catches it.
    expect(sanitizeStyle("box-shadow: var(--shadow-window)")).toBe("");
    expect(sanitizeStyle("box-shadow: var(--shadow-window-wall)")).toBe("");
    expect(sanitizeStyle("box-shadow: 0 2px 4px var(--ink)")).toBe("");
    expect(sanitizeStyle("box-shadow: none")).toBe("");
    expect(sanitizeStyle("-webkit-box-shadow: 0 0 2px var(--ink)")).toBe("");
  });

  test("a banned property does not take its conforming siblings with it", () => {
    expect(sanitizeStyle("border-radius: 8px; color: var(--ink)")).toBe("color: var(--ink)");
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
    expect(sanitizeStyle("color var(--ink)")).toBe("");
    expect(sanitizeStyle("garbage")).toBe("");
  });

  test("empty and whitespace-only values", () => {
    expect(sanitizeStyle("")).toBe("");
    expect(sanitizeStyle("   ")).toBe("");
    expect(sanitizeStyle(";;;")).toBe("");
  });
});

describe("describeStyleViolation — the same verdict, in the contract's words", () => {
  test("says nothing about a conforming value", () => {
    expect(
      describeStyleViolation("color: var(--ink); padding: var(--space-2); font-size: inherit"),
    ).toBeUndefined();
  });

  test("names the closed axis and the whole set it picks from", () => {
    const colour = describeStyleViolation("color: red") ?? "";
    expect(colour).toContain("`color: red`");
    expect(colour).toContain("colour is picked from the High Meadow set");
    expect(colour).toContain("var(--leaf)");
    expect(colour).toContain("var(--signal)");

    const size = describeStyleViolation("font-size: 24px") ?? "";
    expect(size).toContain("type size is picked from the High Meadow set");
    expect(size).toContain("var(--type-xs)");

    const spacing = describeStyleViolation("padding: 16px") ?? "";
    expect(spacing).toContain("spacing is picked from the High Meadow set");
    expect(spacing).toContain("var(--space-8)");
  });

  test("names each ban and why it exists", () => {
    expect(describeStyleViolation("font-family: serif")).toContain("font family is never declared");
    expect(describeStyleViolation("border: var(--line) solid var(--ink)")).toContain(
      "the ink system owns every boundary",
    );
    expect(describeStyleViolation("border-radius: 8px")).toContain(
      "High Meadow has no radius tokens",
    );
    expect(describeStyleViolation("box-shadow: var(--shadow-window)")).toContain("fails silently");
  });

  test("reports the first offender and agrees with what sanitizeStyle drops", () => {
    expect(describeStyleViolation("padding: var(--space-1); color: red")).toContain("`color: red`");
    expect(describeStyleViolation("position: fixed")).toContain("escape its own bounds");
    expect(describeStyleViolation("background: url(x.png)")).toContain("forbidden construct");
    expect(describeStyleViolation("--x: red")).toContain("custom-property");
    expect(describeStyleViolation("garbage")).toContain("`property: value`");
  });
});

describe("sanitizeStyle — the ways a property can hide what it names", () => {
  test("a CSS ident escape does not walk a property past its ban or its axis", () => {
    // `\66 ont-family` *is* `font-family` to a browser. Nothing a record legitimately
    // declares needs an escape, so a property that is not a plain ident is refused whole.
    expect(sanitizeStyle("\\66 ont-family: 'Comic Sans MS', cursive")).toBe("");
    expect(sanitizeStyle("\\62 ox-shadow: 0 4px 8px var(--ink)")).toBe("");
    expect(sanitizeStyle("\\66 ont-size: 72px")).toBe("");
    expect(sanitizeStyle("\\70 adding: 37px")).toBe("");
    expect(describeStyleViolation("\\70 adding: 37px")).toContain("plain CSS ident");
  });

  test("a vendor prefix is held to the same axis as the bare property", () => {
    // `-webkit-text-fill-color` overrides `color`, so it paints type; the chrome-only
    // focus-ring token is not the record's to paint with either way.
    expect(sanitizeStyle("-webkit-text-fill-color: var(--focus-ring)")).toBe("");
    expect(sanitizeStyle("-webkit-text-fill-color: rebeccapurple")).toBe("");
    expect(sanitizeStyle("-webkit-margin-start: 137px")).toBe("");
    expect(sanitizeStyle("-moz-padding-start: 137px")).toBe("");
    // …and a prefixed property naming an on-token value still passes.
    expect(sanitizeStyle("-webkit-text-fill-color: var(--ink)")).toBe(
      "-webkit-text-fill-color: var(--ink)",
    );
  });

  test("the background shorthand is the surface fill and sits on the colour axis", () => {
    expect(sanitizeStyle("background: var(--surface-2)")).toBe("background: var(--surface-2)");
    expect(sanitizeStyle("background: var(--title-bar)")).toBe(""); // the chrome's own gradient
    expect(sanitizeStyle("background: linear-gradient(var(--sky), var(--leaf))")).toBe("");
    expect(sanitizeStyle("background: color-mix(in srgb, var(--ink) 50%, var(--sun))")).toBe("");
    expect(sanitizeStyle("background: white")).toBe("");
  });

  test("a character reference cannot smuggle a resource load past the value scan", () => {
    // The parser hands back raw attribute text while the browser decodes it, so
    // `&#x75;rl(...)` would read as harmless `rl(` and still load on screen.
    expect(sanitizeStyle("background-image: &#x75;rl('https://evil.example/pixel.png')")).toBe("");
    expect(sanitizeStyle("color: &#114;ed")).toBe("");
  });

  test("the shadow ban is written around the effect, not around one property name", () => {
    expect(sanitizeStyle("text-shadow: 0 2px 4px var(--ink)")).toBe("");
    expect(sanitizeStyle("text-shadow: var(--shadow-desk-label)")).toBe("");
    expect(sanitizeStyle("filter: drop-shadow(0 4px 8px var(--ink))")).toBe("");
  });

  test("`all` cannot reset away the inheritance the font-family ban depends on", () => {
    expect(sanitizeStyle("all: initial")).toBe("");
    expect(sanitizeStyle("all: unset")).toBe("");
    expect(sanitizeStyle("-webkit-all: initial")).toBe("");
  });

  test("in-flow offsets are spacing, so `position: relative` cannot walk out of bounds", () => {
    expect(sanitizeStyle("position: relative; top: -400px; left: 900px")).toBe(
      "position: relative",
    );
    expect(sanitizeStyle("top: var(--space-2)")).toBe("top: var(--space-2)");
    expect(sanitizeStyle("inset: 0")).toBe("inset: 0");
    expect(sanitizeStyle("text-indent: 133px")).toBe("");
    expect(sanitizeStyle("border-spacing: 47px")).toBe("");
  });
});

describe("sanitizeStyle — legal CSS spellings of an on-token value", () => {
  test("var() with the whitespace CSS allows inside the parentheses", () => {
    // Refusing this told the model to name the very token it had named, so the gate's fix
    // loop could never converge and the build failed closed on a conforming renderer.
    expect(sanitizeStyle("color: var( --ink )")).toBe("color: var( --ink )");
    expect(sanitizeStyle("padding: var(  --space-2  )")).toBe("padding: var(  --space-2  )");
    expect(describeStyleViolation("color: var( --ink )")).toBeUndefined();
  });

  test("!important decides who wins, not what value is named", () => {
    expect(sanitizeStyle("color: var(--ink) !important")).toBe("color: var(--ink) !important");
    expect(sanitizeStyle("padding: var(--space-2)!important")).toBe(
      "padding: var(--space-2)!important",
    );
    // It is not a way to smuggle an off-token value either.
    expect(sanitizeStyle("color: red !important")).toBe("");
  });
});

describe("describeStyleViolation — agreement with what sanitizeStyle drops", () => {
  test("an empty style attribute is reported rather than left to a before/after dump", () => {
    // The enforcer removes an empty attribute, so the markup does not survive
    // byte-identical; silence here would leave the two surfaces disagreeing.
    for (const empty of ["", " ", ";", "; ;"]) {
      expect(sanitizeStyle(empty)).toBe("");
      expect(describeStyleViolation(empty)).toContain("holds no declaration");
    }
  });

  test("the two surfaces agree across an exhaustive property × value grid", () => {
    const props = [
      "color",
      "background",
      "background-color",
      "font-size",
      "font-family",
      "padding",
      "margin-inline-start",
      "gap",
      "top",
      "border",
      "border-width",
      "border-radius",
      "box-shadow",
      "text-shadow",
      "all",
      "position",
      "display",
      "\\70 adding",
      "-webkit-text-fill-color",
      "--custom",
    ];
    const values = [
      "var(--ink)",
      "var( --ink )",
      "var(--ink) !important",
      "var(--space-2)",
      "var(--type-lg)",
      "var(--line) solid var(--ink)",
      "var(--color-text)",
      "red",
      "#fff",
      "0",
      "auto",
      "inherit",
      "none",
      "relative",
      "fixed",
      "flex",
      "12px",
      "url(x.png)",
      "&#x75;rl(x.png)",
      "linear-gradient(var(--sky), var(--leaf))",
      "",
    ];
    for (const prop of props) {
      for (const value of values) {
        const declaration = `${prop}: ${value}`;
        const clean = describeStyleViolation(declaration) === undefined;
        expect(sanitizeStyle(declaration) === declaration, declaration).toBe(clean);
      }
    }
  });
});

describe("sanitizeStyle — the remaining ways out of the box or onto the screen", () => {
  test("every resource-loading function, not only the two that were named", () => {
    // `image()` and `src()` are CSS Images 4 and not shipped broadly yet, which is exactly
    // why enumerating the loaders that exist today is the wrong shape to rely on.
    expect(sanitizeStyle('list-style-image: image("https://evil.example/x.png")')).toBe("");
    expect(sanitizeStyle('list-style-image: src("https://evil.example/x.png")')).toBe("");
    expect(sanitizeStyle('mask-image: image("https://e/x.png")')).toBe("");
    expect(sanitizeStyle('cursor: image("https://e/x.png"), auto')).toBe("");
    expect(sanitizeStyle("background-image: cross-fade(url(a.png), url(b.png))")).toBe("");
    expect(sanitizeStyle("background: paint(worklet)")).toBe("");
  });

  test("box-reflect casts the copy the shadow ban exists to prevent", () => {
    expect(sanitizeStyle("-webkit-box-reflect: below 2px")).toBe("");
    expect(describeStyleViolation("-webkit-box-reflect: below 2px")).toContain(
      "a shadow is never declared",
    );
  });

  test("a record cannot move, turn or scale out of its bounds without naming `position`", () => {
    for (const moved of [
      "transform: translate(900px, -400px)",
      "transform: scale(8)",
      "transform: rotate(45deg)",
      "transform-origin: bottom right",
      "translate: 900px -400px",
      "scale: 8",
      // The third individual transform property. Enumerating the shorthand and two of the
      // three siblings let `rotate` tilt a card clean out of its box past the same rule.
      "rotate: 45deg",
      "zoom: 4",
      "perspective: 100px",
      "offset-path: circle(50px)",
      "offset-distance: 40px",
    ]) {
      expect(sanitizeStyle(moved), moved).toBe("");
      expect(describeStyleViolation(moved), moved).toContain("out of its own bounds");
    }
  });

  test("a property's own initial value is not an off-token value", () => {
    // `auto` and `normal` are the absence of a colour or a gap, not a colour or a size —
    // refusing them told the model to name a token that would not be valid there.
    for (const initial of [
      "caret-color: auto",
      "accent-color: auto",
      "scrollbar-color: auto",
      "column-gap: normal",
    ]) {
      expect(sanitizeStyle(initial), initial).toBe(initial);
      expect(describeStyleViolation(initial), initial).toBeUndefined();
    }
  });

  test("the arrangement functions a record composes with still pass", () => {
    for (const arrangement of [
      "grid-template-columns: minmax(0, 1fr) max-content",
      "width: calc(100% - var(--space-2))",
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
      "aspect-ratio: 1 / 1",
      "min-height: 12rem",
    ]) {
      expect(sanitizeStyle(arrangement), arrangement).toBe(arrangement);
    }
  });
});
