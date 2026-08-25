import { describe, expect, test } from "bun:test";

import { GUARDED_SWAP_EVENTS } from "#shell/swap-target.js";
import { createApp } from "./app.ts";
import { SWAP_TARGET_PREVIEW_ROUTE } from "./swap-target-preview.ts";

describe("the shipped shell carries the swap-target guard", () => {
  test("the shell loads the guard module beside the release scope it completes", async () => {
    const app = createApp();
    const html = await (await app.request("/")).text();

    expect(html).toContain('<script type="module" src="/static/region-scope.js"></script>');
    expect(html).toContain('<script type="module" src="/static/swap-target.js"></script>');
  });

  test("serves the guard as JavaScript at its static path", async () => {
    const app = createApp();
    const response = await app.request("/static/swap-target.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("javascript");
    expect(await response.text()).toContain("aluna:missing-swap-target");
  });
});

describe(`GET ${SWAP_TARGET_PREVIEW_ROUTE} (loud swap targets, epic 5.3)`, () => {
  test("forces every page-assembly anchor and shows the raised error for each", async () => {
    const app = createApp();
    const response = await app.request(SWAP_TARGET_PREVIEW_ROUTE);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/html");

    // Three anchors, three raised errors — and the intact shell still assembles, so the
    // preview is showing a real failure rather than a page that never worked. The shell
    // root left the list with the rail it flipped: an empty desk needs no gate.
    expect(html.split("<span data-anchor-raised>").length - 1).toBe(3);
    expect(html).toContain("<span data-anchor-assembled>");
    for (const raised of [
      "The shell logo-layer placeholder is missing.",
      "The shell detail-modal placeholder is missing.",
      "The shell content target placeholder is missing.",
    ]) {
      expect(html).toContain(raised);
    }
  });

  test("drives the shipped guard against a region it can put away", async () => {
    const app = createApp();
    const html = await (await app.request(SWAP_TARGET_PREVIEW_ROUTE)).text();

    // The preview runs the shipped module, not a copy of it.
    expect(html).toContain('src="/static/swap-target-preview.js"');
    expect(html).toContain("data-preview-host");
    expect(html).toContain("data-preview-away");
    for (const event of GUARDED_SWAP_EVENTS) {
      expect(html).toContain(`data-preview-deliver="${event}"`);
    }

    const module = await (await app.request("/static/swap-target-preview.js")).text();
    expect(module).toContain('from "./swap-target.js"');
    for (const event of GUARDED_SWAP_EVENTS) {
      expect(module).toContain(`sse-swap="${event}"`);
    }
  });
});
