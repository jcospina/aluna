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

import type { RenderableCapability } from "../presentation/field-renderer.ts";
import {
  type CollectionLayout,
  DEFAULT_COLLECTION_LAYOUT,
  renderCollection,
} from "../presentation/list-container.ts";
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

/**
 * The collection layout the container arranges a capability's records in. 3.3/01
 * authors `ui_intent.collection.layout`; until it lands every capability defaults to
 * `feed` (PLAN decision 5). Kept as the single seam that reads the spec value once it
 * exists, so that change touches exactly one line here.
 */
function collectionLayoutForRow(_row: CapabilityRow): CollectionLayout {
  return DEFAULT_COLLECTION_LAYOUT;
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

/** Render the fixed shell with the committed capability already active. */
export function renderCachedCapabilityShell(row: CapabilityRow): string {
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderCapabilityShell(row, renderCapabilityCollection(row), shellHtml);
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
  return renderRehydratedShell(rows, shellHtml);
}

/**
 * Render the commit-time SSE payload: the committed capability's platform list
 * scaffolding plus its canonical toolbar entry as an out-of-band sidecar.
 */
export function renderCachedCapabilityCommitSwap(row: CapabilityRow): string {
  return renderCapabilityCommitSwap(row, renderCapabilityCollection(row));
}
