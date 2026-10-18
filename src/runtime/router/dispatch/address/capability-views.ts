// The two places a capability is addressed: its collection, `/capability/:id`, and one of its
// records, `/capability/:id/:record` (design D14; ADR-0010). Both are platform routes
// registered ahead of the Action route, not Actions. The record's segment is matched by shape,
// so the five Action names keep their route. The platform reads a record and draws its form;
// no generated Handler runs, only the card renderers of the capabilities linking to it, for
// the records linking here.

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
  holdingRelations,
} from "../../../../registry/index.ts";
import {
  isInPageRequest,
  NOT_FOUND_NOTICE,
  renderCachedCapabilitySurfaceIn,
  renderCapabilitySurface,
  renderRehydratedShellPage,
} from "../../../../server/http/index.ts";
import { capabilityIncarnation, ReadGateClosingError } from "../../../concurrency/read-gates.ts";
import {
  type CapabilityActionRecord,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
  heldPicks,
} from "../../../data/index.ts";
import {
  type CapabilityCatalogLookup,
  captureCapabilityRead,
} from "../../admission/read-admission.ts";
import {
  assertReadOwnership,
  internalFailure,
  NOT_FOUND_FRAGMENT,
  readUnavailable,
} from "../../wire/failure-responses.ts";
import {
  drawListedRest,
  drawRecordsLinkingHere,
  LISTED_REST_PATH,
  type LinkingDeps,
} from "./records-linking-here.ts";

const COLLECTION_ROUTE = `${CAPABILITY_PATH_PREFIX}/:id`;
const RECORD_ROUTE = `${COLLECTION_ROUTE}/:record{${RECORD_ID_PATTERN}}`;
const LISTED_REST_ROUTE = `${RECORD_ROUTE}${LISTED_REST_PATH}`;

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

/** What both views read through, and what draws the records linking to a record. */
export interface CapabilityViewDeps extends LinkingDeps {
  readonly lookupCapability: CapabilityCatalogLookup | undefined;
  readonly readActiveCatalog: ActiveCatalogReader;
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
  app.get(LISTED_REST_ROUTE, (c) =>
    withCapabilityRead(c, deps, (read) => answerRest(c, deps, read)),
  );
}

/**
 * An address that no longer names anything. A direct navigation loads the bare
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

/**
 * Read the addressed capability under its read token, and answer from it. A deletion that closes
 * it mid-answer refuses the read as one closing before it does.
 */
async function withCapabilityRead(
  c: Context,
  deps: CapabilityViewDeps,
  answer: (read: CapabilityRead) => Response | Promise<Response>,
): Promise<Response> {
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
    return await answer({ row, catalog, signal: tokens.signal });
  } catch (error) {
    if (error instanceof ReadGateClosingError) return readUnavailable(c);
    return internalFailure(c, id, "view", error);
  } finally {
    readGates.release(tokens);
  }
}

function answerCollection(c: Context, deps: CapabilityViewDeps, read: CapabilityRead): Response {
  return answer(c, deps, read, 200, () => renderCachedCapabilitySurfaceIn(read.row, read.catalog));
}

/**
 * One record in its record view, with the records linking to it. A record that is not there
 * answers 404 and the desk opens the collection instead; the notice rides the fragment the desk
 * asks for, so a full page carries none and the bar says it once. A capability without `update`
 * has no record view, and its record address opens the collection unremarked.
 */
async function answerRecord(
  c: Context,
  deps: CapabilityViewDeps,
  read: CapabilityRead,
): Promise<Response> {
  const capability: RenderableCapability = renderableFromRow(read.row, read.catalog);
  if (!hasRecordView(capability)) return answer(c, deps, read, 404, () => "");
  const recordId = (c.req.param("record") ?? "").toLowerCase();
  const { readonly } = deps.databases;
  const record = readAddressedRecord(read.row, recordId, readonly, read.signal);
  if (record === undefined) return answer(c, deps, read, 404, () => NOT_FOUND_FRAGMENT);
  if (!isInPageRequest(c)) return answer(c, deps, read, 200, () => "");
  const abandonOn = c.req.raw.signal;
  const linking = await drawRecordsLinkingHere(deps, { ...read, recordId, abandonOn });
  assertReadOwnership(read.signal);
  // Its Edit form posts again what its linked fields picked.
  const relations = holdingRelations(read.row, read.catalog);
  const links = (id: string) => heldPicks(readonly, read.row.id, id, relations);
  const view = renderPresentedRecordView(capability, record, links, linking);
  return answer(c, deps, read, 200, () => renderCapabilitySurface(read.row, view));
}

/**
 * The rest of one section of records linking here, after the last card it showed, which "Show all"
 * adds to it. A section that cannot be drawn answers 404 with nothing, and a record that cannot be
 * read is refused as any read of it is; "Show all" takes neither as cards. Asked for outside the
 * window, it is no page.
 */
async function answerRest(
  c: Context,
  deps: CapabilityViewDeps,
  read: CapabilityRead,
): Promise<Response> {
  const after = c.req.query("after");
  const last = c.req.query("last");
  if (!isInPageRequest(c) || after === undefined || last === undefined) return c.body(null, 404);
  const recordId = (c.req.param("record") ?? "").toLowerCase();
  const there =
    hasRecordView(renderableFromRow(read.row, read.catalog)) &&
    readAddressedRecord(read.row, recordId, deps.databases.readonly, read.signal) !== undefined;
  const linked = { ...read, recordId, abandonOn: c.req.raw.signal };
  const section = { source: c.req.param("source") ?? "", field: c.req.param("field") ?? "" };
  const rest = there ? await drawListedRest(deps, linked, section, { after, last }) : undefined;
  assertReadOwnership(read.signal);
  return rest === undefined ? c.body(null, 404) : c.html(rest, 200);
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
