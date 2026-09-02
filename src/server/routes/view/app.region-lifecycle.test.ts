import { describe, expect, test } from "bun:test";

import { createApp } from "../../app.ts";

async function trackedReaders(app: ReturnType<typeof createApp>): Promise<number> {
  const response = await app.request("/demo/region-lifecycle/readers");
  const { readers } = (await response.json()) as { readers: { readerCount: number }[] };
  return readers.reduce((sum, gate) => sum + gate.readerCount, 0);
}

async function waitForGateState(
  app: ReturnType<typeof createApp>,
  expected: "active" | "closing",
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.request("/demo/region-lifecycle/readers");
    const { readers } = (await response.json()) as { readers: { state: string }[] };
    if (readers.every((gate) => gate.state === expected)) return;
    await Bun.sleep(5);
  }
  throw new Error(`The preview gate never reached ${expected}.`);
}

interface DrainReportBody {
  readonly outcome: string;
  readonly waitedMs: number;
  readonly deadlineMs: number;
  readonly previousDeadlineMs: number;
}

async function drain(app: ReturnType<typeof createApp>): Promise<DrainReportBody> {
  const response = await app.request("/demo/region-lifecycle/drain", { method: "POST" });
  return (await response.json()) as DrainReportBody;
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

// The drain half of the preview: the deadline that used to sit *below* the longest a
// single handler may run now sits above it, so a slow reader delays a deletion instead of
// failing it — and a wait measured in seconds is not something a page can otherwise show.
describe("POST /demo/region-lifecycle/drain (the raised drain deadline, epic 5.8)", () => {
  test("the drain waits for a slow read, reports the wait, and reopens the gate", async () => {
    const app = createApp();
    const reading = app.request("/demo/region-lifecycle/read?view=list&ms=1000");
    await waitForReaders(app, 1);

    const report = await drain(app);

    expect(report.outcome).toBe("drained");
    // It waited for the reader rather than cutting it short or refusing. The floor is well
    // under the hold so a loaded machine cannot turn the margin into a failure.
    expect(report.waitedMs).toBeGreaterThanOrEqual(400);
    expect((await reading).status).toBe(200);
    // The two numbers the readout exists to put side by side: a wait longer than the
    // superseded deadline is a deletion that used to fail for a reason nobody could see.
    expect(report.deadlineMs).toBeGreaterThan(report.previousDeadlineMs);

    // Nothing is ever finalized here, so the reopened gate takes readers again.
    expect(await trackedReaders(app)).toBe(0);
    const after = await app.request("/demo/region-lifecycle/read?view=list&ms=0");
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("read token");
  });

  test("a closing gate answers a new read with the router's own refusal", async () => {
    const app = createApp();
    // Held long enough that the reader cannot finish — and reopen the gate — between the
    // moment the poll below sees `closing` and the moment the refused read is admitted.
    const reading = app.request("/demo/region-lifecycle/read?view=list&ms=2000");
    await waitForReaders(app, 1);
    const draining = drain(app);
    await waitForGateState(app, "closing");

    const refused = await app.request("/demo/region-lifecycle/read?view=list&ms=0");

    // The real bytes and the real status: htmx will not swap a 4xx unaided, so the
    // preview showing a 200 here would be showing something production never does.
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("I’m making a careful change here.");
    expect((await reading).status).toBe(200);
    expect((await draining).outcome).toBe("drained");
  });
});
