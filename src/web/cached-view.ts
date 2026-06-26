// Cached capability views — server-side reading of committed data-free HTML.
//
// The builder writes generated `list.html` and `create.html` files into a
// version-namespaced artifacts directory. These helpers read those cached files
// back and compose them into the active content-area surface. No AI call and no
// regeneration happen here.

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CapabilityRow, isRegistryInitialized, listCapabilities } from "../registry/index.ts";
import {
  renderCapabilityCommitSwap,
  renderCapabilityShell,
  renderCapabilitySurface,
  renderRehydratedShell,
} from "./fragments.ts";

interface CachedCapabilityViews {
  readonly listView: string;
  readonly createView: string;
}

function readCachedCapabilityViews(row: CapabilityRow): CachedCapabilityViews {
  const versionDirectory = resolve(process.cwd(), row.artifacts_path);
  return {
    listView: readFileSync(resolve(versionDirectory, "list.html"), "utf8"),
    createView: readFileSync(resolve(versionDirectory, "create.html"), "utf8"),
  };
}

/** Render the committed capability's cached list view plus create form. */
export function renderCachedCapabilitySurface(row: CapabilityRow): string {
  const { listView, createView } = readCachedCapabilityViews(row);
  return renderCapabilitySurface(row, listView, createView);
}

/** Render the fixed shell with the committed capability already active. */
export function renderCachedCapabilityShell(row: CapabilityRow): string {
  const { listView, createView } = readCachedCapabilityViews(row);
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderCapabilityShell(row, listView, createView, shellHtml);
}

/**
 * The `GET /` on-load page: the fixed shell with its capability toolbar rehydrated
 * from the registry (one entry per row), read through the given read-only connection.
 * An uninitialized registry — a brand-new platform db, before the first migration —
 * yields the cold-start shell rather than a missing-table error, so the page always
 * renders. No AI and no regeneration: the entries point at the cached-view route a
 * click serves.
 */
export function renderRehydratedShellPage(database: Database): string {
  const rows = isRegistryInitialized(database) ? listCapabilities(database) : [];
  const shellHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  return renderRehydratedShell(rows, shellHtml);
}

/**
 * Render the commit-time SSE payload: cached content surface plus canonical toolbar
 * entry as an out-of-band sidecar.
 */
export function renderCachedCapabilityCommitSwap(row: CapabilityRow): string {
  const { listView, createView } = readCachedCapabilityViews(row);
  return renderCapabilityCommitSwap(row, listView, createView);
}
