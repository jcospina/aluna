import { describe, expect, test } from "bun:test";

import { enforceItemMarkup } from "./enforcer.ts";

// The runtime allow-list enforcer is the *last line at render time* (ADR-0005 §3): it
// runs on the inner markup of every rendered record, after build-time validation, so a
// dynamic field value can never become executable markup. These tests cover the accept
// path and each hostile category the contract enumerates (design-system.md "Forbidden
// absolutely"). No external dependency is touched — Bun's native HTMLRewriter does the
// parsing.

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
    const markup = '<div style="color: var(--color-accent); padding: var(--space-2)">x</div>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("a media frame with an image field passes through unchanged", () => {
    const markup =
      '<figure class="media-frame media-frame--wide">' +
      '<img src="https://ex.com/p.jpg" alt="a photo" loading="lazy">' +
      "</figure>";
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("free (non-owned-axis) style properties for arrangement are kept", () => {
    const markup =
      '<div style="display: grid; grid-template-columns: 1fr 1fr; aspect-ratio: 16 / 9">x</div>';
    expect(enforceItemMarkup(markup)).toBe(markup);
  });

  test("safe aria and title attributes are preserved", () => {
    const markup = '<span role="img" aria-label="star" title="rating">★</span>';
    expect(enforceItemMarkup(markup)).toBe(markup);
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
    expect(enforceItemMarkup('<div style="background:#fff;color:var(--color-text)">x</div>')).toBe(
      '<div style="color:var(--color-text)">x</div>',
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

  test("drops a raw border and keeps a token one", () => {
    expect(enforceItemMarkup('<div style="border:2px solid red">x</div>')).toBe("<div>x</div>");
    const ok = '<div style="border:var(--border-regular) solid var(--color-border)">x</div>';
    expect(enforceItemMarkup(ok)).toBe(ok);
  });

  test("drops any font-family declaration (family is never declared)", () => {
    expect(enforceItemMarkup('<div style="font-family:Comic Sans">x</div>')).toBe("<div>x</div>");
    expect(enforceItemMarkup('<div style="font:italic 12px serif">x</div>')).toBe("<div>x</div>");
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
  test("is a pure synchronous string→string transform", () => {
    const out = enforceItemMarkup('<div class="stack">x</div>');
    expect(typeof out).toBe("string");
  });

  test("produces identical output for identical input", () => {
    const hostile = '<a href="x" onclick="e()"><script>e()</script><b style="color:red">Hi</b></a>';
    expect(enforceItemMarkup(hostile)).toBe(enforceItemMarkup(hostile));
  });

  test("passes element-free text through untouched", () => {
    expect(enforceItemMarkup("just a plain field value")).toBe("just a plain field value");
    expect(enforceItemMarkup("")).toBe("");
  });
});
