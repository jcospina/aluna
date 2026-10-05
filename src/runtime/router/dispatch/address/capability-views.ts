// The two places a capability is addressed: its collection, `/capability/:id`, and one of its
// records, `/capability/:id/:record` (design D14; ADR-0010; Module 7 PLAN decisions 41 to 43).
// Both are platform routes registered ahead of the Action route, not Actions. The record's segment
// is matched by shape, so the five Action names keep their route. The platform reads a record and
// draws it through the adapter that writes a card's `<template>`; no generated Handler runs.

import type { Context, Hono } from "hono";
import { CAPABILITY_PATH_PREFIX, RECORD_ID_PATTERN } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { sqlIdentifier } from "../../../../platform/persistence/sql-identifier.ts";
import {
  hasRecordView,
  type RenderableCapability,
  renderableFromRow,
  renderPresentedRecordView,
} from "../../../../presentation/index.ts";
import {
  type ActiveCatalogReader,
  type CapabilityRow,
  capabilitySpecFromRow,
} from "../../../../registry/index.ts";
import {
  isInPageRequest,
  NOT_FOUND_NOTICE,
  renderCachedCapabilitySurface,
  renderCapabilitySurface,
  renderRehydratedShellPage,
} from "../../../../server/http/index.ts";
import {
  capabilityIncarnation,
  type ReadGateCoordinator,
} from "../../../concurrency/read-gates.ts";
import {
  type CapabilityActionRecord,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
} from "../../../data/index.ts";
import {
  type CapabilityCatalogLookup,
  captureCapabilityRead,
} from "../../admission/read-admission.ts";
import {
  internalFailure,
  NOT_FOUND_FRAGMENT,
  readUnavailable,
} from "../../wire/failure-responses.ts";

const COLLECTION_ROUTE = `${CAPABILITY_PATH_PREFIX}/:id`;
const RECORD_ROUTE = `${COLLECTION_ROUTE}/:record{${RECORD_ID_PATTERN}}`;

/**
 * Every capability address a direct navigation draws the whole desk for. Each with a trailing
 * slash is the same place (design D14): without it, it fell to Hono's bare-text 404 and no shell.
 */
export const CAPABILITY_PAGE_ROUTES = [
  COLLECTION_ROUTE,
  `${COLLECTION_ROUTE}/`,
  RECORD_ROUTE,
  `${RECORD_ROUTE}/`,
] as const;

/** What both views read through. */
export interface CapabilityViewDeps {
  readonly databases: PlatformDatabase;
  readonly lookupCapability: CapabilityCatalogLookup | undefined;
  readonly readActiveCatalog: ActiveCatalogReader;
  readonly readGates: ReadGateCoordinator;
}

/** One capability read under its read token, as both views answer from it. */
interface CapabilityRead {
  readonly row: CapabilityRow;
  readonly catalog: readonly CapabilityRow[];
  readonly signal: AbortSignal;
}

/** Attach both views, ahead of the Action route. */
export function registerCapabilityViews(app: Hono, deps: CapabilityViewDeps): void {
  const [collection, collectionSlash, record, recordSlash] = CAPABILITY_PAGE_ROUTES;
  const viewCollection = (c: Context) =>
    withCapabilityRead(c, deps, (read) => answerCollection(c, deps, read));
  const viewRecord = (c: Context) =>
    withCapabilityRead(c, deps, (read) => answerRecord(c, deps, read));
  app.get(collection, viewCollection);
  app.get(collectionSlash, viewCollection);
  app.get(record, viewRecord);
  app.get(recordSlash, viewRecord);
}

/**
 * An address that no longer names anything (PLAN decision 21). A direct navigation loads the bare
 * desk and opens no window; an `HX-Request` gets a `data-error-code` fragment for the prompt bar.
 */
function missingCapabilityView(
  c: Context,
  databases: PlatformDatabase,
  catalog: readonly CapabilityRow[],
): Response {
  if (isInPageRequest(c)) return c.html(NOT_FOUND_FRAGMENT, 404);
  return c.html(renderRehydratedShellPage(databases.readonly, catalog, NOT_FOUND_NOTICE), 404, {
    "cache-control": "no-store",
  });
}

/** Read the addressed capability under its read token, and answer from it. */
function withCapabilityRead(
  c: Context,
  deps: CapabilityViewDeps,
  answer: (read: CapabilityRead) => Response,
): Response {
  const { databases, readGates } = deps;
  const id = c.req.param("id");
  // Hono routes no empty segment onto `:id`, so this guards rather than paths. It answers the
  // way the `!row` branch does: an address with nothing where the name goes names nothing.
  if (!id) return missingCapabilityView(c, databases, []);
  const captured = captureCapabilityRead(
    id,
    undefined,
    databases.readonly,
    deps.readActiveCatalog,
    deps.lookupCapability,
  );
  const { catalog, row } = captured;
  if (!row) return missingCapabilityView(c, databases, catalog);

  const tokens = readGates.tryAcquire({
    catalog: catalog.map(capabilityIncarnation),
    incarnations: captured.incarnations,
  });
  if (!tokens) return readUnavailable(c);
  try {
    return answer({ row, catalog, signal: tokens.signal });
  } catch (error) {
    return internalFailure(c, id, "view", error);
  } finally {
    readGates.release(tokens);
  }
}

function answerCollection(c: Context, deps: CapabilityViewDeps, read: CapabilityRead): Response {
  return answer(c, deps, read, 200, () => renderCachedCapabilitySurface(read.row));
}

/**
 * One record in its record view. A record that is not there answers 404 and the desk opens the
 * collection instead; the notice rides the fragment the desk asks for, so a full page carries
 * none and the bar says it once. A capability without `update` has no record view, and its
 * record address opens the collection unremarked.
 */
function answerRecord(c: Context, deps: CapabilityViewDeps, read: CapabilityRead): Response {
  const capability: RenderableCapability = renderableFromRow(read.row);
  if (!hasRecordView(capability)) return answer(c, deps, read, 404, () => "");
  const recordId = (c.req.param("record") ?? "").toLowerCase();
  const record = readAddressedRecord(read.row, recordId, deps.databases.readonly, read.signal);
  if (record === undefined) return answer(c, deps, read, 404, () => NOT_FOUND_FRAGMENT);
  return answer(c, deps, read, 200, () =>
    renderCapabilitySurface(read.row, renderPresentedRecordView(capability, record)),
  );
}

/**
 * The fragment for the window, or the whole desk for a direct navigation: the desk alone, since
 * the client opens the window from the address. `no-store`: the page names logo addresses served
 * `immutable` for a year.
 */
function answer(
  c: Context,
  deps: CapabilityViewDeps,
  read: CapabilityRead,
  status: 200 | 404,
  fragment: () => string,
): Response {
  if (isInPageRequest(c)) return c.html(fragment(), status);
  return c.html(renderRehydratedShellPage(deps.databases.readonly, read.catalog), status, {
    "cache-control": "no-store",
  });
}

/**
 * The one row, read by `id` from the capability's own table, so a record of another capability
 * is simply not there. Narrowed by the query port as every collection read is.
 */
function readAddressedRecord(
  row: CapabilityRow,
  recordId: string,
  database: PlatformDatabase["readonly"],
  signal: AbortSignal,
): CapabilityActionRecord | undefined {
  const target = capabilitySpecFromRow(row);
  const { tableName } = deriveCapabilityTableDdl(target);
  const [found] = createCapabilityQueryPort(database, { target, signal }).records({
    sql: `SELECT "id" AS "target_id" FROM ${sqlIdentifier(tableName)} WHERE "id" = ?`,
    parameters: [recordId],
  });
  return found?.record;
}
