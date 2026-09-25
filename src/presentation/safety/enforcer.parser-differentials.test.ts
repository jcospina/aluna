import { describe, expect, test } from "bun:test";

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import { fuzzMarkup, leftoverOpeners } from "./markup-fuzz.test-support.ts";

// Where lol-html and a browser read the same bytes differently, and what the enforcer does so the
// browser never sees markup the enforcer did not judge.

describe("enforcer — a CDATA section cannot hide markup from it", () => {
  // lol-html reads CDATA as text after a self-closed <svg/>; a browser reads a bogus comment that
  // ends at the first ">", and what follows it is live.
  test("reads what a CDATA section hides after foreign content as the markup a browser sees", () => {
    for (const lead of ["<svg/>", "<math/>", "<div><svg></div>", "<a><svg></a>"]) {
      const markup = `${lead}<![CDATA[><div x-init="alert(1)" data-live="1">]]>`;
      const output = enforceItemMarkup(markup);
      expect(output, markup).not.toContain("x-init");
      expect(output, markup).not.toContain("<![CDATA[");
      expect(enforceItemMarkup(output), markup).toBe(output);
    }
  });
});

describe("enforcer — unwrapping keeps the end tag that closed a kept element", () => {
  test("writes back the end tag an unwrapped element was handed, once", () => {
    expect(enforceItemMarkup("<div><a></div><p>x</p>")).toBe("<div></div><p>x</p>");
    expect(enforceItemMarkup("<p><a>t</p><div>q</div>")).toBe("<p>t</p><div>q</div>");
    expect(enforceItemMarkup("<div><a><foo></div>x")).toBe("<div></div>x");
  });

  test("writes no end tag for an element that was itself unwrapped or removed", () => {
    expect(enforceItemMarkup("<foo><a></foo><p>k</p>")).toBe("<p>k</p>");
    expect(enforceItemMarkup("<svg><div><a></div></svg><p>ok</p>")).toBe("<p>ok</p>");
  });
});

// A raw-text/RCDATA element's content is text, never markup, so unwrapping one re-emits that
// text as markup and turns an inert payload live. They leave with their content instead.
describe("enforcer — a raw-text element cannot launder its content into markup", () => {
  test("an RCDATA element is removed with everything inside it", () => {
    for (const markup of [
      "<textarea><img src=x onerror=alert(1)></textarea>",
      "<textarea><script>alert(1)</script></textarea>",
      "<TEXTAREA><img src=x onerror=alert(1)></TEXTAREA>",
      "<noembed><img src=x onerror=alert(1)></noembed>",
    ]) {
      expect(enforceItemMarkup(markup), markup).toBe("");
    }

    expect(
      enforceItemMarkup(
        '<div class="stack"><textarea><img src=x onerror=alert(1)></textarea></div>',
      ),
    ).toBe('<div class="stack"></div>');
  });

  // The property that catches the next one of these without anybody thinking of it: a
  // pass that changes what a second pass would change was, by definition, shipped live.
  test("enforcing is idempotent across every hostile case", () => {
    for (const markup of [
      "<textarea><img src=x onerror=alert(1)></textarea>",
      "<noembed><script>alert(1)</script></noembed>",
      "<div class='stack'><textarea><iframe src='javascript:alert(1)'></iframe></textarea></div>",
      "<script>alert(1)</script>",
      "<svg><script>alert(1)</script></svg>",
      "<div class='stack'><p>ordinary</p></div>",
      `<img src="${FILE_URL_PREFIX}${mintFileKey()}" loading=eager loading=lazy>`,
      `<img srcset="${FILE_URL_PREFIX}k 1x, https&#58;//evil.example/b.png 2x">`,
      '<img src="https&colon;//evil.example/p.gif" alt="x">',
      `<picture><source srcset="${FILE_URL_PREFIX}a"><a></picture><img src="/x.png">`,
      `<picture><source srcset="${FILE_URL_PREFIX}a"><button></picture><img src="/x.png">`,
      "<svg><picture/></svg><math><picture/></math>",
      "<div><a></div><p>x</p>",
      "<p><a>t</p><div>q</div>",
      "<div><a><foo></div>x",
      '<svg/><![CDATA[><div x-init="alert(1)">]]>',
      ...SPLICES.map(splicedOpener),
      '<svg/><<a></a>![CDATA[><div x-init="alert(1)">]]>',
      "<img src=x onerror=alert(1)//",
    ]) {
      const once = enforceItemMarkup(markup);
      expect(enforceItemMarkup(once), markup).toBe(once);
    }
  });
});

/** The nodes an enforcer takes out, each able to sit between a lone `<` and what follows it. */
const SPLICES = ["<a></a>", "<!---->", "<script></script>"];

const splicedOpener = (removed: string): string =>
  `<${removed}!x<span title="><div x-data x-init='alert(1)'>">t</span>`;

describe("enforcer — removing a node never glues its neighbours into markup", () => {
  test("a lone < stays text when the node after it is taken out", () => {
    for (const removed of SPLICES) {
      expect(enforceItemMarkup(splicedOpener(removed)), removed).toBe(
        `&lt;!x<span title="><div x-data x-init='alert(1)'>">t</span>`,
      );
    }
  });

  test("a CDATA opener cannot be rebuilt around a removed node", () => {
    const output = enforceItemMarkup('<svg/><<a></a>![CDATA[><div x-init="alert(1)">]]>');
    expect(output).not.toContain("<!");
    expect(leftoverOpeners(output, false)).toEqual([]);
  });

  test("a tag left open at the end is closed and judged, not passed through", () => {
    expect(enforceItemMarkup("<img src=x onerror=alert(1)//")).toBe("<img src=x>");
    expect(enforceItemMarkup('<span title="t" onclick="x()" ')).toBe('<span title="t">');
  });

  test("seeded fuzz: every output is a fixed point with no < left as data", () => {
    for (const markup of fuzzMarkup(71, 4000)) {
      const once = enforceItemMarkup(markup);
      expect(enforceItemMarkup(once), markup).toBe(once);
      expect(leftoverOpeners(once, false), markup).toEqual([]);
    }
  });
});
