// Committed capability Views — the platform list scaffolding rendered live from a
// capability's spec.
//
// Opening a committed capability renders the platform list container
// deterministically from the registry row — no AI, no regeneration, and (since this
// epic) no served `list.html`/`create.html`. The ADR-0004 "never-stale cache" property
// is preserved because data never enters the chrome: records still arrive through the
// capability's `read` action into the container's live region. The generated
// list/create Views are no longer served from here; their *generation* is retired later
// (finalized by unit generation).

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pendingDeletionCleanups } from "../../lifecycle/deletion/destruction/cleanup-supervisor.ts";
import {
  GENERATION_LIFECYCLE_TABLE,
  listGenerationLifecycles,
} from "../../platform/metrics/index.ts";
import type { RenderableCapability } from "../../presentation/fields/field-renderer.ts";
import {
  type CollectionLayout,
  renderCollection,
} from "../../presentation/records/list-container.ts";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  isRegistryInitialized,
  listCapabilities,
} from "../../registry/index.ts";
import { developerSurfacesEnabled } from "../dev-surfaces/dev-surfaces.ts";
import {
  renderCapabilityCommitSwap,
  renderCapabilitySurface,
  renderRehydratedShell,
} from "./fragments.ts";
import { escapeHtml } from "./html.ts";

// Matched by id rather than as an exact tag copy: an attribute added to that element in
// index.html used to make this silently return the shell unchanged, killing the developer
// panel's version history with no error anywhere.
const METRICS_SEED_TARGET = /<div\b[^>]*\bid="dev-stage-seed"[^>]*><\/div>/;

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
 * empty state — deterministic, no AI, and data-free. The label is
 * canonicalized so a legacy sentence label never leaks into the chrome.
 */
function renderCapabilityCollection(row: CapabilityRow): string {
  const capability: RenderableCapability = {
    id: row.id,
    label: canonicalCapabilityLabel(row),
    noun: row.noun,
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

/** Render the committed capability's platform list scaffolding as an in-window fragment. */
export function renderCachedCapabilitySurface(row: CapabilityRow): string {
  return renderCapabilitySurface(row, renderCapabilityCollection(row));
}

/**
 * Seed the developer panel's lifecycle stage into a full-shell page: the latest
 * generation lifecycles plus the committed-version list per capability. Both
 * full-page paths (`GET /` and direct `GET /capability/:id`) share this, so the
 * version history the developer panel shows survives a refresh on either URL.
 *
 * Written as a payload on the page rather than into the panel, because the panel is a
 * window the client creates and may not be standing at all. It is pretty-printed where
 * it is shown rather than here: the panel formats every stage the same way, and one
 * stage arriving pre-indented would be the only one it could not.
 */
function withLifecycleMetricsPreview(
  shellHtml: string,
  database: Database,
  catalog?: readonly CapabilityRow[],
): string {
  // The payload is developer furniture, and the last thing the guard holds back now that
  // nothing is served under `/demo`: it carries model ids, token counts, stage timings,
  // catalog fingerprints and cleanup-failure strings holding absolute filesystem paths,
  // and it was embedded in every page a user loads.
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
  // A replacer function, not a replacement string: the payload carries free-text cleanup
  // errors and model-authored ids, and `$&`, `$\`` and `$'` in a replacement *string* are
  // substitution patterns that would splice the surrounding document into the panel.
  const seed = `<div id="dev-stage-seed" data-dev-stage-seed="metrics" hidden>${escapeHtml(JSON.stringify({ lifecycles: latest, committedVersions, pendingDeletions }))}</div>`;
  return shellHtml.replace(METRICS_SEED_TARGET, () => seed);
}

/**
 * The on-load page, for both addresses that serve one: the fixed shell with its logo
 * layer rehydrated from the registry (one logo per row), read through the given
 * read-only connection. An uninitialized registry — a brand-new platform db, before
 * the first migration — yields an empty desk rather than a missing-table error, so the
 * page always renders. No AI and no regeneration: the logos point at the spec-rendered
 * view a click serves.
 *
 * `/capability/:id` renders exactly this page rather than one with that capability
 * composed into it. The window is created by the client, so there is nowhere on the
 * served page to compose a collection into; the client opens the window over the logo
 * the address names and asks for the same fragment a click on that logo asks for. What
 * a direct navigation still owes is the *whole* desk — every sibling logo, not just the
 * addressed one — which is why the caller may hand in the catalog it already read
 * rather than this reading the registry a second time under different tokens.
 *
 * `notice` is the one thing a load can arrive already having to say: an address naming a
 * capability that is not on the desk gets this same page with that sentence in the prompt
 * bar's slot, and no window (PLAN decision 21).
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
  previousLabel?: string,
): string {
  return renderCapabilityCommitSwap(row, renderCapabilityCollection(row), previousLabel);
}
