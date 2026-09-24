import { describe, expect, test } from "bun:test";

import { enforceHandlerFragment } from "./fragment-safety.ts";

// The render-time last line for the markup a generated Handler composes around its items.
// `enforcer.test.ts` covers the item vocabulary; this covers the wrapper.

describe("a Handler's fragment cannot swap outside the region it was aimed at", () => {
  test("hx-swap-oob is removed, wherever it points and however it is cased", () => {
    // Out-of-band is how the platform writes the desk from a response
    // (`src/server/http/fragments.ts`); a Handler emitting one reaches past its own swap target.
    for (const attribute of [
      `hx-swap-oob="innerHTML:#tasks-count"`,
      `HX-SWAP-OOB="outerHTML"`,
      `hx-swap-oob="beforeend:#capability-logos"`,
    ]) {
      const { html, neutralized } = enforceHandlerFragment(`<div ${attribute}>9,999 tasks</div>`);
      expect(html.toLowerCase()).not.toContain("hx-swap-oob");
      expect(neutralized).toBe(true);
      // The copy survives; only the reach is taken away.
      expect(html).toContain("9,999 tasks");
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
      ["iframe", "src"],
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
    const hostile =
      `<div hx-swap-oob="innerHTML:#tasks-count" onclick="x()">` +
      `<a href="javascript:x()">go</a><script>x()</script></div>`;
    const once = enforceHandlerFragment(hostile).html;
    expect(enforceHandlerFragment(once).html).toBe(once);
    expect(enforceHandlerFragment(once).neutralized).toBe(false);
  });
});
