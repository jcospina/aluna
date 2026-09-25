import { describe, expect, test } from "bun:test";

import { enforceHandlerFragment } from "./fragment-safety.ts";
import { fuzzMarkup, leftoverOpeners } from "./markup-fuzz.test-support.ts";

// The render-time last line for the markup a generated Handler composes around its items.
// `enforcer.test.ts` covers the item vocabulary; this covers the wrapper.

describe("a Handler's fragment cannot swap outside the region it was aimed at", () => {
  test("an out-of-band swap is removed, however it is cased or prefixed", () => {
    // Out-of-band is how the platform writes the desk from a response
    // (`src/server/http/fragments.ts`); a Handler emitting one reaches past its own swap target.
    for (const attribute of [
      `hx-swap-oob="innerHTML:#tasks-count"`,
      `HX-SWAP-OOB="outerHTML"`,
      `hx-swap-oob="beforeend:#capability-logos"`,
      // htmx reads every attribute under a `data-` prefix as well.
      `data-hx-swap-oob="outerHTML:#desk"`,
      `hx-select-oob="#desk"`,
      `DATA-HX-SELECT-OOB="#desk"`,
    ]) {
      const { html, neutralized } = enforceHandlerFragment(`<div ${attribute}>9,999 tasks</div>`);
      expect(html.toLowerCase()).not.toContain("-oob");
      expect(neutralized).toBe(true);
      // The copy survives; only the reach is taken away.
      expect(html).toContain("9,999 tasks");
    }
  });

  test("a desk element taken by id, or the desk's address rewritten, is removed too", () => {
    for (const attribute of [
      `id="capability-logos" hx-preserve`,
      `id="spec-build-form" data-hx-preserve="true"`,
      `hx-get="/capability/tasks/read" hx-push-url="/capability/other"`,
      `hx-get="/capability/tasks/read" data-hx-replace-url="true"`,
    ]) {
      const { html, neutralized } = enforceHandlerFragment(`<div ${attribute}>t</div>`);
      expect(html, attribute).not.toMatch(/preserve|push-url|replace-url/);
      expect(neutralized).toBe(true);
    }
  });

  test("the hx-* a Handler legitimately composes with is untouched", () => {
    const fragment =
      `<form hx-post="/capability/tasks/create" hx-target="#tasks-records"` +
      ` hx-swap="innerHTML"><button type="submit">New</button></form>`;
    const { html, neutralized } = enforceHandlerFragment(fragment);
    expect(html).toBe(fragment);
    expect(neutralized).toBe(false);
  });

  test("a script scheme hidden behind a character reference is removed", () => {
    for (const href of ["javascript&colon;x()", "javascript&#58;x()", "&#106;avascript:x()"]) {
      const { html, neutralized } = enforceHandlerFragment(`<a href="${href}">go</a>`);
      expect(html, href).toBe("<a>go</a>");
      expect(neutralized).toBe(true);
    }
    const query = '<a href="?q=a&amp;page=2">next</a>';
    expect(enforceHandlerFragment(query).html).toBe(query);
  });

  test("a hostile second copy of a link cannot outlive the safe first one", () => {
    for (const [tag, attribute] of [
      ["a", "href"],
      ["form", "action"],
      ["button", "formaction"],
    ] as const) {
      const markup = `<${tag} ${attribute}="/ok" ${attribute}="javascript:alert(1)"></${tag}>`;
      const once = enforceHandlerFragment(markup).html;
      expect(once, markup).toBe(`<${tag} ${attribute}="/ok"></${tag}>`);
      expect(enforceHandlerFragment(once).html).toBe(once);
    }
  });

  test("a CDATA section after foreign content cannot hide an out-of-band swap", () => {
    const hidden = '<svg/><![CDATA[><div hx-swap-oob="true" id="desk">x</div>]]>';
    const { html, neutralized } = enforceHandlerFragment(hidden);
    expect(html).not.toContain("hx-swap-oob");
    expect(neutralized).toBe(true);
  });

  test("enforcing twice changes nothing the first pass left", () => {
    // Idempotence is the guard that catches a scrub which turns inert text into live
    // markup: if a second pass finds more to remove, the first pass created it.
    for (const hostile of [
      `<div hx-swap-oob="innerHTML:#tasks-count" onclick="x()">` +
        `<a href="javascript:x()">go</a><script>x()</script></div>`,
      `<<script></script>!x<span title="><div x-data x-init='alert(1)'>">t</span>`,
      `<<!---->!x<span title="><div x-init='alert(1)'>">t</span>`,
      '<svg/><<script></script>![CDATA[><div x-init="alert(1)">]]>',
      '<svg/><style><span title="</style><img src=x onerror=alert(1)>">',
      '<img src=x hx-swap-oob=1 a/="b>" onerror=alert(1)//">',
      "<img src=x onerror=alert(1)//",
    ]) {
      const once = enforceHandlerFragment(hostile).html;
      expect(enforceHandlerFragment(once).html, hostile).toBe(once);
      expect(enforceHandlerFragment(once).neutralized, hostile).toBe(false);
    }
  });
});

describe("a Handler's fragment keeps every < the parser read as data inert", () => {
  test("a lone < stays text when the script after it is taken out", () => {
    const { html } = enforceHandlerFragment(
      `<<script></script>!x<span title="><div x-data x-init='alert(1)'>">t</span>`,
    );
    expect(html).toBe(`&lt;!x<span title=">&lt;div x-data x-init='alert(1)'>">t</span>`);
  });

  test("a raw-text end tag hidden in a value cannot close the element early", () => {
    // lol-html still reads `<style>` after `<svg/>` as foreign markup; a browser reads raw text
    // that ends at the first `</style`, wherever it sits.
    const { html } = enforceHandlerFragment(
      '<svg/><style><span title="</style><img src=x onerror=alert(1)>"><!--</style>--></style>',
    );
    expect(html).not.toContain("</style><img");
    expect(leftoverOpeners(html, true)).toEqual([]);
  });

  test("an attribute named by a parse error cannot become the value of the one before it", () => {
    for (const markup of [
      '<img src=x hx-swap-oob=1 a/="b>" onerror=alert(1)//">',
      "<a href/=javascript:alert(1) hx-swap-oob=1>t</a>",
    ]) {
      const { html } = enforceHandlerFragment(markup);
      expect(html, markup).not.toContain(" =");
      expect(leftoverOpeners(html, true), markup).toEqual([]);
    }
  });

  test("a tag left open at the end is closed and judged, not passed through", () => {
    expect(enforceHandlerFragment("<img src=x onerror=alert(1)//").html).toBe("<img src=x>");
  });

  test("seeded fuzz: every output is a fixed point with no < left as data", () => {
    for (const markup of fuzzMarkup(113, 4000)) {
      const once = enforceHandlerFragment(markup).html;
      expect(enforceHandlerFragment(once).html, markup).toBe(once);
      expect(leftoverOpeners(once, true), markup).toEqual([]);
    }
  });
});

describe("a Handler's fragment carries no code for the page's Alpine to run", () => {
  test("every directive and both shorthands are removed, and the element they sat on stays", () => {
    for (const attribute of [
      'x-data="{ open: true }"',
      "x-init=\"fetch('/steal?c=' + document.cookie)\"",
      'X-HTML="payload"',
      'x-on:click="x()"',
      '@click="x()"',
      ':class="x()"',
      'x-bind:href="x()"',
    ]) {
      const { html, neutralized } = enforceHandlerFragment(`<div ${attribute}>Kept</div>`);
      expect(html).toBe("<div>Kept</div>");
      expect(neutralized).toBe(true);
    }
  });

  test("an attribute that merely contains the letters stays", () => {
    const fragment = '<div data-box-x-on="kept" class="box-x">Kept</div>';
    expect(enforceHandlerFragment(fragment)).toEqual({ html: fragment, neutralized: false });
  });
});

describe("a Handler's fragment opens no document of its own", () => {
  test("a srcdoc frame is removed: it is never fetched, so frame-src never judges it", () => {
    const frame =
      '<iframe srcdoc="<script src=/vendor/alpine.min.js defer></script>' +
      '<div x-data x-init=&quot;parent.document.body.remove()&quot;></div>"></iframe>';
    expect(enforceHandlerFragment(`<p>Before</p>${frame}<p>After</p>`)).toEqual({
      html: "<p>Before</p><p>After</p>",
      neutralized: true,
    });
  });

  test("every element that nests a document, embeds a plugin or re-roots the page goes", () => {
    for (const markup of [
      '<FRAME src="/x"></FRAME>',
      "<frameset><frame></frameset>",
      '<object data="/x.svg"><p>fallback</p></object>',
      '<embed src="/x.swf">',
      '<applet code="X"></applet>',
      '<portal src="/x"></portal>',
      '<fencedframe src="/x"></fencedframe>',
      '<base href="//evil.example/">',
      '<meta http-equiv="refresh" content="0;url=//evil.example/">',
      '<link rel="stylesheet" href="//evil.example/x.css">',
    ]) {
      expect(enforceHandlerFragment(`${markup}<p>kept</p>`), markup).toEqual({
        html: "<p>kept</p>",
        neutralized: true,
      });
    }
  });

  test("srcdoc is removed from any element, prefixed or not", () => {
    for (const attribute of ['srcdoc="x"', 'data-srcdoc="x"', 'xlink:srcdoc="x"']) {
      expect(enforceHandlerFragment(`<div ${attribute}>t</div>`).html).toBe("<div>t</div>");
    }
  });
});

describe("a Handler's fragment keeps no SVG link that could run", () => {
  test("an animation that sets a link after it was judged is removed", () => {
    for (const animation of [
      '<set attributeName="href" to="javascript:alert(1)"/>',
      '<animate attributeName="href" values="javascript:alert(1)"/>',
      '<animateMotion dur="1s"/>',
      '<animateTransform attributeName="transform"/>',
    ]) {
      const markup = `<svg><a href="/ok">${animation}<text>go</text></a></svg>`;
      expect(enforceHandlerFragment(markup).html, animation).toBe(
        '<svg><a href="/ok"><text>go</text></a></svg>',
      );
    }
  });

  test("a namespaced link is judged as the link it is", () => {
    expect(
      enforceHandlerFragment('<svg><a xlink:href="javascript:alert(1)">go</a></svg>').html,
    ).toBe("<svg><a>go</a></svg>");
    const kept = '<svg><a xlink:href="/tasks">go</a></svg>';
    expect(enforceHandlerFragment(kept)).toEqual({ html: kept, neutralized: false });
  });
});

describe("a Handler's fragment carries no code for htmx to evaluate", () => {
  test("hx-on handlers and hx-vars are removed, with or without the data- prefix", () => {
    for (const attribute of [
      'hx-on:click="alert(1)"',
      'hx-on::after-request="alert(1)"',
      'hx-on-click="alert(1)"',
      'data-hx-on:click="alert(1)"',
      'data-hx-on--after-request="alert(1)"',
      'hx-vars="a:alert(1)"',
      'data-hx-vars="a:alert(1)"',
    ]) {
      expect(enforceHandlerFragment(`<form ${attribute}>t</form>`), attribute).toEqual({
        html: "<form>t</form>",
        neutralized: true,
      });
    }
  });

  test("a value htmx would evaluate is removed; the same attribute as data stays", () => {
    for (const attribute of [
      'hx-vals="js:{a: alert(1)}"',
      'hx-vals=" javascript:{a: alert(1)}"',
      'hx-vals="&#106;s:{a: alert(1)}"',
      'data-hx-headers="js:{a: alert(1)}"',
      'hx-request="js:{timeout: alert(1)}"',
      'hx-trigger="click[alert(1)]"',
      'data-hx-trigger="keyup&#91;alert(1)]"',
    ]) {
      expect(enforceHandlerFragment(`<form ${attribute}>t</form>`).html, attribute).toBe(
        "<form>t</form>",
      );
    }
    const data = `<form hx-vals='{"page": 2}' hx-trigger="submit, keyup changed delay:300ms">t</form>`;
    expect(enforceHandlerFragment(data)).toEqual({ html: data, neutralized: false });
  });

  test("an htmx extension or its stream wiring is removed, behind a data- prefix too", () => {
    for (const attribute of [
      'hx-ext="sse"',
      'sse-connect="/build/job-1/stream"',
      'sse-swap="narration"',
      'data-sse-swap="narration"',
      'ws-connect="/socket"',
    ]) {
      expect(enforceHandlerFragment(`<div ${attribute}>t</div>`), attribute).toEqual({
        html: "<div>t</div>",
        neutralized: true,
      });
    }
  });

  test("an Alpine directive or event handler behind a data- prefix is removed too", () => {
    for (const attribute of ['data-x-init="alert(1)"', 'data-onclick="alert(1)"']) {
      expect(enforceHandlerFragment(`<div ${attribute}>t</div>`).html).toBe("<div>t</div>");
    }
  });
});

describe("a Handler's fragment keeps its CSS as written", () => {
  test("a range media query keeps its <", () => {
    const style =
      "<style>@media (width < 40rem) { .a { gap: 0 } } @media (400px <= width) {}</style>";
    expect(enforceHandlerFragment(style)).toEqual({ html: style, neutralized: false });
  });

  test("a < in a style that would open markup is still escaped, in either namespace", () => {
    expect(enforceHandlerFragment("<style>.a {} <img src=x onerror=alert(1)></style>").html).toBe(
      "<style>.a {} &lt;img src=x onerror=alert(1)></style>",
    );
    // Removing `<embed>` takes away the breakout that made this style HTML; a second pass reads
    // it as SVG, and must agree with the first.
    const flipped = "<svg><embed><style>@media (width < 40rem) {} <b></style></svg>";
    const once = enforceHandlerFragment(flipped).html;
    expect(once).toBe("<svg><style>@media (width < 40rem) {} &lt;b></style></svg>");
    expect(enforceHandlerFragment(once).html).toBe(once);
  });

  test("a lone < in a style stays inert when the node after the style is taken out", () => {
    const { html } = enforceHandlerFragment(
      `<style>a <</style><script></script>!x<span title="><div x-init='alert(1)'>">t</span>`,
    );
    expect(html).toBe(`<style>a &lt;</style>!x<span title=">&lt;div x-init='alert(1)'>">t</span>`);
    expect(leftoverOpeners(html, true)).toEqual([]);
  });
});

describe("a Handler's fragment reports a removal, never a normalization", () => {
  test("escaping, collapsing and closing leave neutralized false", () => {
    for (const benign of [
      '<p title="a<b">1 < 2</p>',
      "<!-- a < b --><p>x</p>",
      '<div class="a" class="b">x</div>',
      '<p title="x"',
      "<svg/><![CDATA[x]]>",
    ]) {
      const { html, neutralized } = enforceHandlerFragment(benign);
      expect(html, benign).not.toBe(benign);
      expect(neutralized, benign).toBe(false);
    }
  });
});
