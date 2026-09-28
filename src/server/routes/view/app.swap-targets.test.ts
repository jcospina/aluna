import { describe, expect, test } from "bun:test";
import { MISSING_SWAP_TARGET_EVENT } from "#shell/swap-target.js";
import { createTestApp } from "../../isolated-app.test-support.ts";

describe("the shipped shell carries the swap-target guard", () => {
  test("the shell loads the guard module beside the release scope it completes", async () => {
    const app = createTestApp();
    const html = await (await app.request("/")).text();

    expect(html).toContain('<script type="module" src="/static/region-scope.js"></script>');
    expect(html).toContain('<script type="module" src="/static/swap-target.js"></script>');
  });

  test("serves the guard as JavaScript at its static path", async () => {
    const app = createTestApp();
    const response = await app.request("/static/swap-target.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("javascript");
    expect(await response.text()).toContain(MISSING_SWAP_TARGET_EVENT);
  });
});
