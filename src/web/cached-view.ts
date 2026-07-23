// Committed capability Views — the platform list scaffolding rendered live from a
// capability's spec (Module 3, epic 3.2/03; ADR-0005 §1, PLAN decision 1).
//
// Opening a committed capability renders the platform list container (3.2/02)
// deterministically from the registry row — no AI, no regeneration, and (since this
// epic) no served `list.html`/`create.html`. The ADR-0004 "never-stale cache" property
// is preserved because data never enters the chrome: records still arrive through the
// capability's `read` action into the container's live region. The generated
// list/create Views are no longer served from here; their *generation* is retired later
// (3.4/02, finalized in 3.7).

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GENERATION_LIFECYCLE_TABLE, listGenerationLifecycles } from "../metrics/index.ts";
import type { RenderableCapability } from "../presentation/field-renderer.ts";
import { type CollectionLayout, renderCollection } from "../presentation/list-container.ts";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  isRegistryInitialized,
  listCapabilities,
} from "../registry/index.ts";
import {
  renderCapabilityCommitSwap,
  renderCapabilityShell,
  renderCapabilitySurface,
  renderRehydratedShell,
} from "./fragments.ts";
import { escapeHtml } from "./html.ts";

const METRICS_PREVIEW_TARGET =
  '<pre class="spec-build__preview" id="spec-metrics-preview" aria-hidden="true"></pre>';

/**
 * The collection layout the container arranges a capability's records in. The
 * registry spec already validated this as the closed `feed | grid` enum, so the
 * platform container can read it directly and still fail closed at spec-generation
 * time if the model invents another value.
 */
function collectionLayoutForRow(row: CapabilityRow): CollectionLayout {
  return row.ui_intent.collection.layout;
}

/**
 * Render a committed capability's platform list scaffolding live from its spec: the
 * "New X" create disclosure, the records region wired to load through `read`, and the
 * empty state — deterministic, no AI, and data-free (ADR-0004). The label is
 * canonicalized so a legacy sentence label never leaks into the chrome.
 */
function renderCapabilityCollection(row: CapabilityRow): string {
  const capability: RenderableCapability = {
    id: row.id,
    label: canonicalCapabilityLabel(row),
    schema: row.schema,
    form: row.ui_intent.form,
    actions: row.tools,
  };
  return renderCollection({
    capability,
    layout: collectionLayoutForRow(row),
    loadThroughRead: true,
  });
}

/** Render the committed capability's platform list scaffolding as a content-area fragment. */
export function renderCachedCapabilitySurface(row: CapabilityRow): string {
  return renderCapabilitySurface(row, renderCapabilityCollection(row));
}

/**
 * Render the fixed shell with the committed capability already active, its toolbar
 * rehydrated from the *whole* registry (read through the given read-only connection) —
 * the same entry set `GET /` restores — so opening or refreshing a capability by URL
 * never drops its siblings from the toolbar.
 */
export function renderCachedCapabilityShell(row: CapabilityRow, database: Database): string {
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderCapabilityShell(
    row,
    listCapabilities(database),
    renderCapabilityCollection(row),
    withLifecycleMetricsPreview(shellHtml, database),
  );
}

/**
 * Seed the developer panel's lifecycle preview into a full-shell page: the latest
 * generation lifecycles plus the committed-version list per capability. Both
 * full-page paths (`GET /` and direct `GET /capability/:id`) share this, so the
 * version history the developer panel shows survives a refresh on either URL.
 */
function withLifecycleMetricsPreview(shellHtml: string, database: Database): string {
  const lifecycleReady = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(GENERATION_LIFECYCLE_TABLE);
  const latest = lifecycleReady ? listGenerationLifecycles(database).slice(0, 5) : [];
  const rows = isRegistryInitialized(database) ? listCapabilities(database) : [];
  const committedVersions = rows.map((row) => ({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    liveVersion: row.version,
    versions: Array.from({ length: row.version }, (_, index) => index + 1),
  }));
  if (latest.length === 0 && committedVersions.length === 0) return shellHtml;
  return shellHtml.replace(
    METRICS_PREVIEW_TARGET,
    `<pre class="spec-build__preview" id="spec-metrics-preview" aria-hidden="true">${escapeHtml(JSON.stringify({ lifecycles: latest, committedVersions }, null, 2))}</pre>`,
  );
}

/**
 * The `GET /` on-load page: the fixed shell with its capability toolbar rehydrated
 * from the registry (one entry per row), read through the given read-only connection.
 * An uninitialized registry — a brand-new platform db, before the first migration —
 * yields the cold-start shell rather than a missing-table error, so the page always
 * renders. No AI and no regeneration: the entries point at the spec-rendered view a
 * click serves.
 */
export function renderRehydratedShellPage(database: Database): string {
  const rows = isRegistryInitialized(database) ? listCapabilities(database) : [];
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderRehydratedShell(rows, withLifecycleMetricsPreview(shellHtml, database));
}

/**
 * Render the commit-time SSE payload: the committed capability's platform list
 * scaffolding plus its canonical toolbar entry as an out-of-band sidecar.
 */
export function renderCachedCapabilityCommitSwap(
  row: CapabilityRow,
  previousLabel?: string,
): string {
  return renderCapabilityCommitSwap(row, renderCapabilityCollection(row), previousLabel);
}
