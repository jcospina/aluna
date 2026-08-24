// The few-shot gallery preview route. Split out of app.test.ts to keep that file under
// the repo's line ceiling; it is the same surface, exercised the same way.

import { describe, expect, test } from "bun:test";

import { createApp } from "./app.ts";

async function responseText(response: Response): Promise<string> {
  return await response.text();
}

// The few-shot gallery + injection harness HITL surface. The route is
// deterministic and provider-free: it previews repo-owned exemplars and the exact
// prompt section the item-renderer generator receives. It came down for the length of
// the High Meadow token cutover, when the contract it previews was the deleted one, and
// returns with 5.1/02's re-derived rung.
describe("GET /demo/few-shot-gallery (few-shot gallery, epic 3.5)", () => {
  test("renders the repo-only examples through the live presentation path", async () => {
    const app = createApp();
    const res = await app.request("/demo/few-shot-gallery");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(html).toContain("Text-forward note card");
    expect(html).toContain("Media-forward grid tile");
    expect(html).toContain("Compact metadata row");
    expect(html.match(/class="capability-item"/g)?.length).toBe(6);
    expect(html).toContain('class="capability-records capability-records--feed"');
    expect(html).toContain('class="capability-records capability-records--grid"');
    expect(html).toContain("Workshop wall before launch");
    expect(html).toContain("Token discipline for generated interfaces");
    expect(html).toContain("data-detail-template=");
    expect(html).toContain('<dialog id="aluna-detail-modal"');
    expect(html).toContain('src="/static/detail-modal.js"');
    expect(html).toContain('src="/static/item-detail.js"');
  });

  test("previews the injected prompt section with vary-dont-copy framing and layout context", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/demo/few-shot-gallery"));

    expect(html).toContain("Injected prompt preview");
    expect(html).toContain("Few-shot gallery. Vary, don&#39;t copy");
    expect(html).toContain("Chosen collection layout for this capability: &quot;feed&quot;");
    expect(html).toContain("Chosen collection layout for this capability: &quot;grid&quot;");
    expect(html).toContain("style=&quot;grid-template-columns");
    // The re-derived contract, in the words the generator actually receives.
    expect(html).toContain("Three axes are closed");
    expect(html).toContain("Four properties are never declared at all");
    // The retired fourth axis. `border` is a ban now, so the prompt names no weight — the
    // page's own developer chrome still rules its boxes, which is why this asks for the
    // sentence rather than for the absence of the string.
    expect(html).not.toContain("Every component boundary is one weight");
  });
});
