import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LOGO_FAMILY_SHADES,
  LOGO_SHADES,
  type LogoShade,
  logoShadeFamily,
} from "../registry/logo.ts";
import {
  buildLogoGenerationRequest,
  buildLogoPrompt,
  LOGO_GENERATION_MODEL,
  LOGO_GENERATION_RESPONSE_FORMAT,
  LOGO_GENERATION_SIZE,
  LOGO_GENERATION_STYLE,
  LOGO_GENERATION_SUBSTYLE,
  logoShadeColorControl,
  logoShadeInWords,
} from "./request.ts";

// The contract this file guards is `docs/adr/0007-capability-logo-contract.md` plus the
// art contract it points at, `design/logo.html`. Both fix exact strings, so these tests
// pin literals rather than comparing the module against itself.

/** A shade of some other family — every request must carry two colours that differ. */
function other(shade: LogoShade): LogoShade {
  return logoShadeFamily(shade) === "coral_orange" ? "grass" : "coral";
}

const INPUTS = {
  subject: "an open notebook",
  ground: "cyan",
  companion: "mustard",
  seed: 1436601874,
} as const;

describe("the fields no caller may vary", () => {
  test("model, style, substyle, size and response format are the contract's literals", () => {
    expect(LOGO_GENERATION_MODEL).toBe("recraftv3_vector");
    expect(LOGO_GENERATION_STYLE).toBe("vector_illustration");
    expect(LOGO_GENERATION_SUBSTYLE).toBe("bold_stroke");
    expect(LOGO_GENERATION_SIZE).toBe("1024x1024");
    expect(LOGO_GENERATION_RESPONSE_FORMAT).toBe("b64_json");
  });

  test("every request carries them, whatever the capability", () => {
    for (const ground of LOGO_SHADES) {
      const request = buildLogoGenerationRequest({
        subject: "a kettle",
        ground,
        companion: other(ground),
        seed: 7,
      });
      expect(request.model).toBe("recraftv3_vector");
      expect(request.style).toBe("vector_illustration");
      expect(request.substyle).toBe("bold_stroke");
      expect(request.size).toBe("1024x1024");
      expect(request.response_format).toBe("b64_json");
      expect(request.controls.no_text).toBe(true);
    }
  });

  // The strongest form of "no caller may vary them" is that there is nowhere to put an
  // override — no second parameter, and no knob folded into the request the builder
  // returns. Both halves are checked, because an added field is the likelier of the two.
  test("the builder takes one input and the request carries no knob", () => {
    expect(buildLogoGenerationRequest.length).toBe(1);

    const request = buildLogoGenerationRequest(INPUTS);
    expect(Object.keys(request).sort()).toEqual([
      "controls",
      "model",
      "prompt",
      "random_seed",
      "response_format",
      "size",
      "style",
      "substyle",
    ]);
    expect(Object.keys(request.controls).sort()).toEqual(["background_color", "colors", "no_text"]);
  });

  // Only four values may differ between two capabilities' requests. Everything else must
  // be identical whatever is asked for.
  test("two capabilities differ in exactly the four values the contract allows", () => {
    const notes = buildLogoGenerationRequest(INPUTS);
    const recipes = buildLogoGenerationRequest({
      subject: "a stack of recipe cards",
      ground: "mustard",
      companion: "coral",
      seed: 42,
    });

    const moved = Object.keys(notes).filter(
      (key) =>
        JSON.stringify(notes[key as keyof typeof notes]) !==
        JSON.stringify(recipes[key as keyof typeof recipes]),
    );
    expect(moved.sort()).toEqual(["controls", "prompt", "random_seed"]);
    expect(notes.controls.no_text).toBe(recipes.controls.no_text);
  });
});

describe("the two colours", () => {
  test("are exactly two, both authored, the ground first", () => {
    const request = buildLogoGenerationRequest(INPUTS);

    expect(request.controls.colors).toHaveLength(2);
    expect(request.controls.colors[0]).toEqual(logoShadeColorControl("cyan"));
    expect(request.controls.colors[1]).toEqual(logoShadeColorControl("mustard"));
  });

  // The ordering is the one presentation choice the contract fixes, and it is fixed in
  // one place. Swapping the two authored colours swaps the drawing, so a call site that
  // could re-decide which is the background would be steering presentation.
  test("swapping the two authored colours swaps the request, and nothing else moves", () => {
    const forward = buildLogoGenerationRequest(INPUTS);
    const reversed = buildLogoGenerationRequest({
      ...INPUTS,
      ground: INPUTS.companion,
      companion: INPUTS.ground,
    });

    expect(reversed.controls.colors[0]).toEqual(forward.controls.colors[1]);
    expect(reversed.controls.colors[1]).toEqual(forward.controls.colors[0]);
    expect(reversed.controls.background_color).toEqual(forward.controls.colors[1]);
    expect(reversed.random_seed).toBe(forward.random_seed);
  });

  // Four closed pairs capped the whole product at four looks. Eight freely-paired anchors
  // lifted the cap to 56 and the model still collapsed to one of them; eight families of
  // four shades, paired across families, is 896 — and unlike the 56, which colour comes
  // up is not the model's to collapse.
  test("every ordered pair of shades from two different families is reachable", () => {
    const pairs = new Set<string>();
    for (const ground of LOGO_SHADES) {
      for (const companion of LOGO_SHADES) {
        if (logoShadeFamily(ground) === logoShadeFamily(companion)) continue;
        const request = buildLogoGenerationRequest({
          subject: "a kettle",
          ground,
          companion,
          seed: 7,
        });
        pairs.add(JSON.stringify(request.controls.colors));
      }
    }

    const rungs = LOGO_FAMILY_SHADES.grass_green.length;
    expect(pairs.size).toBe(LOGO_SHADES.length * (LOGO_SHADES.length - rungs));
    expect(pairs.size).toBe(896);
  });

  test("the background is pinned to the first of the two, never the companion", () => {
    for (const ground of LOGO_SHADES) {
      const request = buildLogoGenerationRequest({
        subject: "a kettle",
        ground,
        companion: other(ground),
        seed: 7,
      });
      expect(request.controls.background_color).toEqual(request.controls.colors[0]);
      expect(request.controls.background_color).toEqual(logoShadeColorControl(ground));
    }
  });

  test("a colour is an RGB triple in 0–255", () => {
    for (const ground of LOGO_SHADES) {
      const { rgb } = logoShadeColorControl(ground);
      expect(rgb).toHaveLength(3);
      for (const channel of rgb) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  // The eight anchors this ladder replaced were palette tokens, and were cross-checked
  // against `design/styles/tokens.css`. The thirty-two shades are not tokens and never
  // reach a stylesheet — `ground` and `companion` style nothing, they only address a
  // colour in the request — so what is pinned instead is the property the token list was
  // standing in for, measured directly. This is a test over the platform's own literal
  // table, not the runtime chroma-and-lightness validator ADR-0007 deleted: no model
  // output is measured anywhere, and a spec still validates against a word list.
  test("every shade is a daylight colour at high chroma — no near-blacks, no greys", () => {
    for (const shade of LOGO_SHADES) {
      const [red, green, blue] = logoShadeColorControl(shade).rgb.map((c) => c / 255) as [
        number,
        number,
        number,
      ];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const lightness = (high + low) / 2;
      const saturation = high === low ? 0 : (high - low) / (1 - Math.abs(2 * lightness - 1));

      expect(lightness, `${shade} is outside the daylight band`).toBeGreaterThanOrEqual(0.3);
      expect(lightness, `${shade} is outside the daylight band`).toBeLessThanOrEqual(0.72);
      expect(saturation, `${shade} is greyed`).toBeGreaterThanOrEqual(0.3);
    }
  });

  // The eight old anchors are still in the ladder at their exact former bytes: this
  // widened the vocabulary rather than restating it, so nothing the desk already wore
  // became unreachable.
  test("the eight former anchors survive at their exact values", () => {
    const anchors: Record<string, string> = {
      grass: "#3fa65b",
      forest: "#2a7a45",
      teal: "#3e9e92",
      cyan: "#7fd2e0",
      golden: "#f2b32c",
      mustard: "#c9902f",
      coral: "#e8763c",
      amethyst: "#9a86c4",
    };
    for (const [shade, hex] of Object.entries(anchors)) {
      const rendered = logoShadeColorControl(shade as LogoShade)
        .rgb.map((channel) => channel.toString(16).padStart(2, "0"))
        .join("");
      expect(`#${rendered}`).toBe(hex);
    }
  });

  test("every family opens onto the same number of shades, and no shade has two parents", () => {
    const rungs = new Set(Object.values(LOGO_FAMILY_SHADES).map((shades) => shades.length));
    expect(rungs).toEqual(new Set([4]));
    expect(new Set(LOGO_SHADES).size).toBe(LOGO_SHADES.length);
  });
});

describe("the seed", () => {
  test("is the stored one, passed through untouched", () => {
    expect(buildLogoGenerationRequest(INPUTS).random_seed).toBe(1436601874);
    expect(buildLogoGenerationRequest({ ...INPUTS, seed: 1 }).random_seed).toBe(1);
  });
});

describe("the prompt block", () => {
  test("wraps the injected subject rather than trailing it", () => {
    const prompt = buildLogoPrompt("an open notebook", "cyan", "mustard");
    expect(prompt.startsWith("A flat colour square of an open notebook, drawn in ")).toBe(true);
    // The wrapping is the whole defence against the model lettering the description into
    // the drawing, so the phrase must never be the last thing the model reads.
    expect(prompt.endsWith("an open notebook")).toBe(false);
    expect(prompt.trimEnd().endsWith("clearly readable against its background.")).toBe(true);
  });

  test("names the ground in words as well as in the control", () => {
    const request = buildLogoGenerationRequest(INPUTS);
    expect(request.prompt).toContain(logoShadeInWords("cyan"));
    expect(request.controls.background_color).toEqual(logoShadeColorControl("cyan"));
  });

  test("the words lookup is total over the ladder and gives each shade its own phrase", () => {
    const phrases = LOGO_SHADES.map((ground) => logoShadeInWords(ground));
    for (const phrase of phrases) {
      // Temperature or character, then hue: the shape the one contract-fixed phrase has.
      expect(phrase).toMatch(/^a flat [a-z]+ [a-z-]+( [a-z]+)?$/);
    }
    expect(new Set(phrases).size).toBe(LOGO_SHADES.length);
  });

  // The block's closing sentence asks for daylight colours at high chroma and bans
  // near-blacks, dark backgrounds, pastels and greys. A ground phrase reading "pale sky
  // blue" or "deep forest green" argues with a sentence three lines below it, and this
  // model follows the words rather than reconciling them.
  test("no phrase contradicts the block it is written into", () => {
    const contradictions =
      /\b(pale|pastel|muted|soft|dark|deep|dull|faded|washed|light|burnt|grey|gray|black)\b/;
    for (const ground of LOGO_SHADES) {
      const phrase = logoShadeInWords(ground);
      expect(phrase, `"${phrase}" argues with the block's own bans`).not.toMatch(contradictions);
    }
  });

  // Rule 4: spatial words do not stay in the style wording. A colour named after a
  // material or a plant is a colour name; one named after a place is an invitation to
  // draw the place, three lines above "no horizon, no ground line, no perspective".
  test("no phrase names a scene the block forbids", () => {
    // The block's own list, verbatim, plus the words that would read as one of them. A
    // colour name drawn from a plant or a material is not a place and stays.
    const scenery = /\b(sky|horizon|ground|floor|wall|sea|ocean|sunset|sunrise|landscape)\b/;
    for (const ground of LOGO_SHADES) {
      const phrase = logoShadeInWords(ground);
      expect(phrase, `"${phrase}" names a place the block bans`).not.toMatch(scenery);
    }
  });

  // `design/logo.html` shows the block with its second slot filled as this exact phrase.
  test("golden is the phrase the contract page records", () => {
    expect(logoShadeInWords("golden")).toBe("a flat warm golden yellow");
  });

  // "names both colours and no others" can only mean anything if no phrase hides inside
  // another one; without this, a shade whose phrase were a substring of the ground's
  // would be counted as named and the containment test would pass by accident.
  test("no shade's phrase is a substring of another's", () => {
    for (const shade of LOGO_SHADES) {
      for (const otherShade of LOGO_SHADES) {
        if (shade === otherShade) continue;
        expect(
          logoShadeInWords(otherShade).includes(logoShadeInWords(shade)),
          `"${logoShadeInWords(shade)}" hides inside "${logoShadeInWords(otherShade)}"`,
        ).toBe(false);
      }
    }
  });

  test("forbids lettering in words, because the control is recorded as insufficient", () => {
    const prompt = buildLogoPrompt("a telescope", "cyan", "mustard");
    for (const ban of ["no text", "no letters", "no numerals", "no labels", "no engraving"]) {
      expect(prompt).toContain(ban);
    }
  });

  // Rule 3 is "offer one colour, never a palette" — a palette being the eight anchors,
  // which made the model reach for green or block the ground into quadrants. Two colours
  // with distinct jobs is not a palette: it is exactly what `controls.colors` carries.
  test("names both colours in words and no others", () => {
    const prompt = buildLogoPrompt("a telescope", "cyan", "mustard");
    const named = LOGO_SHADES.filter((shade) => prompt.includes(logoShadeInWords(shade)));

    expect([...named].sort()).toEqual(["cyan", "mustard"] as LogoShade[]);
  });

  // L2 says the control alone is ignored, so an authored companion that reached the
  // service only as `controls.colors[1]` would be a stored fact with nothing visible
  // behind it — which would make authoring it pointless.
  test("the companion is named in the prompt as well as in the control", () => {
    const request = buildLogoGenerationRequest(INPUTS);

    expect(request.prompt).toContain(logoShadeInWords(INPUTS.companion));
    expect(request.controls.colors[1]).toEqual(logoShadeColorControl(INPUTS.companion));
    // And each is named for its job: the companion is what the object is drawn in, the
    // ground is the field it stands on.
    expect(request.prompt).toContain(`drawn in ${logoShadeInWords(INPUTS.companion)}`);
    expect(request.prompt).toContain(`on ${logoShadeInWords(INPUTS.ground)} background`);
  });
});

// The contract *is* `design/logo.html` (the ADR points at it and holds nothing of its
// own about the wording). So the block is not pinned as a literal here — it is compared
// against the page, word for word, with the page's two `<mark>` slots filled. Editing
// the block therefore means editing the contract, which is exactly the freedom the issue
// grants; editing only the code is what this fails on.
describe("the block matches the contract page it comes from", () => {
  test("word for word, with all three slots filled", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../design/logo.html"), "utf8");
    const block = page.match(/<div class="prompt-block">\s*<p>([\s\S]*?)<\/p>/)?.[1];
    expect(block, "design/logo.html has no prompt block").toBeDefined();

    const authored = (block ?? "")
      // The page marks its three slots; filling them is what makes the two comparable.
      .replace(/<mark>&lt;subject&gt;<\/mark>/, "an open notebook")
      .replace(/<mark>&lt;a flat cool amethyst violet&gt;<\/mark>/, logoShadeInWords("amethyst"))
      .replace(/<mark>&lt;a flat warm golden yellow&gt;<\/mark>/, logoShadeInWords("golden"))
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

    expect(
      buildLogoPrompt("an open notebook", "golden", "amethyst").replace(/\s+/g, " ").trim(),
    ).toBe(authored);
  });
});
