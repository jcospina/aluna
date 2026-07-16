// Developer preview for the few-shot gallery injection (Module 3, epic 3.5).
//
// Served at `/demo/few-shot-gallery`, this is a HITL sign-off surface for the
// repo-only examples and the prompt section injected into item-renderer generation.
// The examples remain builder guidance; this route is a developer preview, not a
// product shell surface.

import { createPlatformPresentationAdapter } from "../presentation/adapter.ts";
import { renderDetailModal } from "../presentation/detail-modal.ts";
import { renderCollection } from "../presentation/list-container.ts";
import { escapeHtml } from "../web/html.ts";
import {
  buildItemRendererDesignInjection,
  FEW_SHOT_DESIGN_EXAMPLES,
  type FewShotDesignExample,
} from "./few-shot-gallery.ts";

function renderedExample(example: FewShotDesignExample): string {
  let previewIndex = 0;
  const present = createPlatformPresentationAdapter({
    capability: example.capability,
    renderItem: () => {
      const previewInnerHtml = example.previewSamples[previewIndex]?.previewInnerHtml;
      previewIndex += 1;
      if (previewInnerHtml === undefined) {
        throw new Error(`Missing few-shot preview HTML for ${example.id}:${previewIndex - 1}`);
      }
      return previewInnerHtml;
    },
  });

  return renderCollection({
    capability: example.capability,
    layout: example.layout,
    items: example.previewSamples.map((sample) => present(sample.record)).join(""),
  });
}

function exampleSection(example: FewShotDesignExample): string {
  const notes = example.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  return `
    <section class="preview-section gallery-example">
      <div class="gallery-example__meta">
        <p class="gallery-example__layout">${escapeHtml(example.layout)}</p>
        <h2 class="preview-title">${escapeHtml(example.title)}</h2>
        <p class="preview-note">${escapeHtml(example.suitedFor)}</p>
        <p class="preview-note">${escapeHtml(example.composition)}</p>
        <ul class="gallery-example__notes">${notes}</ul>
      </div>
      <div class="gallery-example__rendered">
        ${renderedExample(example)}
      </div>
      <details class="gallery-example__source">
        <summary>item.ts exemplar</summary>
        <pre><code>${escapeHtml(example.rendererSource)}</code></pre>
      </details>
    </section>`;
}

export function renderFewShotGalleryPreviewPage(): string {
  const examples = FEW_SHOT_DESIGN_EXAMPLES.map(exampleSection).join("");
  const feedInjection = buildItemRendererDesignInjection("feed");
  const gridInjection = buildItemRendererDesignInjection("grid");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna - few-shot gallery preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <script defer src="/static/vendor/alpine.min.js"></script>
    <script type="module" src="/static/detail-modal.js"></script>
    <script defer src="/static/item-detail.js"></script>
    <style>
      body {
        height: auto;
        min-height: 100dvh;
        max-width: 68rem;
        margin-inline: auto;
        padding: var(--space-4) var(--space-3) var(--space-8);
      }
      .preview-banner {
        margin: 0 0 var(--space-4);
        padding: var(--space-1) var(--space-2);
        font: var(--meta);
        color: var(--color-text-muted);
        background: color-mix(in oklch, var(--color-accent), transparent 90%);
        border-radius: var(--radius-sm);
      }
      .preview-section {
        margin-block: var(--space-6);
      }
      .preview-title {
        margin: 0 0 var(--space-1);
        font: var(--h3);
      }
      .preview-note {
        margin: 0 0 var(--space-2);
        font: var(--meta);
        color: var(--color-text-subtle);
      }
      .gallery-example {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(18rem, 1.1fr);
        gap: var(--space-3);
        align-items: start;
      }
      .gallery-example__layout {
        display: inline-flex;
        margin: 0 0 var(--space-1);
        padding: var(--space-0_5) var(--space-1);
        font: var(--meta);
        color: var(--color-text);
        border: var(--border-thin) solid var(--color-border);
        border-radius: var(--radius-pill);
      }
      .gallery-example__notes {
        margin: var(--space-2) 0 0;
        padding-left: var(--space-2);
        font: var(--meta);
        color: var(--color-text-muted);
      }
      .gallery-example__rendered .capability-collection__header,
      .gallery-example__rendered .capability-empty,
      .gallery-example__rendered .capability-collection__create {
        display: none;
      }
      .gallery-example__source {
        grid-column: 1 / -1;
      }
      .gallery-example__source summary {
        cursor: pointer;
        font: var(--meta);
        color: var(--color-text-muted);
      }
      .gallery-example__source pre,
      .prompt-preview pre {
        max-height: 24rem;
        overflow: auto;
        padding: var(--space-2);
        font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--color-text);
        white-space: pre-wrap;
        background: color-mix(in oklch, var(--color-text), transparent 96%);
        border: var(--border-thin) solid var(--color-border);
        border-radius: var(--radius-md);
      }
      .prompt-preview {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-3);
      }
      @media (max-width: 760px) {
        .gallery-example,
        .prompt-preview {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <p class="preview-banner">
      Dev preview - epic 3.5 few-shot gallery and item-renderer prompt injection.
      The rendered samples below pass through the real presentation adapter, enforcer,
      item wrapper, collection container, and shared detail modal hooks. The prompt
      previews show the exact LLM-facing injection section, including "vary, don't copy"
      framing and the selected <code>collection.layout</code>.
    </p>

    ${examples}

    <section class="preview-section">
      <h2 class="preview-title">Injected prompt preview</h2>
      <p class="preview-note">
        The builder appends one of these sections to the item-renderer prompt before the
        capability spec JSON. The examples are repo-only and are not fetched from a
        runtime design tool.
      </p>
      <div class="prompt-preview">
        <div>
          <h3 class="preview-title">feed</h3>
          <pre><code>${escapeHtml(feedInjection)}</code></pre>
        </div>
        <div>
          <h3 class="preview-title">grid</h3>
          <pre><code>${escapeHtml(gridInjection)}</code></pre>
        </div>
      </div>
    </section>
    ${renderDetailModal()}
  </body>
</html>`;
}
