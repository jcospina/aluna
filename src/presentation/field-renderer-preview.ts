// Dev preview for the centralized field renderer (epic 3.2/01) — the human visual
// sign-off surface this issue's HITL gate requires. Served at `/demo/field-renderer`
// (src/app.ts), it runs the REAL renderer (renderCreateForm / renderDetailFields)
// against a sample spec exercising every M2 pantry type, so what a reviewer eyeballs
// is exactly what the platform will emit — not a hand-copied mock that could drift.
//
// This is a developer surface, not product UI (ARCH §9.7): the page chrome and the
// modal/list stand-ins are preview-only and themselves consume the design tokens; the
// create form and detail display inside them are the live module output, unmodified.

import { escapeHtml } from "../web/html.ts";
import {
  type RenderableCapability,
  renderCreateForm,
  renderDetailFields,
} from "./field-renderer.ts";

/**
 * A friendly sample capability covering every pantry type. The fields (and their
 * `required` flags) stand in for what the AI would author in a real spec — they are
 * not platform-imposed. `urgent` is an *optional* boolean (a natural checkbox at
 * create); `due_on` is a `date` (a calendar day picker) while `remind_at` is a
 * `datetime` (a moment) — the two temporal types side by side.
 */
export const PREVIEW_CAPABILITY: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  schema: {
    fields: [
      { name: "title", type: "string", required: true },
      { name: "priority", type: "number", required: true },
      { name: "urgent", type: "boolean", required: false },
      { name: "due_on", type: "date", required: true },
      { name: "remind_at", type: "datetime", required: false },
      { name: "note", type: "string", required: false },
    ],
  },
};

/** A filled record — shows each type's detail formatting, including a multi-line value. */
const PREVIEW_RECORD: Readonly<Record<string, unknown>> = {
  title: "Buy oat milk",
  priority: 2,
  urgent: true,
  due_on: "2026-07-05",
  remind_at: "2026-07-05T09:30",
  note: "Get the barista edition if they have it.\nOtherwise the regular is fine.",
};

/** A sparser record — shows the absent-value placeholder on two optional fields. */
const PREVIEW_RECORD_SPARSE: Readonly<Record<string, unknown>> = {
  title: "Renew library books",
  priority: 1,
  urgent: false,
  due_on: "2026-07-09",
  remind_at: null,
  note: null,
};

/**
 * Build the full preview page. Loads the same authored token + chrome layer the app
 * serves (so the controls are on-brand by construction) and drops the live create
 * form and two live detail displays into modal/panel stand-ins for the reviewer.
 */
export function renderFieldRendererPreviewPage(): string {
  const createForm = renderCreateForm(PREVIEW_CAPABILITY);
  const detailFilled = renderDetailFields(PREVIEW_CAPABILITY, PREVIEW_RECORD);
  const detailSparse = renderDetailFields(PREVIEW_CAPABILITY, PREVIEW_RECORD_SPARSE);
  const fieldSummary = PREVIEW_CAPABILITY.schema.fields
    .map(
      (field) => `${escapeHtml(field.name)}: ${field.type}${field.required ? "" : " (optional)"}`,
    )
    .join(" · ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna — field renderer preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <style>
      body {
        /* base.css sets html,body { height:100% } for the shell's fixed-viewport
           flex layout; this preview is a normal scrolling document, so override it
           to grow with content — otherwise overflowing content spills past the
           fixed-height box and the padding-bottom gutter is stranded at the fold. */
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
      /* Stand-in for the 3.2/04 modal and 3.2/02 container — a plain surface panel so
         the live form/detail sit where they eventually will. Preview-only chrome. */
      .preview-panel {
        padding: var(--space-3);
        background: var(--color-surface);
        border: var(--border-thin) solid var(--color-border);
        border-radius: var(--radius-md);
      }
      .preview-panel + .preview-panel {
        margin-top: var(--space-2);
      }
    </style>
  </head>
  <body>
    <p class="preview-banner">
      Dev preview · epic 3.2/01 centralized field renderer. The create form and detail
      displays below are live <code>renderCreateForm</code> / <code>renderDetailFields</code>
      output for a sample spec — <strong>${fieldSummary}</strong>. HTMX submit is inert here
      (no capability is built); this page is for on-brand / completeness sign-off only.
    </p>

    <section class="preview-section">
      <h2 class="preview-title">Create controls</h2>
      <p class="preview-note">
        One control per field, from a total switch over the pantry: text · number
        (decimal) · inline checkbox · date · datetime-local. Required fields are marked;
        the optional <code>urgent</code>/<code>note</code> are not, and a required boolean
        is never force-checked. Wiring (hx-post, close-on-success) is baked in.
      </p>
      <div class="preview-panel">${createForm}</div>
    </section>

    <section class="preview-section">
      <h2 class="preview-title">Read-only detail</h2>
      <p class="preview-note">
        The same fields as read-only display — Yes/No for boolean, a semantic
        <code>&lt;time&gt;</code> for date and datetime, and the “—” placeholder for absent values.
      </p>
      <div class="preview-panel">${detailFilled}</div>
      <div class="preview-panel">${detailSparse}</div>
    </section>
  </body>
</html>`;
}
