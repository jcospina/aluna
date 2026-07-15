// Dev preview for the list scaffolding container + accessible item wrapper (epic
// 3.2/02) — the human visual sign-off surface this issue's HITL gate requires. Served
// at `/demo/list-container` (src/app.ts), it runs the REAL platform modules
// (renderCollection / renderItemWrapper) so a reviewer eyeballs exactly what the
// platform will emit, in BOTH closed collection layouts.
//
// The round-trip demonstrated is the real one: a **hand-written** item renderer (no AI
// yet) turns each record into inner markup using the primitive vocabulary → the runtime
// enforcer runs on it (standing in for the 3.4/01 presentation adapter; conforming
// markup passes through unchanged) → renderItemWrapper frames it → renderCollection
// arranges the wrapped items as `feed` and `grid`. The empty state and the "New X"
// disclosure (opening the live create form) are shown too. Clicking an item pops its
// escaped `data-item` payload back — a stand-in for the 3.2/04 detail modal — proving
// the payload survives escaping and round-trips through the browser parser.
//
// Developer surface, not product UI (ARCH §9.7): the page chrome is preview-only and
// itself consumes the design tokens; everything inside the panels is live module output.

import { escapeHtml } from "../web/html.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { renderCollection, renderItemWrapper } from "./list-container.ts";

/** A friendly sample capability. Its schema drives the live create form the "New X"
 *  disclosure opens; its records feed the hand-written item renderer below. */
const PREVIEW_CAPABILITY: RenderableCapability = {
  id: "reading",
  label: "Reading list",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "author", label: "Author", type: "string", required: true, lifecycle: "active" },
      { name: "rating", label: "Rating", type: "number", required: true, lifecycle: "active" },
      {
        name: "finished",
        label: "Finished",
        type: "boolean",
        required: false,
        lifecycle: "active",
      },
      { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [] },
};

// A `type` (not `interface`) so it carries an implicit index signature and passes to
// renderItemWrapper's `Record<string, unknown>` — the record a real capability hands the
// wrapper is exactly this kind of plain keyed object.
type ReadingRecord = {
  readonly title: string;
  readonly author: string;
  readonly rating: number;
  readonly finished: boolean;
  readonly note: string | null;
};

const PREVIEW_RECORDS: readonly ReadingRecord[] = [
  {
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    rating: 5,
    finished: true,
    note: "Winter, envoys, and the slow thaw of understanding. The one I reread.",
  },
  {
    title: "Piranesi",
    author: "Susanna Clarke",
    rating: 4,
    finished: true,
    note: "Tides through endless marble halls; a mind keeping itself company.",
  },
  {
    title: "A Memory Called Empire",
    author: "Arkady Martine",
    rating: 5,
    finished: false,
    note: null,
  },
];

/**
 * The **hand-written** item renderer (no AI yet) — one record → capability-specific
 * inner markup, composed only from the primitive vocabulary (public/css/primitives.css)
 * and escaping every field value on the way in. This is what the generated item renderer
 * produces in 3.4; here it is authored by hand to prove the platform round-trip before
 * any generation exists.
 */
function renderReadingItem(record: ReadingRecord): string {
  const title = escapeHtml(record.title);
  const author = escapeHtml(record.author);
  const stars = escapeHtml("★".repeat(record.rating) + "☆".repeat(Math.max(0, 5 - record.rating)));
  const status = record.finished ? "Finished" : "Reading";
  const note = record.note
    ? `<p class="line-clamp-2 text-sm text-subtle">${escapeHtml(record.note)}</p>`
    : "";

  return (
    `<div class="stack">` +
    `<span class="text-lg text-bold truncate">${title}</span>` +
    `<div class="cluster text-sm text-muted">` +
    `<span class="truncate">${author}</span>` +
    `<span aria-hidden="true">·</span>` +
    `<span aria-label="Rated ${record.rating} of 5">${stars}</span>` +
    `<span aria-hidden="true">·</span>` +
    `<span class="text-xs">${status}</span>` +
    `</div>` +
    note +
    `</div>`
  );
}

/** Wrap every sample record the real way: hand-written render → enforce → wrap. */
function wrappedItems(): string {
  return PREVIEW_RECORDS.map((record) =>
    renderItemWrapper(enforceItemMarkup(renderReadingItem(record)), record),
  ).join("");
}

/**
 * Build the full preview page. Loads the same authored token + chrome layer the app
 * serves (so the container/wrapper are on-brand by construction), then drops the live
 * `renderCollection` output — feed, grid, and empty — into preview panels, plus a
 * click-to-open stand-in for the 3.2/04 modal.
 */
export function renderListContainerPreviewPage(): string {
  const items = wrappedItems();
  const feed = renderCollection({ capability: PREVIEW_CAPABILITY, layout: "feed", items });
  const grid = renderCollection({ capability: PREVIEW_CAPABILITY, layout: "grid", items });
  const empty = renderCollection({ capability: PREVIEW_CAPABILITY, layout: "feed" });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna — list container preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <!-- Alpine drives the "New X" disclosure (inline x-data); nothing else here needs it. -->
    <script defer src="/static/vendor/alpine.min.js"></script>
    <style>
      body {
        /* Normal scrolling document, not the shell's fixed-viewport box: grow with
           content so the bottom gutter is never stranded at the fold (design-system.md). */
        height: auto;
        min-height: 100dvh;
        max-width: 52rem;
        margin-inline: auto;
        padding: var(--space-4) var(--space-3);
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
      /* The detail stand-in for the 3.2/04 modal — a plain dialog showing the parsed
         data-item payload, proving click-to-open + the escaped payload round-trip. */
      .preview-detail::backdrop {
        background: color-mix(in oklch, var(--color-text), transparent 60%);
      }
      .preview-detail {
        max-width: 32rem;
        padding: var(--space-3);
        color: var(--color-text);
        background: var(--color-surface);
        border: var(--border-thin) solid var(--color-border);
        border-radius: var(--radius-md);
      }
      .preview-detail__title {
        margin: 0 0 var(--space-1);
        font: var(--h3);
      }
      .preview-detail__body {
        margin: 0;
        font: var(--type-sm) / 1.5 ui-monospace, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .preview-detail__close {
        margin-top: var(--space-2);
      }
    </style>
  </head>
  <body>
    <p class="preview-banner">
      Dev preview · epic 3.2/02 list scaffolding + item wrapper. The lists below are live
      <code>renderCollection</code> / <code>renderItemWrapper</code> output. A
      <strong>hand-written</strong> item renderer turns each record into inner markup, the
      runtime enforcer runs on it (as the 3.4 adapter will — conforming markup passes
      unchanged), the wrapper frames it, and the container arranges the same wrapped items
      as <strong>feed</strong> and <strong>grid</strong>. Click any item to see its escaped
      <code>data-item</code> payload round-trip. Create-form submit is inert here.
    </p>

    <section class="preview-section">
      <h2 class="preview-title">Feed layout</h2>
      <p class="preview-note">
        Single-column <code>collection.layout: "feed"</code> (the default until 3.3/01).
        Open “New Reading list” to see the live create form the container discloses.
      </p>
      ${feed}
    </section>

    <section class="preview-section">
      <h2 class="preview-title">Grid layout</h2>
      <p class="preview-note">
        The <em>same</em> wrapped items arranged as <code>collection.layout: "grid"</code>
        — a responsive auto-fill grid for visually dominant data.
      </p>
      ${grid}
    </section>

    <section class="preview-section">
      <h2 class="preview-title">Empty state</h2>
      <p class="preview-note">
        A container with no records — the empty state shows automatically while the records
        region is <code>:empty</code>.
      </p>
      ${empty}
    </section>

    <dialog class="preview-detail" id="preview-detail">
      <h2 class="preview-detail__title">Item payload</h2>
      <pre class="preview-detail__body" id="preview-detail-body"></pre>
      <form method="dialog">
        <button class="btn btn--neutral preview-detail__close" type="submit">Close</button>
      </form>
    </dialog>

    <script>
      // Click-to-open stand-in for the 3.2/04 detail modal. Reading data-item via the DOM
      // proves the escaped attribute round-trips through the real browser parser back to
      // the exact record. (Also neutralizes the inert create-form submit.)
      (function () {
        var dialog = document.getElementById("preview-detail");
        var body = document.getElementById("preview-detail-body");
        function openItem(el) {
          body.textContent = JSON.stringify(JSON.parse(el.getAttribute("data-item")), null, 2);
          dialog.showModal();
        }
        document.addEventListener("click", function (e) {
          var item = e.target.closest && e.target.closest(".capability-item");
          if (item) openItem(item);
        });
        document.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " ") return;
          var item = e.target.closest && e.target.closest(".capability-item");
          if (item) {
            e.preventDefault();
            openItem(item);
          }
        });
        document.addEventListener("submit", function (e) {
          // The create form's HTMX post is inert in this preview (no capability is built).
          if (e.target && e.target.classList.contains("capability-create-form")) e.preventDefault();
        });
      })();
    </script>
  </body>
</html>`;
}
