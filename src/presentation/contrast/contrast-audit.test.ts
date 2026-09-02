import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  alphaStatedIn,
  type Colour,
  type Declaration,
  declarations,
  paletteTokens,
  siteKey,
  statesNoColour,
  styleSource,
  tokensNamedIn,
  worstContrast,
} from "./contrast.js";
import {
  AUDITED_PROPERTIES,
  AUDITED_SHEETS,
  MINIMUM,
  PAIRINGS,
  type Pairing,
} from "./contrast-audit.js";

const ROOT = resolve(import.meta.dir, "../../..");
const palette = paletteTokens();

function ratioOf({ foreground, background }: Pairing): number {
  return worstContrast(foreground, background, palette);
}

/**
 * Every declaration that puts a colour in front of a reader, or changes what one is
 * read against. That is `color`, `outline` and `opacity` everywhere, plus any fill
 * that is *derived* rather than named — a `color-mix()` is a colour that exists
 * nowhere else in the palette, so nothing else would ever measure it.
 *
 * Plain `background: var(--token)` is deliberately not a site. It is covered by the
 * token check below instead: a fill nothing is ever read against is not a pairing,
 * and enumerating all ninety of them would pad the inventory without measuring
 * anything. What that boundary cannot catch is a *new combination* of two tokens
 * already in the inventory — say `--ink-3` moved onto the desk — because which fill
 * a rule lands on is a fact about the DOM, not about the stylesheet.
 */
function declaredSites(): ReadonlySet<string> {
  const foregrounds = AUDITED_SHEETS.flatMap((sheet) =>
    declarations(sheet, AUDITED_PROPERTIES),
  ).filter((rule) => !statesNoColour(rule));
  const derivedFills = AUDITED_SHEETS.flatMap((sheet) =>
    declarations(sheet, ["background", "background-color"]),
  ).filter(({ value }) => value.includes("color-mix("));
  return new Set([...foregrounds, ...derivedFills].map(siteKey));
}

/** Every palette token a shipped stylesheet names, in the role it names it for. */
function tokensNamedFor(properties: readonly string[]): ReadonlySet<string> {
  const named = new Set<string>();
  for (const sheet of AUDITED_SHEETS) {
    for (const { value } of declarations(sheet, properties)) {
      for (const [, token] of value.matchAll(/var\(--([a-z0-9-]+)\)/g)) named.add(token as string);
    }
  }
  return named;
}

/**
 * The palette tokens the stylesheets actually fill with, following one relay: a
 * button names `--btn-fill`, and what that resolves to is set by the variant.
 */
function fillTokens(): ReadonlySet<string> {
  const fills = new Set<string>();
  for (const named of tokensNamedFor(["background", "background-color"])) {
    if (palette.has(named)) {
      fills.add(named);
      continue;
    }
    for (const relayed of tokensNamedFor([`--${named}`])) fills.add(relayed);
  }
  return fills;
}

/** The single token a colour names, where it names one. */
function named(colour: Colour): string | undefined {
  return "token" in colour ? colour.token : undefined;
}

function tokensIn(colour: Colour): readonly string[] {
  if ("mix" in colour) return colour.mix;
  return "over" in colour ? [colour.token, ...tokensIn(colour.over)] : [colour.token];
}

/** Every stylesheet the two manifests pull in, read out of the manifests themselves. */
function importedSheets(): string[] {
  const manifest = (entry: string, directory: string) =>
    [...readFileSync(join(ROOT, entry), "utf8").matchAll(/@import\s+(?:url\()?["']([^"')]+)["']/g)]
      .map(([, href]) => (href as string).replace(/^\.\//, ""))
      .filter((href) => !href.startsWith("/"))
      .map((href) => `${directory}/${href}`);
  return [
    "design/styles/index.css",
    ...manifest("design/styles/index.css", "design/styles"),
    "public/app.css",
    ...manifest("public/app.css", "public").map((href) =>
      href.replace("public/css/", "public/css/"),
    ),
  ];
}

/**
 * Whether a source carries style the audit would have to read.
 *
 * Asked of the audit's own reader rather than of a substring, which is the whole point:
 * this check used to look for a literal `<style` and so agreed with the parser only by
 * coincidence. A file painting entirely through inline `style` attributes — the few-shot
 * gallery — was invisible to both, and a live AA failure sat in it while being taught to
 * the model as an approved exemplar. Now a file the parser can read is a file this
 * requires to be audited, by construction.
 */
function carriesAStylesheet(path: string, name: string): boolean {
  if (!/\.(?:html|ts)$/.test(name) || name.endsWith(".test.ts")) return false;
  return styleSource(path).trim().length > 0;
}

/** Every source that carries its stylesheet inline instead of linking one. */
function embeddedSheets(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "vendor" ? [] : embeddedSheets(path);
    return carriesAStylesheet(path, entry.name) ? [path] : [];
  });
}

/** Every `.css` file sitting beside the ones the manifests name. */
function sheetsOnDisk(): string[] {
  return ["design/styles", "design/styles/components", "public/css"].flatMap((directory) =>
    readdirSync(join(ROOT, directory))
      .filter((name) => name.endsWith(".css") && name !== "index.css")
      .map((name) => `${directory}/${name}`),
  );
}

/**
 * Every declaration a pairing claims, paired with the rows claiming it. An `exempt`
 * row measures nothing, so there is no colour to bind it to — the token check still
 * requires whatever it paints to be in the palette.
 */
function boundSites(): [Declaration, Pairing[]][] {
  const claimed = new Map<string, Pairing[]>();
  for (const pairing of PAIRINGS) {
    for (const site of pairing.sites) {
      claimed.set(site, [...(claimed.get(site) ?? []), pairing]);
    }
  }
  return AUDITED_SHEETS.flatMap((sheet) => declarations(sheet, AUDITED_PROPERTIES)).flatMap(
    (rule) => {
      const rows = claimed.get(siteKey(rule));
      if (!rows || statesNoColour(rule) || rows.every((row) => row.threshold === "exempt")) {
        return [];
      }
      return [[rule, rows] as [Declaration, Pairing[]]];
    },
  );
}

/** Every fill some row is measured against, the ones a row stands in for included. */
function measuredBackgrounds(): ReadonlySet<string> {
  return new Set(
    PAIRINGS.flatMap((pairing) => [
      ...tokensIn(pairing.background),
      ...(pairing.alsoCovers ?? []).flatMap(tokensIn),
    ]),
  );
}

describe("the contrast audit", () => {
  test("audits every stylesheet the product actually loads", () => {
    // The list is written out because it is also documentation, but nothing may be
    // missing from it: a sheet the manifests import, a file that appears beside the
    // ones they import, or a page that carries its own `<style>`, all have to be here.
    const audited = new Set(AUDITED_SHEETS);
    const manifests = new Set(["design/styles/index.css", "public/app.css"]);
    const required = [
      ...importedSheets().filter((sheet) => !manifests.has(sheet)),
      ...sheetsOnDisk(),
      ...["public", "src/app", "src/builder/units"].flatMap(embeddedSheets),
    ];
    for (const sheet of required) {
      expect(audited, `${sheet} styles a shipped surface and nothing audits it`).toContain(sheet);
    }
  });

  test("every declared pairing clears the threshold that applies to it", () => {
    for (const pairing of PAIRINGS) {
      const ratio = ratioOf(pairing);
      expect(
        ratio,
        `${pairing.what} is ${ratio.toFixed(2)}:1, under the ${pairing.threshold} threshold`,
      ).toBeGreaterThanOrEqual(MINIMUM[pairing.threshold]);
    }
  });

  test("C12 still holds, and it is measured rather than remembered", () => {
    // The one failure the design found before this audit existed. Both halves of the
    // swap are read out of the token layer, so a change to either green re-measures.
    const primary = PAIRINGS.find((p) => named(p.background) === "shade");
    const secondary = PAIRINGS.find((p) => p.what === "ink on leaf");
    expect(primary).toBeDefined();
    expect(secondary).toBeDefined();
    expect(ratioOf(primary as Pairing)).toBeCloseTo(5.18, 1);
    expect(ratioOf(secondary as Pairing)).toBeCloseTo(4.54, 1);
    // And the light-label-on-leaf pairing C12 removed is nowhere on the surface.
    for (const pairing of PAIRINGS) {
      const light = named(pairing.foreground) === "surface" && named(pairing.background) === "leaf";
      expect(
        !light || pairing.threshold === "non-text",
        `${pairing.what} puts a light label back on leaf`,
      ).toBe(true);
    }
  });
});

/*
 * The second half of the audit: not whether the pairings pass, but whether they are
 * all of them. A number that is true of a colour nothing paints any more is worse
 * than no number, so every one of these asks the stylesheets rather than the table.
 */
describe("the audit's reach", () => {
  test("the inventory is exhaustive: every declaration is claimed by a pairing", () => {
    const claimed = new Set(PAIRINGS.flatMap((pairing) => pairing.sites));
    const declared = declaredSites();

    const unclassified = [...declared].filter((site) => !claimed.has(site)).sort();
    expect(
      unclassified,
      "a colour, outline or opacity the audit has never measured — classify it in PAIRINGS",
    ).toEqual([]);

    const stale = [...claimed].filter((site) => !declared.has(site)).sort();
    expect(stale, "a pairing claims a declaration that no longer exists").toEqual([]);
  });

  test("the inventory is exhaustive against the tokens the stylesheets reach for", () => {
    // The site check catches a new declaration. This catches a new *use* of the palette:
    // a fill nothing has ever been read against, or a type colour that is not in a pair.
    const foregrounds = new Set(PAIRINGS.flatMap((p) => tokensIn(p.foreground)));
    const backgrounds = measuredBackgrounds();

    for (const token of tokensNamedFor(["color"])) {
      expect(foregrounds.has(token), `--${token} is set as type but sits in no measured pair`).toBe(
        true,
      );
    }
    for (const token of fillTokens()) {
      if (token === "title-bar") continue; // the gradient; its five panes are measured
      expect(
        backgrounds.has(token),
        `--${token} is used as a fill but nothing has been measured against it`,
      ).toBe(true);
    }
  });

  test("a row standing in for a lighter fill is the darkest of the set it covers", () => {
    // `alsoCovers` is a claim about the palette, not a way past the audit: the row is
    // measured against the fill it names, so that fill has to be the tightest one.
    for (const pairing of PAIRINGS) {
      const measured = ratioOf(pairing);
      for (const covers of pairing.alsoCovers ?? []) {
        const covered = worstContrast(pairing.foreground, covers, palette);
        expect(
          covered,
          `${pairing.what} covers a fill that reads worse, at ${covered.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(measured);
      }
    }
  });

  test("a pairing names the colour the declaration it claims actually paints", () => {
    // Without this the inventory pins selectors rather than colours: recolour a claimed
    // declaration and the site is still claimed, still measured, and now measuring a
    // colour the page does not paint.
    for (const [rule, rows] of boundSites()) {
      const named = new Set(
        rows.flatMap((row) => [...tokensIn(row.foreground), ...tokensIn(row.background)]),
      );
      for (const token of tokensNamedIn(rule.value, palette)) {
        expect(
          named,
          `${siteKey(rule)} paints --${token}, which no pairing claiming it measures`,
        ).toContain(token);
      }
    }
  });

  test("a pairing measures the strength a declaration dims to", () => {
    // `opacity` names no colour, so the binding above cannot see it — and the failure
    // this catches is exactly that shape: a link at 3.67 whose declared ink was 8.13.
    for (const [rule, rows] of boundSites()) {
      const alpha = rule.property === "opacity" ? alphaStatedIn(rule.value) : undefined;
      if (alpha === undefined) continue;
      const dims = rows.some((row) =>
        [row.foreground, row.background].some(
          (colour) => "alpha" in colour && colour.alpha === alpha,
        ),
      );
      expect(dims, `${siteKey(rule)} dims to ${alpha} and no pairing measures that`).toBe(true);
    }
  });

  test("the fills a script paints are the ones the inventory measures against", () => {
    // The window's own surface and its five title-bar panes are painted as SVG `fill`
    // attributes by `window-frame.js`, not by any stylesheet — so eighteen rows measure
    // against a background no audited sheet declares. Change `SURFACE` there and none
    // of them would notice. The script names tokens rather than values, and this is
    // what holds it to the ones the inventory knows.
    const painted = readFileSync(join(ROOT, "design/scripts/window-frame.js"), "utf8");
    const named = [...painted.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(
      ([, token]) => token as string,
    );
    expect(named, "the window frame stopped painting itself in the window fill").toContain(
      "surface",
    );
    expect(
      named.filter((token) => token.startsWith("pane-")).sort(),
      "the title bar's panes are not the five the inventory measures",
    ).toEqual(["pane-1", "pane-2", "pane-3", "pane-4", "pane-5"]);
    const backgrounds = measuredBackgrounds();
    for (const token of named) {
      if (!palette.has(token)) continue; // `--ink-shadow*` are alphas, not fills
      expect(
        backgrounds.has(token) || token === "ink",
        `window-frame.js paints --${token}, which nothing is measured against`,
      ).toBe(true);
    }
  });

  test("no pairing is exempt without naming the exception it invokes", () => {
    for (const pairing of PAIRINGS) {
      if (pairing.threshold !== "exempt") continue;
      expect(pairing.note, `${pairing.what} is exempt without a reason`).toMatch(
        /§1\.4\.3|carries no text/,
      );
    }
  });
});
