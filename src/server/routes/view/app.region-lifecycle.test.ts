import { describe, expect, test } from "bun:test";

import { createApp } from "../../app.ts";

describe("the shipped shell owns the release rule", () => {
  test("starts the release scope, and the window it will release is the client's", async () => {
    const app = createApp();
    const html = await (await app.request("/")).text();

    // The shell marks no region of its own any more. The one region there is lives
    // inside the window, and the window is created and destroyed by the client — which
    // is what makes putting the window away the only way a region disappears.
    expect(html).not.toContain("data-content-region");
    expect(html).toContain('<script type="module" src="/static/region-scope.js"></script>');
    expect(html).toContain('<script type="module" src="/static/desk-window.js"></script>');

    const windowModule = await (await app.request("/static/desk-window.js")).text();
    expect(windowModule).toContain("region.dataset.contentRegion = WINDOW_CONTENT_REGION");
  });

  test("serves the release scope module as JavaScript at its static path", async () => {
    const app = createApp();
    const response = await app.request("/static/region-scope.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("javascript");
    expect(await response.text()).toContain("aluna:release-region");
  });
});
