// Dev preview for the item click-to-open → read-only detail modal (epic 3.3/02) — the
// human visual sign-off surface this issue's HITL gate requires. Served at
// `/demo/detail-interaction` (src/app.ts), it runs the WHOLE real path end to end, no
// stand-in: a hand-written item renderer composes each record's inner markup → the runtime
// enforcer runs on it (as the 3.4 adapter will) → renderItemWrapper frames it with the
// platform trigger + escaped `data-item` + its detail hooks → renderCollection arranges the
// items → each record also emits its inert detail <template> (renderDetailContentTemplate,
// honoring `detail.shows`) → the REAL controllers (detail-modal.js + item-detail.js) turn a
// click or keypress into the shared modal opening prefilled read-only.
//
// This is the detail interaction the user performs. Clicking (or Tab + Enter/Space on) any
// item opens the one shared <dialog> showing the full record via the centralized field
// renderer — even when the card truncates — with NO read-single route (the record's detail
// was materialized at render time and is cloned on open, ADR-0005 §3).
//
// `detail.shows` is deliberately a reordered subset of the schema (see PREVIEW_CAPABILITY):
// the modal must show exactly those fields, in that order — visibly different from both the
// card's own composition and the schema order — proving the detail surface honors the intent.
//
// Developer surface, not product UI (ARCH §9.7): the page chrome is preview-only and itself
// consumes the design tokens; everything inside the list + modal is live module output.

import { escapeHtml } from "../web/html.ts";
import { renderDetailContentTemplate, renderDetailModal } from "./detail-modal.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { renderCollection, renderItemWrapper } from "./list-container.ts";

/**
 * A friendly sample capability. Its `detail.shows` reorders and subsets the schema —
 * `title, rating, note, author` (schema order is `title, author, rating, finished, note`) —
 * so the modal both drops `finished` and reorders the rest, making the "honors detail.shows,
 * not spec order" property something a reviewer can see at a glance.
 */
const PREVIEW_CAPABILITY: RenderableCapability = {
  id: "reading",
  label: "Reading list",
  schema: {
    fields: [
      { name: "title", type: "string", required: true },
      { name: "author", type: "string", required: true },
      { name: "rating", type: "number", required: true },
      { name: "finished", type: "boolean", required: false },
      { name: "note", type: "string", required: false },
    ],
  },
  detail: { shows: ["title", "rating", "note", "author"] },
};

// A `type` (not `interface`) so it carries an implicit index signature and passes to both
// renderItemWrapper's and renderDetailContentTemplate's `Record<string, unknown>`.
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
    note: "Winter, envoys, and the slow thaw of understanding. The one I reread — and the card only shows the first couple of lines, but the modal shows the whole note.",
  },
  {
    title: "A Memory Called Empire",
    author: "Arkady Martine",
    rating: 4,
    finished: false,
    // A sparse record: the absent note shows the “—” placeholder in the detail modal.
    note: null,
  },
  {
    // A hostile record: script / tags / quotes must show as visible TEXT in both the card
    // and the modal — never execute. Nothing should pop.
    title: '"><script>alert(1)</script> & <img src=x onerror=alert(2)>',
    author: "<b>Not a real author</b>",
    rating: 3,
    finished: true,
    note: 'A value with <b>tags</b>, an & ampersand, and a "quote" — all text, never markup.',
  },
];

/**
 * The hand-written item renderer (no AI yet) — one record → capability-specific inner
 * markup, composed only from the primitive vocabulary (public/css/primitives.css) and
 * escaping every field value on the way in. `line-clamp-2` truncates the note in the card;
 * the modal then proves the full note still shows. This is what the generated item renderer
 * produces in 3.4; here it is authored by hand so the click-to-open path is exercisable now.
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

/**
 * Every record wrapped the real way: hand-written render → enforce → wrap with the detail
 * hooks, each immediately followed by its inert detail <template> (the emission shape the
 * 3.4 read adapter produces, so a created/loaded record carries its detail with it). The
 * template id is derived per record and passed on the wrapper so the click controller can
 * open the matching detail.
 */
function itemsWithDetail(): string {
  return PREVIEW_RECORDS.map((record, index) => {
    const templateId = `detail-${PREVIEW_CAPABILITY.id}-${index}`;
    const inner = enforceItemMarkup(renderReadingItem(record));
    const item = renderItemWrapper(inner, record, {
      templateId,
      title: PREVIEW_CAPABILITY.label,
    });
    const template = renderDetailContentTemplate(templateId, PREVIEW_CAPABILITY, record);
    return item + template;
  }).join("");
}

/**
 * Build the full preview page. Loads the same authored token + chrome layer the app serves
 * (so the list + modal are on-brand by construction) and the REAL controllers, drops the
 * live `renderCollection` output + the one shared modal in, and lets a click/keypress open it.
 */
export function renderDetailInteractionPreviewPage(): string {
  const list = renderCollection({
    capability: PREVIEW_CAPABILITY,
    layout: "feed",
    items: itemsWithDetail(),
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna — detail interaction preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <!-- Alpine drives the container's "New X" disclosure (inline x-data). -->
    <script defer src="/static/vendor/alpine.min.js"></script>
    <!-- The REAL shared-modal mechanics + the REAL item click-to-open — the same files the
         shell loads. Together they turn an item click/keypress into the modal opening. -->
    <script defer src="/static/detail-modal.js"></script>
    <script defer src="/static/item-detail.js"></script>
    <style>
      body {
        /* Normal scrolling document, not the shell's fixed-viewport box (design-system.md). */
        height: auto;
        min-height: 100dvh;
        max-width: 44rem;
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
    </style>
  </head>
  <body>
    <p class="preview-banner">
      Dev preview · epic 3.3/02 item click-to-open → read-only detail modal. The list below is
      live <code>renderCollection</code> / <code>renderItemWrapper</code> output; each record
      also carries its inert detail <code>&lt;template&gt;</code>. <strong>Click</strong> any
      item (or Tab to it and press <strong>Enter</strong>/<strong>Space</strong>) to open the
      one shared read-only modal, prefilled from that record — no round-trip, no read-single
      route. This capability's <code>detail.shows</code> is
      <code>[title, rating, note, author]</code>, so the modal shows exactly those fields in
      that order — it drops <code>finished</code> and reorders the rest, unlike the card's own
      composition and the schema order. Hostile values render as text in both. Focus is trapped
      while open and returns to the item on close (native <code>showModal()</code>); Escape, the
      ✕, and a backdrop click all close it.
    </p>

    <section class="preview-section">
      <h2 class="preview-title">Reading list</h2>
      <p class="preview-note">
        Full record · sparse (the “—” placeholder on the absent note) · hostile (script / tags
        / quotes show as <em>text</em>). The first note is truncated in the card
        (<code>line-clamp-2</code>) but shows in full in the modal.
      </p>
      ${list}
    </section>

    <!-- The one shared modal instance (renderDetailModal) — reused by every item. -->
    ${renderDetailModal()}
  </body>
</html>`;
}
