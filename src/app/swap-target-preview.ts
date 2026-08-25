// The developer preview for the loud swap target.
//
// Two halves of one rule, neither of them visible in ordinary use.
//
// Page assembly composes every full page by replacing literal anchors in the shipped
// shell, and every one of them throws when its anchor is missing — the shell root used to
// no-op in silence, leaving a page that looked assembled and was not, and it left the list
// altogether with the rail it flipped. A throw on the server is a 500 nobody reads, so
// this page forces each case against the real `public/index.html` and shows the raised
// error beside the intact assembly.
//
// The other half is the client's: a `commit` or `fragment` arriving after its region has
// gone. htmx's SSE extension drops that message and says nothing, which makes a build
// that produced nothing and a swap that landed nowhere the same event. The page drives
// the shipped `swap-target.js` against a region it removes on demand.
//
// Scaffolding: it comes down when the window ships and the same rule is exercised there.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Hono } from "hono";
import { escapeHtml } from "../web/html.ts";
import { PAGE_ASSEMBLY_ANCHORS, renderCapabilityShell } from "../web/index.ts";

export const SWAP_TARGET_PREVIEW_ROUTE = "/demo/swap-targets";

/** Synthetic, so the preview never reads the registry. */
const PREVIEW_ROW = Object.freeze({
  id: "swap_target_preview",
  label: "Swap target preview",
  incarnation_id: "00000000-0000-4000-8000-0000000000ee",
  version: 1,
});

const PREVIEW_COLLECTION = '<section class="preview-view">A capability surface.</section>';

interface AnchorOutcome {
  readonly name: string;
  readonly raised: string | null;
  readonly assembledLength: number | null;
}

/**
 * Run the real assembly once per anchor with that anchor taken out of the real shell.
 * `renderCapabilityShell` is the path that touches every one of them.
 */
function forceEveryAnchor(shellHtml: string): {
  readonly intact: AnchorOutcome;
  readonly forced: readonly AnchorOutcome[];
} {
  const assemble = (name: string, html: string): AnchorOutcome => {
    try {
      const page = renderCapabilityShell(PREVIEW_ROW, [PREVIEW_ROW], PREVIEW_COLLECTION, html);
      return { name, raised: null, assembledLength: page.length };
    } catch (error) {
      return {
        name,
        raised: error instanceof Error ? error.message : String(error),
        assembledLength: null,
      };
    }
  };

  return {
    intact: assemble("nothing removed", shellHtml),
    forced: PAGE_ASSEMBLY_ANCHORS.map((anchor) => assemble(anchor.name, anchor.remove(shellHtml))),
  };
}

/** Register the preview page. It reads the shipped shell and nothing else. */
export function registerSwapTargetPreviewRoutes(app: Hono): void {
  app.get(
    SWAP_TARGET_PREVIEW_ROUTE,
    () =>
      new Response(
        renderSwapTargetPreviewPage(
          readFileSync(resolve(process.cwd(), "public/index.html"), "utf8"),
        ),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
  );
}

function renderAnchorRow(outcome: AnchorOutcome): string {
  const answer =
    outcome.raised === null
      ? `<span data-anchor-assembled>Assembled — ${outcome.assembledLength} characters.</span>`
      : `<span data-anchor-raised>${escapeHtml(outcome.raised)}</span>`;
  return `      <tr>
        <th scope="row">${escapeHtml(outcome.name)}</th>
        <td>${answer}</td>
      </tr>`;
}

export function renderSwapTargetPreviewPage(shellHtml: string): string {
  const { intact, forced } = forceEveryAnchor(shellHtml);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna - loud swap targets</title>
    <link rel="stylesheet" href="/design/styles/index.css">
    <link rel="stylesheet" href="/static/app.css">
    <!-- htmx first: the guard borrows its target resolution rather than guessing at it. -->
    <script defer src="/static/vendor/htmx.min.js"></script>
    <script type="module" src="/static/swap-target-preview.js"></script>
    <style>
      body {
        height: auto;
        min-height: 100dvh;
        max-width: 62rem;
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
        margin: var(--space-5) 0 var(--space-1);
        font-family: var(--font-display);
        font-size: var(--type-lg);
      }
      .preview-view {
        display: block;
        margin: 0;
        padding-block: var(--space-1);
        font-family: var(--font-body);
        font-size: var(--type-sm);
        color: var(--ink-2);
      }
      .preview-table {
        width: 100%;
        margin-block-start: var(--space-2);
        border-collapse: collapse;
        font-family: var(--font-body);
        font-size: var(--type-sm);
        text-align: start;
      }
      .preview-table th,
      .preview-table td {
        padding: var(--space-1) var(--space-2);
        vertical-align: top;
      }
      .preview-table th {
        width: 16rem;
        font-weight: 600;
        white-space: nowrap;
      }
      .preview-table tr:nth-child(odd) td,
      .preview-table tr:nth-child(odd) th {
        background: color-mix(in oklch, var(--shade), transparent 94%);
      }
      [data-anchor-raised] {
        font-family: var(--font-mono, monospace);
        font-size: var(--type-xs);
      }
      .preview-controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        align-items: center;
        margin-block: var(--space-3);
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
      Developer preview. Both halves ship in the product: the assembly anchors are the
      real ones in <code>public/index.html</code>, and the client guard is the shipped
      <code>/static/swap-target.js</code>. Nothing here reads the registry.
    </p>

    <h1 class="preview-title">Every page-assembly anchor fails loudly</h1>
    <p class="preview-view">
      The same assembly, run once with the real shell and once per anchor with that anchor
      taken out. A page that looks assembled and is not is the outcome none of these are
      allowed to produce.
    </p>
    <table class="preview-table" data-anchor-table>
      <tbody>
${[intact, ...forced].map(renderAnchorRow).join("\n")}
      </tbody>
    </table>

    <h1 class="preview-title">A commit or a fragment arriving mid-teardown</h1>
    <p class="preview-view">
      A build subscriber, its <code>commit</code> and <code>fragment</code> listeners, and
      the shipped guard registered over them. Deliver an event while the region is on
      screen and it finds its target. Put the region away first and the same event raises
      — the readout below is the announcement, and the console carries the thrown error.
    </p>

    <div class="preview-controls">
      <button type="button" class="btn" data-preview-deliver="commit">Deliver a commit</button>
      <button type="button" class="btn" data-preview-deliver="fragment">Deliver a fragment</button>
      <button type="button" class="btn" data-preview-away>Put the region away</button>
      <button type="button" class="btn" data-preview-back>Bring the region back</button>
    </div>

    <div data-preview-host></div>

    <h2 class="preview-view">What each delivery did</h2>
    <pre class="preview-readout" data-preview-readout aria-live="polite"></pre>
  </body>
</html>
`;
}
