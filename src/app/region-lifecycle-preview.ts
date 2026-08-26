// The developer preview for the content region's release rule.
//
// The rule itself ships in the product: `public/region-scope.js` runs on the shell, the
// window's content and every records region are marked `data-content-region`, and a read
// whose client goes away is abandoned by the capability router. None of that is
// *visible*, because a real handler answers in milliseconds — the read token is back
// before anyone could watch it come back.
//
// So this surface makes the timing observable and nothing else. It drives the real
// client module and the real `ReadGateCoordinator` against a read that deliberately takes
// its time, and shows two numbers side by side: what the region's scope is holding, and
// how many readers the server is tracking. Navigate away mid-read and both empty at once.
//
// Its read gate is its own coordinator over a synthetic incarnation, so the preview never
// touches the registry's. Scaffolding: it comes down when the window ships the same rule
// on a real capability.

import type { Hono } from "hono";
import {
  type CapabilityIncarnation,
  createReadGateCoordinator,
  type ReadGateSnapshotEntry,
} from "../read-gates/index.ts";
import { CapabilityReadAbandonedError, withHandlerDeadline } from "../router/index.ts";
import { escapeHtml } from "../web/html.ts";

export const REGION_LIFECYCLE_PREVIEW_ROUTE = "/demo/region-lifecycle";

/** The synthetic incarnation the preview's reads are admitted against. */
const PREVIEW_INCARNATION: CapabilityIncarnation = Object.freeze({
  capabilityId: "region_lifecycle_preview",
  incarnationId: "00000000-0000-4000-8000-0000000000dd",
});

/** Well above any hold the preview offers, so the deadline never explains an early release. */
const PREVIEW_HANDLER_TIMEOUT_MS = 120_000;

/** How long a preview read holds its token when the page asks for no particular time. */
const DEFAULT_HOLD_MS = 8_000;
const MAX_HOLD_MS = 60_000;

function holdMsFrom(raw: string | undefined): number {
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return DEFAULT_HOLD_MS;
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_HOLD_MS);
}

function viewFrom(raw: string | undefined): "list" | "record" {
  return raw === "record" ? "record" : "list";
}

function readAnswer(view: "list" | "record", holdMs: number): string {
  const what = view === "record" ? "One record" : "Twelve records";
  return `${what} — the server held its read token for ${holdMs}ms and answered.`;
}

export interface RegionLifecyclePreviewSurface {
  readonly snapshot: () => readonly ReadGateSnapshotEntry[];
}

/**
 * Register the preview's page and its two data routes. Returns the reader snapshot so a
 * test can observe the same count the page polls.
 */
export function registerRegionLifecyclePreviewRoutes(app: Hono): RegionLifecyclePreviewSurface {
  const readGates = createReadGateCoordinator();
  readGates.synchronizeCatalog([PREVIEW_INCARNATION]);

  app.get(
    REGION_LIFECYCLE_PREVIEW_ROUTE,
    () =>
      new Response(renderRegionLifecyclePreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // A read that takes its time. It acquires a real read token, and it is abandoned by the
  // same helper the capability router uses — on the request's own signal, which Bun aborts
  // when the browser closes the connection.
  app.get(`${REGION_LIFECYCLE_PREVIEW_ROUTE}/read`, async (c) => {
    const view = viewFrom(c.req.query("view"));
    const holdMs = holdMsFrom(c.req.query("ms"));
    try {
      return await readGates.withTokens(
        { catalog: [PREVIEW_INCARNATION], incarnations: [PREVIEW_INCARNATION] },
        async () => {
          const held = new Promise<string>((resolve) => {
            setTimeout(() => resolve(readAnswer(view, holdMs)), holdMs);
          });
          const answer = await withHandlerDeadline(
            held,
            PREVIEW_HANDLER_TIMEOUT_MS,
            PREVIEW_INCARNATION.capabilityId,
            view,
            c.req.raw.signal,
          );
          return c.html(`<p class="preview-answer">${escapeHtml(answer)}</p>`);
        },
      );
    } catch (error) {
      if (error instanceof CapabilityReadAbandonedError) return new Response(null, { status: 499 });
      throw error;
    }
  });

  app.get(`${REGION_LIFECYCLE_PREVIEW_ROUTE}/readers`, (c) =>
    c.json({ readers: readGates.snapshot() }, 200, { "cache-control": "no-store" }),
  );

  return { snapshot: () => readGates.snapshot() };
}

export function renderRegionLifecyclePreviewPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna - region lifecycle preview</title>
    <link rel="stylesheet" href="/design/styles/index.css">
    <link rel="stylesheet" href="/static/app.css">
    <script type="module" src="/static/region-lifecycle-preview.js"></script>
    <style>
      body {
        height: auto;
        min-height: 100dvh;
        max-width: 60rem;
        margin-inline: auto;
        padding: var(--space-4) var(--space-3) var(--space-8);
      }
      .preview-banner {
        margin: 0 0 var(--space-4);
        padding: var(--space-1) var(--space-2);
        font-family: var(--font-body);
        font-size: var(--type-sm);
        color: var(--ink-2);
        background: color-mix(in oklch, var(--shade), transparent 90%);
      }
      .preview-title {
        margin: 0 0 var(--space-1);
        font-family: var(--font-display);
        font-size: var(--type-lg);
      }
      .preview-controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        align-items: center;
        margin-block: var(--space-3);
      }
      .preview-window {
        min-height: 6rem;
        padding: var(--space-2);
      }
      .preview-view {
        display: block;
        padding: var(--space-2);
        font-family: var(--font-body);
        font-size: var(--type-sm);
        color: var(--ink-2);
      }
      .preview-panels {
        display: grid;
        gap: var(--space-2);
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        margin-block-start: var(--space-4);
      }
      .preview-panel-label {
        margin: 0 0 var(--space-1);
        font-family: var(--font-display);
        font-size: var(--type-sm);
      }
      .preview-readout {
        margin: 0;
        padding: var(--space-2);
        overflow-x: auto;
        font-family: var(--font-mono, monospace);
        font-size: var(--type-xs);
        color: var(--ink-2);
        background: color-mix(in oklch, var(--shade), transparent 92%);
        white-space: pre-wrap;
      }
    </style>
  </head>

  <body>
    <p class="preview-banner">
      Developer preview. The release rule itself ships in the shell; this page only makes
      it slow enough to watch. Its read gate is a preview coordinator over a synthetic
      incarnation, so nothing here touches the registry.
    </p>

    <h1 class="preview-title">A content region releases what its content started</h1>
    <p class="preview-view">
      Start a read, then swap the view or put the region away before it settles. The
      region's scope empties and the server's tracked reader count returns to zero at the
      same moment — not at the handler deadline, which is two minutes away.
    </p>

    <div class="preview-controls">
      <label class="preview-view" for="preview-hold">The read holds for</label>
      <input class="input" id="preview-hold" type="number" min="0" max="${MAX_HOLD_MS}"
        step="500" value="${DEFAULT_HOLD_MS}" data-preview-hold>
      <button type="button" class="btn" data-preview-show="list">Show the list</button>
      <button type="button" class="btn" data-preview-show="record">Open a record</button>
      <button type="button" class="btn" data-preview-away>Put the region away</button>
      <button type="button" class="btn" data-preview-back>Bring the region back</button>
    </div>

    <div class="preview-window" data-preview-window></div>

    <div class="preview-panels">
      <section>
        <h2 class="preview-panel-label">The region's live scope</h2>
        <pre class="preview-readout" data-preview-scope aria-live="polite"></pre>
      </section>
      <section>
        <h2 class="preview-panel-label">The server's tracked readers</h2>
        <pre class="preview-readout" data-preview-readers aria-live="polite"></pre>
      </section>
    </div>
  </body>
</html>
`;
}
