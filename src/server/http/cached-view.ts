// Committed capability Views — the platform list scaffolding rendered live from a
// capability's spec.
//
// Opening a committed capability renders the platform list container
// deterministically from the registry row: no AI and no regeneration. Data never enters
// the chrome (ADR-0005): records arrive through the capability's `read` action into the
// container's live region.

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pendingDeletionCleanups } from "../../lifecycle/deletion/destruction/cleanup-supervisor.ts";
import {
  GENERATION_LIFECYCLE_TABLE,
  listGenerationLifecycles,
} from "../../platform/metrics/index.ts";
import type { RenderableCapability } from "../../presentation/fields/field-renderer.ts";
import { renderableFromRow } from "../../presentation/index.ts";
import {
  type CollectionLayout,
  renderCollection,
} from "../../presentation/records/collection/list-container.ts";
import {
  type CapabilityRow,
  isRegistryInitialized,
  listCapabilities,
} from "../../registry/index.ts";
import { developerSurfacesEnabled } from "../dev-surfaces/dev-surfaces.ts";
import {
  renderCapabilityCommitSwap,
  renderCapabilitySurface,
  renderRehydratedShell,
} from "./fragments/fragments.ts";
import { escapeHtml } from "./html.ts";

// Matched by id rather than as an exact tag copy: an added attribute in index.html used to make
// this return the shell unchanged, killing the panel's version history with no error anywhere.
const METRICS_SEED_TARGET = /<div\b[^>]*\bid="dev-stage-seed"[^>]*><\/div>/;

/**
 * The collection layout the container arranges a capability's records in. The registry spec
 * validated it as the closed `feed | grid` enum, so the container can read it directly.
 */
function collectionLayoutForRow(row: CapabilityRow): CollectionLayout {
  return row.ui_intent.collection.layout;
}

/**
 * Render a capability's list scaffolding from its spec: the "New X" disclosure, the records region
 * wired through `read`, and the empty state. Deterministic, data-free, label canonicalized.
 */
function renderCapabilityCollection(row: CapabilityRow, catalog: readonly CapabilityRow[]): string {
  const capability: RenderableCapability = renderableFromRow(row, catalog);
  return renderCollection({
    capability,
    layout: collectionLayoutForRow(row),
    loadThroughRead: true,
  });
}

/**
 * Render the committed capability's platform list scaffolding as an in-window fragment. The
 * registry is read for the desk around it, which decides which of its fields are dropdowns.
 */
export function renderCachedCapabilitySurface(row: CapabilityRow, registry: Database): string {
  return renderCachedCapabilitySurfaceIn(row, listCapabilities(registry));
}

/**
 * The collection alone, without the surface that marks it as the capability the window has open:
 * what a deletion's question stands over.
 */
export function renderCachedCapabilityCollection(row: CapabilityRow, registry: Database): string {
  return renderCapabilityCollection(row, listCapabilities(registry));
}

/** The same, against the active catalog a caller already read beside the row, under its token. */
export function renderCachedCapabilitySurfaceIn(
  row: CapabilityRow,
  catalog: readonly CapabilityRow[],
): string {
  return renderCapabilitySurface(row, renderCapabilityCollection(row, catalog));
}

/**
 * Seed the developer panel's lifecycle stage into a full-shell page, shared by both full-page
 * paths. A payload on the page, not into the panel: the panel may not be standing at all.
 */
function withLifecycleMetricsPreview(
  shellHtml: string,
  database: Database,
  catalog?: readonly CapabilityRow[],
): string {
  // The payload is developer furniture: it carries model ids, token counts, stage timings,
  // catalog fingerprints and cleanup-failure strings holding absolute filesystem paths.
  if (!developerSurfacesEnabled()) return shellHtml;
  const lifecycleReady = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(GENERATION_LIFECYCLE_TABLE);
  const latest = lifecycleReady ? listGenerationLifecycles(database).slice(0, 5) : [];
  const rows = catalog ?? (isRegistryInitialized(database) ? listCapabilities(database) : []);
  // A deletion whose durable cleanup is still owed keeps reserving its capability id, so
  // it belongs where a developer can see it rather than only in a boot log line.
  const pendingDeletions = isRegistryInitialized(database) ? pendingDeletionCleanups(database) : [];
  const committedVersions = rows.map((row) => ({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    liveVersion: row.version,
    versions: Array.from({ length: row.version }, (_, index) => index + 1),
  }));
  if (latest.length === 0 && committedVersions.length === 0 && pendingDeletions.length === 0) {
    return shellHtml;
  }
  if (!METRICS_SEED_TARGET.test(shellHtml)) {
    throw new Error("The shell developer-stage seed target is missing.");
  }
  // A replacer function, not a replacement string: the payload carries free-text cleanup errors
  // and model-authored ids, and `$&`, `$\`` and `$'` would splice the document into the panel.
  const seed = `<div id="dev-stage-seed" data-dev-stage-seed="metrics" hidden>${escapeHtml(JSON.stringify({ lifecycles: latest, committedVersions, pendingDeletions }))}</div>`;
  return shellHtml.replace(METRICS_SEED_TARGET, () => seed);
}

/**
 * The on-load page for both addresses that serve one. An uninitialized registry yields an empty
 * desk rather than a missing-table error, and `notice` speaks in the prompt bar.
 */
export function renderRehydratedShellPage(
  database: Database,
  catalog?: readonly CapabilityRow[],
  notice?: string,
): string {
  const rows = catalog ?? (isRegistryInitialized(database) ? listCapabilities(database) : []);
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderRehydratedShell(
    rows,
    withLifecycleMetricsPreview(shellHtml, database, catalog),
    notice,
  );
}

/**
 * Render the commit-time SSE payload: the committed capability's platform list
 * scaffolding plus its canonical logo as an out-of-band sidecar.
 */
export function renderCachedCapabilityCommitSwap(
  row: CapabilityRow,
  registry: Database,
  previousLabel?: string,
): string {
  const collection = renderCapabilityCollection(row, listCapabilities(registry));
  return renderCapabilityCommitSwap(row, collection, previousLabel);
}
