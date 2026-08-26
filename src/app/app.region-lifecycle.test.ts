import { describe, expect, test } from "bun:test";

import { createApp } from "./app.ts";

async function trackedReaders(app: ReturnType<typeof createApp>): Promise<number> {
  const response = await app.request("/demo/region-lifecycle/readers");
  const { readers } = (await response.json()) as { readers: { readerCount: number }[] };
  return readers.reduce((sum, gate) => sum + gate.readerCount, 0);
}

async function waitForReaders(
  app: ReturnType<typeof createApp>,
  expected: number,
): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const count = await trackedReaders(app);
    if (count === expected) return count;
    await Bun.sleep(5);
  }
  throw new Error(`Tracked readers never reached ${expected}.`);
}

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

describe("GET /demo/region-lifecycle (the content region's release rule, epic 5.3)", () => {
  test("serves the preview page wired to the real release scope module", async () => {
    const app = createApp();
    const response = await app.request("/demo/region-lifecycle");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/html");
    // The preview drives the shipped module, not a copy of it.
    expect(html).toContain('src="/static/region-lifecycle-preview.js"');
    // The region itself is created client-side, the way the window will be; the page
    // ships only the host it appears in and the two live readouts.
    expect(html).toContain("data-preview-window");
    expect(html).toContain("data-preview-scope");
    expect(html).toContain("data-preview-readers");
  });

  test("a read holds one tracked reader while it is in flight and hands it back after", async () => {
    const app = createApp();
    expect(await trackedReaders(app)).toBe(0);

    const response = await app.request("/demo/region-lifecycle/read?view=list&ms=0");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("read token");
    expect(await trackedReaders(app)).toBe(0);
  });

  // The whole point of the preview: the release is visible because the read is slow, and
  // the reader count returns to zero at the abort rather than at the handler deadline —
  // which is two minutes out, far past anything this test would wait for.
  test("navigating away mid-read returns the tracked reader count to zero at once", async () => {
    const app = createApp();
    const client = new AbortController();
    const request = app.request("/demo/region-lifecycle/read?view=list&ms=120000", {
      signal: client.signal,
    });

    await waitForReaders(app, 1);
    client.abort();

    expect((await request).status).toBe(499);
    expect(await waitForReaders(app, 0)).toBe(0);
  });
});
