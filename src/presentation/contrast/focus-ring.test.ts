import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { type Declaration, declarations } from "./contrast.js";
import { AUDITED_SHEETS } from "./contrast-audit.js";

/*
 * The focus ring, and the split PLAN decision 45 settles.
 *
 * A text input shows the ring on any focus, because a ring on a clicked field
 * tells you where typing will land. Every other control shows it on keyboard
 * focus only, because a ring on a clicked button tells you nothing you did not
 * just do. Both halves are declared in CSS, so both are checked there — and so is
 * the thing that made the shipped ring wrong in the first place, which was not a
 * selector at all but a second file restating the global two pixels thinner.
 *
 * **What this file proves, and what it cannot.** Every rule here is read out of the
 * shipped stylesheets: which selectors paint a ring, that no second file overrides
 * one, that nothing draws a ring as a shadow instead, and that only the named
 * text-input shells ask for a bare `:focus`. That is what catches the regressions
 * this ring has actually had. What it is *not* is the browser: the cascade, and
 * `:focus-visible`'s own modality heuristic, are the user agent's, and there is no
 * DOM environment in this repo to run them in. Adding one is a dependency decision
 * this file may not take on its own.
 *
 * So the behavioural half is a **stated procedure**, run against the live desk, and
 * repeatable by anyone in a minute:
 *
 *   1. Click into the prompt field. `.prompt__composer` computes
 *      `outline: 3px solid var(--focus-ring)` at offset `3px`, and the field itself
 *      computes `outline-style: none` — the shell carries the ring.
 *   2. Click a logo. It is `document.activeElement`, `:focus` matches,
 *      `:focus-visible` does not, and it computes `outline-style: none`.
 *   3. Press Tab. The next control — a window lamp — matches `:focus-visible` and
 *      computes `outline: 3px solid` at offset `0`.
 *
 * Confirmed on 2026-09-02 against the running dev server, exactly as written.
 */

const RING = "3px solid var(--focus-ring)";

/** The offsets a ring is drawn at, and why each one is not the default. */
const OFFSETS: Readonly<Record<string, string>> = {
  "2px": "the default, clear of the drawn line",
  "3px": "a rail whose shadow needs the extra pixel",
  "0": "a control inset in something, or standing on a fill the ring cannot clear",
  "-3px": "the segmented control, drawn inside the line that encloses it",
};

/** Split a selector list on its own commas, not on the ones inside `:not()` or `:is()`. */
function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of selector) {
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  return [...parts, current.trim()].filter(Boolean);
}

function rulesFor(properties: readonly string[]): Declaration[] {
  return AUDITED_SHEETS.flatMap((sheet) => declarations(sheet, properties));
}

/** Every rule that paints an outline, one entry per selector it paints for. */
function rings(): { sheet: string; selector: string; value: string; offset?: string }[] {
  return rulesFor(["outline"])
    .filter(({ value }) => value !== "none")
    .flatMap((rule) => {
      const offset = declarations(rule.sheet, ["outline-offset"]).find(
        (other) => other.selector === rule.selector,
      )?.value;
      return selectorParts(rule.selector).map((selector) => ({
        sheet: rule.sheet,
        selector,
        value: rule.value,
        offset,
      }));
    });
}

/** What a `:has()` is asking about, read with its own brackets balanced. */
function hasArgument(selector: string): string | undefined {
  const open = selector.indexOf(":has(");
  if (open < 0) return undefined;
  let depth = 0;
  for (let index = open + 4; index < selector.length; index += 1) {
    if (selector[index] === "(") depth += 1;
    if (selector[index] === ")") {
      depth -= 1;
      if (depth === 0) return selector.slice(open + 5, index);
    }
  }
  return undefined;
}

/** A ring that paints on any focus: `:focus-within`, or a bare `:focus` anywhere. */
function paintsOnAnyFocus(selector: string): boolean {
  return selector.includes(":focus-within") || /:focus(?!-)/.test(selector);
}

/**
 * The shells that are allowed to, each with the control it rings for and the rule
 * that stops that control ringing again further in.
 */
const TEXT_INPUT_SHELLS: readonly { shell: string; suppresses: string }[] = [
  {
    shell: "design/styles/components/controls.css § .search:has(.search__input:focus)",
    suppresses: "design/styles/components/controls.css § .search__input:focus",
  },
  {
    shell: "design/styles/components/desk.css § .prompt-bar:has(.prompt-bar__input:focus)",
    suppresses: "design/styles/components/desk.css § .prompt-bar__input:focus",
  },
  {
    shell:
      'design/styles/components/form-controls.css § .field__control:has(:is(input:not([type="checkbox"], [type="radio"]), textarea):focus)',
    suppresses:
      "design/styles/components/form-controls.css § .field__control :is(input, textarea, select):focus",
  },
  {
    shell:
      "public/css/collection.css § .capability-search__control:has(.capability-search__input:focus)",
    suppresses: "public/css/collection.css § .capability-search__input:focus",
  },
  {
    shell: "public/css/prompt.css § .prompt__composer:has(.prompt__field:focus)",
    suppresses: "public/css/prompt.css § .prompt__field:focus",
  },
];

describe("the focus ring", () => {
  test("is declared once, and every other rule paints the same one", () => {
    const global = rings().filter(({ selector }) => selector === ":focus-visible");
    expect(
      global.map(({ sheet }) => sheet),
      "the surface has one global focus ring, and it is in the token layer's base sheet",
    ).toEqual(["design/styles/base.css"]);
    expect(global[0]?.value).toBe(RING);

    for (const ring of rings()) {
      expect(ring.value, `${ring.sheet} § ${ring.selector} paints a different ring`).toBe(RING);
      expect(
        Object.keys(OFFSETS),
        `${ring.sheet} § ${ring.selector} is drawn at an offset nothing accounts for`,
      ).toContain(ring.offset ?? "2px");
    }
  });

  test("no two-file override survives", () => {
    // `public/css/a11y.css` restated the global at 2px. It loads after the manifest, so
    // the app shipped a ring the design does not draw — and the mechanism, not the
    // number, is what had to go: a second file that wins by loading later. The sheet
    // itself is gone now: its other half was the blanket reduced-motion reset, which
    // PLAN decision 44 replaced with the travel axis, and a file whose whole purpose
    // was beating the ones above it had nothing left to hold.
    expect(
      existsSync(new URL("../../../public/css/a11y.css", import.meta.url)),
      "the accessibility layer is back, and it wins by loading last again",
    ).toBe(false);
    for (const fragment of ["outline-color", "outline-width", "outline-style"]) {
      expect(rulesFor([fragment]), `a rule sets ${fragment} on a ring another rule owns`).toEqual(
        [],
      );
    }
    // An offset on its own is the same override wearing a different property name.
    const painted = new Set(
      rulesFor(["outline"]).map(({ sheet, selector }) => `${sheet} ${selector}`),
    );
    for (const rule of rulesFor(["outline-offset"])) {
      expect(
        painted.has(`${rule.sheet} ${rule.selector}`),
        `${rule.sheet} § ${rule.selector} offsets a ring it does not declare`,
      ).toBe(true);
    }
  });

  test("no outline reaches for the signal colour, and no ring hides in a shadow", () => {
    // `--signal` is the alert colour and has a job of its own. The base stylesheet used
    // to name it here and painted violet only because a later file overrode the colour.
    for (const ring of rings()) {
      expect(
        ring.value,
        `${ring.sheet} § ${ring.selector} rings in the alert colour`,
      ).not.toContain("--signal");
      expect(ring.value).toContain("var(--focus-ring)");
    }
    // A `box-shadow` on a focus state is a ring under another name, and it would be
    // invisible to every assertion above.
    for (const shadow of rulesFor(["box-shadow"])) {
      expect(
        shadow.selector,
        `${shadow.sheet} § ${shadow.selector} draws a focus indicator as a shadow`,
      ).not.toContain(":focus");
    }
  });

  test("a text input rings on any focus; everything else waits for the keyboard", () => {
    const anyFocus = rings().filter(({ selector }) => paintsOnAnyFocus(selector));
    expect(
      anyFocus.map(({ sheet, selector }) => `${sheet} § ${selector}`).sort(),
      "a control that is not a text input paints its ring on a mouse click",
    ).toEqual(TEXT_INPUT_SHELLS.map(({ shell }) => shell).sort());

    for (const ring of rings()) {
      if (paintsOnAnyFocus(ring.selector)) continue;
      expect(
        ring.selector,
        `${ring.sheet} § ${ring.selector} rings without asking for keyboard focus`,
      ).toContain(":focus-visible");
    }
  });

  test("an any-focus shell has to name the text control it rings for", () => {
    // The list above is not a licence: a shell earns its place by saying, in the
    // selector itself, that what it is ringing for is somewhere a reader types.
    // `:focus-within` never says that — it matches the shell, and every button in it.
    for (const { shell } of TEXT_INPUT_SHELLS) {
      const [, selector] = shell.split(" § ");
      expect(selector, `${shell} rings for anything focused inside it`).not.toContain(
        ":focus-within",
      );
      const asks = hasArgument(selector as string);
      expect(asks, `${shell} rings without asking about anything`).toBeDefined();
      expect(asks, `${shell} does not name a text control`).toMatch(
        /\binput\b|\btextarea\b|__input|__field/,
      );
      expect(asks, `${shell} rings for a button`).not.toContain("button");
      expect(asks, `${shell} asks about focus it does not own`).toMatch(/:focus$/);
    }
  });

  test("the shell carries the ring and the control inside it carries none", () => {
    // The design's rule: painted on the enclosing shell, with the inner control's own
    // ring suppressed, so a field never shows a second ring further in.
    const suppressed = new Set(
      rulesFor(["outline"])
        .filter(({ value }) => value === "none")
        .map(({ sheet, selector }) => `${sheet} § ${selector}`),
    );
    for (const { shell, suppresses } of TEXT_INPUT_SHELLS) {
      expect(suppressed, `${shell} paints a ring the control inside it also paints`).toContain(
        suppresses,
      );
    }
    for (const rule of rulesFor(["outline"]).filter(({ value }) => value === "none")) {
      expect(
        rule.selector,
        `${rule.sheet} § ${rule.selector} removes a ring unconditionally`,
      ).toContain(":focus");
    }
  });
});
