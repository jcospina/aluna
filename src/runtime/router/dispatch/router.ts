// The deterministic capability router (ARCH §6.2, ADR-0004). The generated UI invents no
// routes: it targets the one convention `/capability/:id/:action`, and the router loads and
// runs the matching handler. Routing is never an AI concern.
//
// The router validates `:action` against the registry row's declared `tools` before any handler
// code loads, so an unknown capability or an undeclared action fails cleanly in product voice. It
// then parses the closed per-Action wire contract, builds the platform context — parsed input,
// the mutation port, the physically read-only free-query port — loads the handler from the version
// directory `artifacts_path` names, invokes its default export, and wraps the fragment in the
// response. A handler that throws surfaces a warm failure; the cause is logged for the developer
// and never leaked to the UI (CONTEXT.md, ARCH §9.7).

import type { Context, Hono } from "hono";
import { CAPABILITY_PATH_PREFIX } from "#shell/routes.js";
import { db, dbReadonly, type PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  type ActiveCatalogReader,
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  readActiveRegistryCatalog,
} from "../../../registry/index.ts";
import {
  NOT_FOUND_NOTICE,
  renderCachedCapabilitySurface,
  renderRehydratedShellPage,
} from "../../../server/http/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../concurrency/mutation-coordinator.ts";
import {
  capabilityIncarnation,
  createReadGateCoordinator,
  ReadGateClosingError,
  type ReadGateCoordinator,
} from "../../concurrency/read-gates.ts";
import {
  assertSubmittedFieldValues,
  ChoiceDisabledError,
  InvalidChoiceError,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  RecordNotFoundError,
} from "../../data/index.ts";
import {
  CapabilityReadAbandonedError,
  DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS,
  defaultLoadHandler,
  defaultLoadItemRenderer,
  type HandlerLoader,
  type ItemRendererLoader,
  withHandlerDeadline,
} from "./generated-code.ts";

// Re-exported so the router stays the one public face of its subsystem.
export {
  DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS,
  type HandlerLoader,
  ITEM_RENDERER_FILE,
  type ItemRendererLoader,
} from "./generated-code.ts";

import { type CapturedCapabilityRead, captureCapabilityRead } from "../admission/read-admission.ts";
import { collectionCountSidecar } from "../wire/collection-count.ts";
import {
  assertReadOwnership,
  choiceDisabledFailure,
  internalFailure,
  invalidChoiceFailure,
  maxLengthExceededFailure,
  missingRequiredFieldsFailure,
  NOT_FOUND_FRAGMENT,
  readUnavailable,
  recordMutationRefusal,
  recordNotFoundFailure,
  WIRE_PROTOCOL_ERROR_FRAGMENT,
} from "../wire/failure-responses.ts";
import { answerWithHandlerFragment } from "../wire/handler-response.ts";
import {
  type ParsedCapabilityRequest,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "../wire/wire-protocol.ts";
import { invokeCapabilityHandler } from "./handler-invocation.ts";

/**
 * Registry lookup seam. Production uses the validated registry store; route tests
 * inject the coming five-Action shape before it is admitted/persisted.
 */
export type CapabilityLookup = (
  id: string,
  database: PlatformDatabase["readonly"],
) => CapabilityRow | null;

export interface CapabilityRouterDeps {
  // The read-write / read-only pair the lookup and split data ports ride.
  // Defaults to the platform singletons; tests inject a scratch pair.
  readonly databases?: PlatformDatabase;
  // Defaults to {@link defaultLoadHandler}.
  readonly loadHandler?: HandlerLoader;
  // Defaults to {@link defaultLoadItemRenderer}.
  readonly loadItemRenderer?: ItemRendererLoader;
  // Defaults to the validated registry lookup.
  readonly lookupCapability?: CapabilityLookup;
  // One immutable active-registry snapshot for target + dependency admission.
  readonly readActiveCatalog?: ActiveCatalogReader;
  // Shared atomic admission for every route mutation; reads never acquire it.
  readonly mutationCoordinator?: MutationCoordinator;
  // Shared per-incarnation read ownership for routes and later deletion.
  readonly readGates?: ReadGateCoordinator;
  // How long a generated Handler may run before the route abandons it. Defaults to
  // {@link DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS}; tests shorten it to prove the bound.
  readonly handlerTimeoutMs?: number;
}

// The fixed route and the complete five-Action method/Action matrix. Every capability declares
// all five, and a pair outside this matrix fails before any code loads.
const CAPABILITY_ROUTE = `${CAPABILITY_PATH_PREFIX}/:id/:action`;
const CAPABILITY_VIEW_ROUTE = `${CAPABILITY_PATH_PREFIX}/:id`;
/**
 * The same address with a trailing slash, which is the same place (design D14). Without this
 * route `/capability/notes/` fell past every route here to Hono's bare-text 404: no shell.
 */
const CAPABILITY_VIEW_TRAILING_SLASH_ROUTE = `${CAPABILITY_VIEW_ROUTE}/`;
const METHOD_BY_ACTION = {
  create: "POST",
  delete: "POST",
  read: "GET",
  search: "GET",
  update: "POST",
} as const satisfies Record<WireProtocolAction, "GET" | "POST">;

/**
 * Attach the capability router to the app (called from createApp). Generated code
 * reaches the platform only through what this builds — never the Hono context.
 */
export function registerCapabilityRoutes(app: Hono, deps: CapabilityRouterDeps = {}): void {
  const databases = deps.databases ?? { readwrite: db, readonly: dbReadonly };
  const loadHandler = deps.loadHandler ?? defaultLoadHandler;
  const loadItemRenderer = deps.loadItemRenderer ?? defaultLoadItemRenderer;
  const lookupCapability = deps.lookupCapability;
  const readActiveCatalog = deps.readActiveCatalog ?? readActiveRegistryCatalog;
  const mutationCoordinator = deps.mutationCoordinator ?? createMutationCoordinator();
  const readGates = deps.readGates ?? createReadGateCoordinator();
  const handlerTimeoutMs = deps.handlerTimeoutMs ?? DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS;

  const view = (c: Context) =>
    handleCapabilityViewRequest(c, databases, lookupCapability, readActiveCatalog, readGates);
  app.get(CAPABILITY_VIEW_ROUTE, view);
  app.get(CAPABILITY_VIEW_TRAILING_SLASH_ROUTE, view);
  // Catch every HTTP method here so a wrong pair receives the same warm product
  // boundary instead of falling through to Hono's generic 404 response.
  app.all(CAPABILITY_ROUTE, (c) =>
    handleCapabilityRequest(
      c,
      databases,
      loadHandler,
      loadItemRenderer,
      lookupCapability,
      readActiveCatalog,
      mutationCoordinator,
      readGates,
      handlerTimeoutMs,
    ),
  );
}

function handleCapabilityViewRequest(
  c: Context,
  databases: PlatformDatabase,
  lookupCapability: CapabilityLookup | undefined,
  readActiveCatalog: ActiveCatalogReader,
  readGates: ReadGateCoordinator,
): Response {
  const id = c.req.param("id");
  // Hono routes no empty segment onto `:id`, so this guards rather than paths. It answers the
  // way the `!row` branch does: an address with nothing where the name goes names nothing.
  if (!id) {
    return missingCapabilityView(c, databases, []);
  }

  const captured = captureCapabilityRead(
    id,
    undefined,
    databases.readonly,
    readActiveCatalog,
    lookupCapability,
  );
  const { catalog, row } = captured;
  if (!row) {
    return missingCapabilityView(c, databases, catalog);
  }

  const tokens = readGates.tryAcquire({
    catalog: catalog.map(capabilityIncarnation),
    incarnations: captured.incarnations,
  });
  if (!tokens) return readUnavailable(c);

  try {
    if (c.req.header("HX-Request") === "true") return c.html(renderCachedCapabilitySurface(row));
    // A direct navigation renders the desk alone; the client opens the window over the logo this
    // address names. `no-store`: the page names logo addresses served `immutable` for a year.
    return c.html(renderRehydratedShellPage(databases.readonly, catalog), 200, {
      "cache-control": "no-store",
    });
  } catch (error) {
    return internalFailure(c, id, "view", error);
  } finally {
    readGates.release(tokens);
  }
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
  if (c.req.header("HX-Request") === "true") return c.html(NOT_FOUND_FRAGMENT, 404);
  return c.html(renderRehydratedShellPage(databases.readonly, catalog, NOT_FOUND_NOTICE), 404, {
    "cache-control": "no-store",
  });
}

async function handleCapabilityRequest(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  lookupCapability: CapabilityLookup | undefined,
  readActiveCatalog: ActiveCatalogReader,
  mutationCoordinator: MutationCoordinator,
  readGates: ReadGateCoordinator,
  handlerTimeoutMs: number,
): Promise<Response> {
  const target = routableTarget(c);
  if (!target) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }
  const { id, action } = target;

  // Validate against the registry row's declared tools *before* loading any code.
  // An unknown capability (no row) or an undeclared action both fail here, cleanly.
  let captured: CapturedCapabilityRead;
  try {
    captured = captureCapabilityRead(
      id,
      action,
      databases.readonly,
      readActiveCatalog,
      lookupCapability,
    );
  } catch (error) {
    return internalFailure(c, id, action, error);
  }
  const { catalog, dependencies, row } = captured;
  if (!row || !isDeclaredAction(row, action)) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  // The body is read here — before a read token, the write lease and `BEGIN IMMEDIATE`. Read in
  // the handler scope, a client dribbling a POST body held all three for as long as it cared to.
  const spec = capabilitySpecFromRow(row);
  let parsedRequest: ParsedCapabilityRequest;
  try {
    parsedRequest = await parseCapabilityRequest(c.req.raw, action, spec);
    // The two refusals the platform owns — an undeclared choice value, an over-long string —
    // settle before any generated code loads, so a Handler cannot catch one and answer 200.
    if (action === "create" || action === "update") {
      assertSubmittedFieldValues(
        row.id,
        activeSpecFields(spec.schema.fields),
        parsedRequest.input.values,
        action,
      );
    }
  } catch (error) {
    return capabilityHandlerFailure(c, row.id, action, error);
  }

  const tokens = readGates.tryAcquire({
    catalog: catalog.map(capabilityIncarnation),
    incarnations: captured.incarnations,
  });
  if (!tokens) return readUnavailable(c, row.id, action);

  try {
    if (isMutationAction(action)) {
      return await handleRecordMutation(
        c,
        databases,
        loadHandler,
        loadItemRenderer,
        mutationCoordinator,
        row,
        spec,
        parsedRequest,
        dependencies,
        action,
        tokens.signal,
        () => readGates.release(tokens),
        handlerTimeoutMs,
      );
    }
    // A read is abandoned the moment its reader goes away: the client's abort *is* the read-token
    // release, rather than a second mechanism that has to agree with one.
    return await executeCapabilityHandler(
      c,
      databases,
      loadHandler,
      loadItemRenderer,
      row,
      spec,
      parsedRequest,
      dependencies,
      action,
      tokens.signal,
      handlerTimeoutMs,
      c.req.raw.signal,
    );
  } finally {
    readGates.release(tokens);
  }
}

async function handleRecordMutation(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  mutationCoordinator: MutationCoordinator,
  row: CapabilityRow,
  spec: CapabilitySpec,
  parsedRequest: ParsedCapabilityRequest,
  dependencies: readonly CapabilityRow[],
  action: MutationAction,
  signal: AbortSignal,
  releaseOwnership: () => void,
  handlerTimeoutMs: number,
): Promise<Response> {
  const mutationLease = mutationCoordinator.tryAcquireRecordWrite();
  if (!mutationLease) return recordMutationRefusal(c, row.id, action);

  let transactionOpen = false;
  try {
    databases.readwrite.exec("BEGIN IMMEDIATE TRANSACTION");
    transactionOpen = true;
    const response = await executeCapabilityHandler(
      c,
      databases,
      loadHandler,
      loadItemRenderer,
      row,
      spec,
      parsedRequest,
      dependencies,
      action,
      signal,
      handlerTimeoutMs,
      undefined,
    );
    databases.readwrite.exec(response.ok ? "COMMIT" : "ROLLBACK");
    transactionOpen = false;
    return response;
  } catch (error) {
    if (transactionOpen) databases.readwrite.exec("ROLLBACK");
    throw error;
  } finally {
    // Ownership first, then the lease: an abandoned Handler's mutation port refuses only once read
    // ownership is revoked, and lease-first let its write join the next request's transaction.
    releaseOwnership();
    mutationCoordinator.release(mutationLease);
  }
}

async function executeCapabilityHandler(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  row: CapabilityRow,
  spec: CapabilitySpec,
  parsedRequest: ParsedCapabilityRequest,
  dependencies: readonly CapabilityRow[],
  action: WireProtocolAction,
  signal: AbortSignal,
  handlerTimeoutMs: number,
  abandonOn: AbortSignal | undefined,
): Promise<Response> {
  const { id } = row;
  // Everything past validation is the build-and-run path: a throw in it — handler loading,
  // handler execution, a contract violation — becomes one warm, internals-free failure.
  try {
    assertReadOwnership(signal);
    // Bounded: a Handler that never settles must not pin this route's read tokens,
    // because that would make the capability permanently undeletable.
    const fragment = await withHandlerDeadline(
      invokeCapabilityHandler(
        databases,
        loadHandler,
        loadItemRenderer,
        row,
        spec,
        dependencies,
        action,
        parsedRequest,
        signal,
      ),
      handlerTimeoutMs,
      id,
      action,
      abandonOn,
    );
    if (typeof fragment !== "string") {
      throw new TypeError(
        `Handler ${id}/${action} returned ${typeof fragment}; the contract requires an HTML string.`,
      );
    }
    return answerWithHandlerFragment(c, id, spec, action, fragment, (html) =>
      collectionCountSidecar({
        spec,
        databases,
        signal,
        noun: row.noun,
        action,
        fragment: html,
      }),
    );
  } catch (error) {
    return capabilityHandlerFailure(c, id, action, error);
  }
}

/**
 * One warm, internals-free answer for everything the build-and-run path can throw.
 *
 * @param error anything raised past validation — input parsing, handler loading, handler
 * execution, or a contract violation
 */
function capabilityHandlerFailure(
  c: Context,
  id: string,
  action: WireProtocolAction,
  error: unknown,
): Response {
  if (error instanceof WireProtocolError) {
    return c.html(WIRE_PROTOCOL_ERROR_FRAGMENT, 400);
  }
  if (error instanceof MissingRequiredFieldsError) {
    return missingRequiredFieldsFailure(c, id, error);
  }
  if (error instanceof InvalidChoiceError) {
    return invalidChoiceFailure(c, id, error);
  }
  if (error instanceof ChoiceDisabledError) {
    return choiceDisabledFailure(c, id, error);
  }
  if (error instanceof MaxLengthExceededError) {
    return maxLengthExceededFailure(c, id, error);
  }
  if (error instanceof RecordNotFoundError) {
    return recordNotFoundFailure(c, id, action, error);
  }
  if (error instanceof ReadGateClosingError) {
    return readUnavailable(c, id, action);
  }
  // Nobody is listening. What matters is that the route stopped waiting, so its `finally` has
  // already handed the read tokens back; 499 is the conventional "client closed request".
  if (error instanceof CapabilityReadAbandonedError) {
    return new Response(null, { status: 499 });
  }
  return internalFailure(c, id, action, error);
}

// Whether the capability declares this action. `tools` is the validated allow-list; a request
// outside it is refused the same as one for a capability that doesn't exist.
function isDeclaredAction(row: CapabilityRow, action: string): boolean {
  return (row.tools as readonly string[]).includes(action);
}

type MutationAction = "create" | "update" | "delete";

function isMutationAction(action: WireProtocolAction): action is MutationAction {
  return action === "create" || action === "update" || action === "delete";
}

function hasExpectedMethod(action: string, method: string): action is WireProtocolAction {
  return action in METHOD_BY_ACTION && METHOD_BY_ACTION[action as WireProtocolAction] === method;
}

function routableTarget(
  c: Context,
): { readonly id: string; readonly action: WireProtocolAction } | undefined {
  const id = c.req.param("id");
  const action = c.req.param("action");
  // The route pattern normally binds both. The action allow-list and method are
  // one contract, so reject a miss or wrong pair before any registry/code access.
  if (!id || !action || !hasExpectedMethod(action, c.req.method)) return undefined;
  return { id, action };
}
