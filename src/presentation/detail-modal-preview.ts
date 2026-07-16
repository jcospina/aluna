// Dev preview for the shared read-only detail modal (epic 3.2/04) — the human visual
// sign-off surface this issue's HITL gate requires. Served at `/demo/detail-modal`
// (src/app.ts), it runs the REAL modal module: renderDetailModal() emits the one shared
// <dialog>, renderDetailContentTemplate() materializes each record's detail through the
// centralized field renderer (3.2/01), and the REAL controller (/static/detail-modal.js)
// prefills + opens it — so a reviewer eyeballs exactly what the platform will emit.
//
// The only preview-authored code is the row of **dev triggers**: each dispatches the
// same `aluna:open-detail` event 3.3/02's item click-to-open will dispatch, so this
// exercises the whole open → prefill → focus-trap → close → focus-restore path without
// the generic item wiring (which is 3.3/02). The records cover every pantry type, a
// hostile value (escaping is visible), and a long/multi-line value (the body scrolls and
// keeps its bottom gutter).
//
// Developer surface, not product UI (ARCH §9.7): the page chrome is preview-only and
// itself consumes the design tokens; the modal and its content are live module output.

import { escapeHtml } from "../web/html.ts";
import {
  OPEN_DETAIL_EVENT,
  renderDetailContentTemplate,
  renderDetailModal,
} from "./detail-modal.ts";
import type { RenderableCapability } from "./field-renderer.ts";

/** A friendly sample capability covering every pantry type — the same shape the field
 *  renderer preview uses, so the two HITL surfaces stay comparable. */
const PREVIEW_CAPABILITY: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "priority", label: "Priority", type: "number", required: true, lifecycle: "active" },
      { name: "urgent", label: "Urgent", type: "boolean", required: false, lifecycle: "active" },
      { name: "due_on", label: "Due on", type: "date", required: true, lifecycle: "active" },
      {
        name: "remind_at",
        label: "Remind at",
        type: "datetime",
        required: false,
        lifecycle: "active",
      },
      { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
      { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [{ field: "tags", mode: "repeatable" }] },
};

/** One dev trigger + the record its detail template holds. */
interface PreviewCase {
  readonly templateId: string;
  readonly title: string;
  readonly buttonLabel: string;
  readonly record: Readonly<Record<string, unknown>>;
}

const PREVIEW_CASES: readonly PreviewCase[] = [
  {
    templateId: "detail-tpl-filled",
    title: "Tasks",
    buttonLabel: "Open a full record",
    record: {
      id: "filled",
      title: "Buy oat milk",
      priority: 2,
      urgent: true,
      due_on: "2026-07-05",
      remind_at: "2026-07-05T09:30",
      note: "Get the barista edition if they have it.\nOtherwise the regular is fine.",
      tags: ["errands", "one,two", "today"],
    },
  },
  {
    templateId: "detail-tpl-sparse",
    title: "Tasks",
    buttonLabel: "Open a sparse record",
    record: {
      id: "sparse",
      title: "Renew library books",
      priority: 1,
      urgent: false,
      due_on: "2026-07-09",
      remind_at: null,
      note: null,
      tags: null,
    },
  },
  {
    templateId: "detail-tpl-hostile",
    title: "Tasks",
    buttonLabel: "Open a hostile record",
    record: {
      id: "hostile",
      title: '"><script>alert(1)</script> & <img src=x onerror=alert(2)>',
      priority: 9,
      urgent: true,
      due_on: "2026-07-10",
      remind_at: "2026-07-10T23:59",
      note: 'Value with <b>tags</b>, an & ampersand, and a "quote" — all must show as text.',
      tags: ['<script>alert("tag")</script>', "safe"],
    },
  },
  {
    templateId: "detail-tpl-long",
    title: "Tasks",
    buttonLabel: "Open a long record",
    record: {
      id: "long",
      title: "Plan the week",
      priority: 3,
      urgent: false,
      due_on: "2026-07-12",
      remind_at: "2026-07-12T08:00",
      // A deliberately long, multi-line value: the body must scroll and keep its gutter.
      note: Array.from(
        { length: 24 },
        (_v, i) => `Line ${i + 1}: something to remember about this week's plan.`,
      ).join("\n"),
      tags: ["planning", "weekly"],
    },
  },
];

/** The row of dev triggers. Each carries the template id + title the inline script reads
 *  to dispatch the open event; they are the only preview-authored interactive bits. */
function renderTriggers(): string {
  const buttons = PREVIEW_CASES.map(
    (preview) =>
      `<button type="button" class="btn btn--primary" data-open-detail="${preview.templateId}"` +
      ` data-detail-title="${escapeHtml(preview.title)}">${escapeHtml(preview.buttonLabel)}</button>`,
  ).join("");
  return `<div class="preview-triggers">${buttons}</div>`;
}

/** All detail templates the modal clones from — live renderDetailContentTemplate output. */
function renderTemplates(): string {
  return PREVIEW_CASES.map((preview) =>
    renderDetailContentTemplate(preview.templateId, PREVIEW_CAPABILITY, preview.record),
  ).join("");
}

/**
 * Build the full preview page. Loads the same authored token + chrome layer the app serves
 * (so the modal is on-brand by construction) and the REAL controller, drops the one shared
 * modal instance + the record templates in, and wires the dev triggers to the open event.
 */
export function renderDetailModalPreviewPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna — detail modal preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <!-- The REAL shared-modal controller — the same file the shell will load. -->
    <script defer src="/static/detail-modal.js"></script>
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
      .preview-triggers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
    </style>
  </head>
  <body>
    <p class="preview-banner">
      Dev preview · epic 3.2/04 shared read-only detail modal. The buttons below are
      preview-only <strong>dev triggers</strong>; each dispatches the same
      <code>${OPEN_DETAIL_EVENT}</code> event that 3.3/02's item click-to-open will fire.
      Everything they open is live <code>renderDetailModal</code> /
      <code>renderDetailContent</code> output prefilled into the one shared
      <code>&lt;dialog&gt;</code>. Focus is trapped inside while open and returns to the
      button on close (native <code>showModal()</code>); Escape, the ✕, and a backdrop
      click all close it.
    </p>

    <section class="preview-section">
      <h2 class="preview-title">Open the detail modal</h2>
      <p class="preview-note">
        Full record (every pantry type) · sparse (the “—” placeholder) · hostile (script /
        tags / quotes must show as <em>text</em>) · long (the body scrolls, the gutter holds).
        Try the mouse and the keyboard (Tab to a button, Enter) — then Tab inside the open
        modal and confirm focus never leaves it.
      </p>
      ${renderTriggers()}
    </section>

    <!-- The one shared modal instance (renderDetailModal) — reused by every trigger. -->
    ${renderDetailModal()}

    <!-- Each record's detail, materialized through the centralized field renderer and held
         inert in a <template> until the modal clones it on open (no read-single route). -->
    ${renderTemplates()}

    <script>
      // The dev triggers (this issue) — NOT the generic item click-to-open (that is 3.3/02).
      // Each button dispatches the open event with its template id + title; the real
      // controller (/static/detail-modal.js) does the prefill + showModal from there.
      (function () {
        document.querySelectorAll("[data-open-detail]").forEach(function (button) {
          button.addEventListener("click", function () {
            document.dispatchEvent(
              new CustomEvent(${JSON.stringify(OPEN_DETAIL_EVENT)}, {
                detail: {
                  title: button.getAttribute("data-detail-title") || "",
                  sourceId: button.getAttribute("data-open-detail") || "",
                },
              }),
            );
          });
        });
      })();
    </script>
  </body>
</html>`;
}
