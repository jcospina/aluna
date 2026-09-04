import { describe, expect, test } from "bun:test";

import { enforceHandlerFragment } from "./fragment-safety.ts";

// The render-time last line for the markup a generated Handler composes *around* its
// items. `enforcer.test.ts` covers the item vocabulary; this covers the wrapper, and in
// particular the one attribute that is not execution but escape.

describe("a Handler's fragment cannot swap outside the region it was aimed at", () => {
  test("hx-swap-oob is removed, wherever it points and however it is cased", () => {
    // Out-of-band is how the platform writes the desk from a response
    // (`src/server/http/fragments.ts`). No generation contract asks a Handler for one, and
    // a Handler that emits one is reaching past its own swap target into the shell — here,
    // straight into the collection's count label.
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
