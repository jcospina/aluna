// The re-derived design-lint rung: three closed axes picked from the High Meadow sets, and
// three properties never declared at all (Module 5, epic 5.1/02; ADR-0005 §4 as amended
// 2026-08-20; `modules/05-the-desk/PLAN.md` decision 10).
//
// These are the cases the token-layer cutover turned over. The rest of the rung's surface
// — escaping, fabricated classes, interactive descendants, the fix loop — is unchanged and
// lives in gate-design-lint.test.ts.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is authored as string data; the `${...}` placeholders are TypeScript for the generated item.ts, not this file's template literals.

import { describe, expect, test } from "bun:test";

import {
  createPlatformPresentationAdapter,
  enforceItemMarkup,
  PALETTE_COLOR_TOKENS,
  renderCollection,
} from "../../../../presentation/index.ts";
import {
  buildItemRendererDesignInjection,
  FEW_SHOT_DESIGN_EXAMPLES,
  type FewShotDesignExample,
} from "../../../units/generation/few-shot-gallery.ts";
import { itemRendererReturning as renderer } from "../../../units/generation/unit-fixtures.test-support.ts";
import { notesSpec } from "../../gate.test-support.ts";
import { findDesignViolation } from "./gate-design-lint.ts";
import { findInlineStyleViolation } from "./inline-style-scan.ts";

const spec = notesSpec();

describe("design-lint — the three closed axes, re-derived", () => {
  test("rejects a raw value on each of the three closed axes, naming the High Meadow set", () => {
    const colour = findDesignViolation(spec, renderer('`<div style="color: red;">${text}</div>`'));
    expect(colour).toContain("Design contract violation");
    expect(colour).toContain("colour is picked from the High Meadow set");
    expect(colour).toContain("var(--ink)");
    expect(colour).toContain("var(--signal)");

    const size = findDesignViolation(
      spec,
      renderer('`<div style="font-size: 19px;">${text}</div>`'),
    );
    expect(size).toContain("type size is picked from the High Meadow set");
    expect(size).toContain("var(--type-xs)");
    expect(size).toContain("var(--type-display)");

    const spacing = findDesignViolation(
      spec,
      renderer('`<div style="padding: 11px;">${text}</div>`'),
    );
    expect(spacing).toContain("spacing is picked from the High Meadow set");
    expect(spacing).toContain("var(--space-1)");
    expect(spacing).toContain("var(--space-8)");
  });

  test("rejects the retired Paper & Ink vocabulary the token layer deleted", () => {
    // `var(--color-*)`, `var(--border-*)` and `var(--radius-*)` resolve to nothing at all
    // under High Meadow. A renderer still speaking them is off-token, not merely off-key.
    const retiredColour = findDesignViolation(
      spec,
      renderer('`<div style="color: var(--color-text);">${text}</div>`'),
    );
    expect(retiredColour).toContain("Design contract violation");
    expect(retiredColour).toContain("colour is picked from the High Meadow set");

    const retiredWeight = findDesignViolation(
      spec,
      renderer(
        '`<div style="border: var(--border-regular) solid var(--color-border);">${text}</div>`',
      ),
    );
    expect(retiredWeight).toContain("Design contract violation");
  });

  test("accepts every High Meadow token on each closed axis", () => {
    // The whole re-derived vocabulary rather than a sample, including the tokens that were
    // renamed out of `--color-*`. Read off the axis itself, so an added token is asked about.
    for (const colour of PALETTE_COLOR_TOKENS) {
      const clean = renderer(
        `\`<div class="stack" style="color: var(--${colour});">\${text}</div>\``,
      );
      expect(findDesignViolation(spec, clean), `var(--${colour}) must be on-token`).toBeUndefined();
    }
    for (const size of ["xs", "sm", "base", "md", "lg", "xl", "title", "display"]) {
      const clean = renderer(
        `\`<div class="stack" style="font-size: var(--type-${size});">\${text}</div>\``,
      );
      expect(
        findDesignViolation(spec, clean),
        `var(--type-${size}) must be on-token`,
      ).toBeUndefined();
    }
    for (let step = 1; step <= 8; step += 1) {
      const clean = renderer(
        `\`<div class="stack" style="padding: var(--space-${step});">\${text}</div>\``,
      );
      expect(
        findDesignViolation(spec, clean),
        `var(--space-${step}) must be on-token`,
      ).toBeUndefined();
    }
  });
});

describe("design-lint — the three never-declared properties", () => {
  test("does not mistake an escaped payload that reads like a style attribute for one", () => {
    // The hostile probes carry `<b style="color: #ff0000">`, which a correct renderer escapes
    // to inert text. The scan parses the record rather than pattern-matching those characters.
    const escaping = renderer('`<div class="stack">${text}</div>`');
    expect(findDesignViolation(spec, escaping)).toBeUndefined();
  });

  test("reads every style attribute, not just the first of a repeated one", () => {
    // Browsers keep the first duplicate and the enforcer keeps the last, so a scan that
    // read only one of them would let the other carry an off-token value into a build.
    const duplicated = renderer(
      '`<div class="stack" style="color: var(--ink)" style="color: rebeccapurple">${text}</div>`',
    );
    expect(findDesignViolation(spec, duplicated)).toContain("Design contract violation");
  });

  test("still catches a style attribute the renderer really emitted", () => {
    const literal = renderer('`<div class="stack" style="color: #ff0000;">${text}</div>`');
    expect(findDesignViolation(spec, literal)).toContain("Design contract violation");
  });

  test("rejects a declaration of font family, a boundary, border-radius or box-shadow", () => {
    const family = findDesignViolation(
      spec,
      renderer('`<div style="font-family: var(--font-body);">${text}</div>`'),
    );
    expect(family).toContain("font family is never declared");

    // The fourth ban. The record's boundary is drawn on the platform's own wrapper, so a CSS
    // edge inside it would sit beside a drawn one.
    for (const declaration of [
      "border: var(--line) solid var(--ink)",
      "border: 1px solid red",
      "border-bottom-width: var(--line)",
      "outline: var(--line) solid var(--ink)",
    ]) {
      expect(
        findDesignViolation(spec, renderer(`\`<div style="${declaration};">\${text}</div>\``)),
        declaration,
      ).toContain("the ink system owns every boundary");
    }

    const radius = findDesignViolation(
      spec,
      renderer('`<div style="border-radius: 8px;">${text}</div>`'),
    );
    expect(radius).toContain("High Meadow has no radius tokens");

    // Even a zero: a square corner is the absence of a declaration, not a value.
    expect(
      findDesignViolation(spec, renderer('`<div style="border-radius: 0;">${text}</div>`')),
    ).toContain("absence of a declaration");
  });

  test("rejects the silently-invalid `box-shadow: var(--shadow-*)`", () => {
    // The shadow tokens are bare `<x> <y> <alpha>` triples, so this paints and reports
    // nothing. The enforcer leaves the declaration alone, so only the ban catches it.
    const shadow = findDesignViolation(
      spec,
      renderer('`<div style="box-shadow: var(--shadow-md);">${text}</div>`'),
    );
    expect(shadow).toContain("Design contract violation");
    expect(shadow).toContain("a shadow is never declared");
    expect(shadow).toContain("fails silently");

    expect(
      findDesignViolation(
        spec,
        renderer('`<div style="box-shadow: 0 2px 6px var(--ink);">${text}</div>`'),
      ),
    ).toContain("a shadow is never declared");

    // The ban is written around the effect, so the other ways to cast one go with it.
    expect(
      findDesignViolation(
        spec,
        renderer('`<div style="text-shadow: 0 2px 4px var(--ink);">${text}</div>`'),
      ),
    ).toContain("a shadow is never declared");
    expect(
      findDesignViolation(
        spec,
        renderer('`<div style="filter: drop-shadow(0 4px 8px var(--ink));">${text}</div>`'),
      ),
    ).toContain("forbidden construct");
  });

  test("holds the decoration shorthands to their own axis rather than to the residual", () => {
    // `text-decoration` and `text-emphasis` mix a line, colour and thickness in one value. The
    // named colour paints in every engine and the thickness slips the longhand's ban.
    for (const bad of [
      "text-decoration: underline thistle",
      "text-decoration: underline 3px",
      "text-emphasis: filled circle purple",
    ]) {
      expect(
        findDesignViolation(spec, renderer(`\`<div style="${bad};">\${text}</div>\``)),
        bad,
      ).toContain("a decoration shorthand carries a line, a colour and a thickness");
    }

    // The line and the style still read the way an author writes them.
    expect(
      findDesignViolation(
        spec,
        renderer('`<div style="text-decoration: underline wavy;">${text}</div>`'),
      ),
    ).toBeUndefined();
  });

  test("catches `caret: red` on the colour axis rather than as a residual", () => {
    // `caret` takes a colour without saying so in its name, where the `-color` suffix already
    // carried `caret-color`. On the axis, the refusal names the palette rather than the colour.
    const bad = renderer('`<div style="caret: red;">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain(
      "colour is picked from the High Meadow set and never written as a value",
    );
  });

  test("catches `background: white` on the colour axis rather than as a residual", () => {
    // The surface fill is a colour, so the shorthand sits on the axis and the refusal names
    // the palette instead of reporting a stray word.
    const bad = renderer('`<div style="background: white;">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain("colour is picked from the High Meadow set");
  });
});

describe("the few-shot exemplars the generator is shown", () => {
  // What the deleted `/demo/few-shot-gallery` preview did, minus the page. The exemplars
  // declare create + read only, so no record opens here and nothing falls back to a read view.
  function renderedExample(example: FewShotDesignExample): string {
    const capability = { ...example.capability, actions: ["create", "read"] as const };
    let sampleIndex = 0;
    const present = createPlatformPresentationAdapter({
      capability,
      renderItem: () => {
        const inner = example.previewSamples[sampleIndex]?.previewInnerHtml;
        if (inner === undefined) throw new Error(`Missing sample ${sampleIndex} for ${example.id}`);
        sampleIndex += 1;
        return inner;
      },
    });

    return renderCollection({
      capability,
      layout: example.layout,
      items: example.previewSamples.map((sample) => present(sample.record)).join(""),
    });
  }

  test("every exemplar's rendered record clears the re-derived rung", () => {
    // The gallery is what the model varies from. An exemplar the rung would refuse teaches
    // the failure it then has to be fixed out of, so the two are pinned together here.
    for (const example of FEW_SHOT_DESIGN_EXAMPLES) {
      for (const sample of example.previewSamples) {
        const inner = sample.previewInnerHtml;
        expect(findInlineStyleViolation(inner), `${example.id} inline style`).toBeUndefined();
        expect(enforceItemMarkup(inner), `${example.id} survives the enforcer`).toBe(inner);
      }
    }
  });

  test("the injected contract names the three sets and the four bans", () => {
    const injection = buildItemRendererDesignInjection("feed");

    expect(injection).toContain("Three axes are closed");
    expect(injection).toContain("var(--ink)");
    expect(injection).toContain("var(--signal)");
    expect(injection).toContain("var(--type-xs)");
    expect(injection).toContain("var(--space-8)");
    expect(injection).not.toContain("one weight");

    // On-token is not the same as on-key. Two palette colours carry a meaning the gate
    // cannot check, so the prompt is where it is stated.
    expect(injection).toContain("`--ink` draws lines and sets type and is never a background");
    expect(injection).toContain("`--signal` is reserved for alerts and destructive confirmation");

    expect(injection).toContain("Four properties are never declared at all");
    expect(injection).toContain("`font-family`");
    expect(injection).toContain("`border`");
    expect(injection).toContain("`border-radius`");
    expect(injection).toContain("`box-shadow`");
    expect(injection).toContain("The shadow rule is about the effect, not the property");
    expect(injection).toContain("The platform owns where a record sits");

    // The retired vocabulary is not offered anywhere in the prompt.
    expect(injection).not.toContain("var(--color-");
    expect(injection).not.toContain("var(--border-");
    expect(injection).not.toContain("var(--radius-");
  });

  // Re-homed from the deleted `/demo/few-shot-gallery` preview, the only place these two read.
  // They stop the exemplars reading as a template: framing asks for variation, not a copy.
  test("the exemplars arrive framed as variation, under the layout that was chosen", () => {
    for (const layout of ["feed", "grid"] as const) {
      const injection = buildItemRendererDesignInjection(layout);

      expect(injection).toContain("Few-shot gallery. Vary, don't copy");
      expect(injection).toContain(`Chosen collection layout for this capability: "${layout}"`);
    }

    // Every exemplar's renderer source travels whole, whichever layout was chosen — a
    // grid exemplar's column template reaches the generator even on a feed.
    expect(buildItemRendererDesignInjection("feed")).toContain('style="grid-template-columns');
  });

  // Re-homed from the deleted preview, the only thing composing exemplars through the real
  // presentation path. Nothing else reads a sample's `record` or its `previewInnerHtml`.
  test("every exemplar composes through the real adapter and container", () => {
    const rendered = FEW_SHOT_DESIGN_EXAMPLES.map(renderedExample);
    const all = rendered.join("");

    expect(rendered).toHaveLength(3);
    expect(all.match(/class="capability-item"/g)).toHaveLength(6);
    expect(all).toContain('class="capability-records capability-records--feed"');
    expect(all).toContain('class="capability-records capability-records--grid"');

    // Create + read only: a frame with nothing behind it is a card, so no record surface
    // is emitted and no swap is armed that the exemplar could not serve.
    expect(all).not.toContain("data-record-view-template=");
    expect(all).not.toContain("<dialog");
  });
});
