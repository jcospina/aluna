// The deterministic capability router (ARCH §6.2 router,
// ADR-0004 consequences). The generated UI never invents routes: it targets the
// one fixed convention `/capability/:id/:action`, and the router loads and runs
// the matching handler. **Routing is never an AI concern**.
//
// For each request the router, in order:
//
//   1. Looks up the registry row and validates `:action` against the row's
//      declared `tools` — an unknown capability or an undeclared action fails
//      cleanly, in product voice, **before any handler code is loaded**.
//   2. Parses the closed Action-specific wire contract, including the reserved
//      record target for update/delete, before generated code loads.
//   3. Builds the platform context: parsed input (form/query — the
//      handler never touches raw HTTP), the capability- or record-bound mutation
//      port for write Actions, and the physically read-only free-query port.
//   4. Loads the handler for that action from the version directory the row's
//      `artifacts_path` points to.
//   5. Invokes the handler's single default-exported async function and wraps the
//      returned HTML fragment in the HTTP response — the platform owns headers,
//      status, and routing.
//
// A handler that throws (or any internal slip) surfaces a warm, product-voice
// failure; the precise cause is logged for the developer, never leaked to the UI
// (CONTEXT.md "Product voice", ARCH §9.7).

import type { Context, Hono } from "hono";

import {
  assertSubmittedFieldValues,
  ChoiceDisabledError,
  InvalidChoiceError,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  RecordNotFoundError,
} from "../capability-data/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../mutation-coordinator/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "../persistence/db.ts";
import {
  createReadGateCoordinator,
  ReadGateClosingError,
  type ReadGateCoordinator,
} from "../read-gates/index.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  readActiveRegistryCatalog,
} from "../registry/index.ts";
import {
  NOT_FOUND_NOTICE,
  renderCachedCapabilitySurface,
  renderRehydratedShellPage,
} from "../web/index.ts";
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
} from "./failure-responses.ts";
import { invokeCapabilityHandler } from "./handler-invocation.ts";
import { answerWithHandlerFragment } from "./handler-response.ts";
import {
  type ActiveCatalogReader,
  type CapturedCapabilityRead,
  capabilityIncarnation,
  captureCapabilityRead,
} from "./read-admission.ts";
import {
  type ParsedCapabilityRequest,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "./wire-protocol.ts";

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

// The fixed route and complete M4 method/Action matrix. Every capability declares
// the complete fixed five-Action inventory, and this matrix admits
// exactly the method/Action pairs below; any other pair fails before code loads.
const CAPABILITY_ROUTE = "/capability/:id/:action";
const CAPABILITY_VIEW_ROUTE = "/capability/:id";
/**
 * The same address with a trailing slash, which is the same place.
 *
 * The desk has always said so — `capabilityIdFromAddress` (`public/desk-address.js`) reads
 * the id straight through one — and the server had not, so a hand-typed or bookmarked
 * `/capability/notes/` fell past every route in this file to Hono's own bare-text 404:
 * no shell, no styles, nothing to go back to, whether or not the capability existed. One
 * address that names a capability, spelled two ways (design D14).
 */
const CAPABILITY_VIEW_TRAILING_SLASH_ROUTE = "/capability/:id/";
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
  // Hono routes no empty segment onto `:id`, so this is a guard rather than a path — and
  // it answers the way the `!row` branch below does, because an address with nothing where
  // the name goes names nothing, exactly as an address naming something gone does.
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
    // A direct navigation renders the whole desk and nothing composed into it: the window
    // is the client's to create, so it opens over the logo this address names and asks for
    // the fragment above. The row is still read first, because a 404 has to be a 404
    // before a desk is drawn for it.
    //
    // The full page names every logo's incarnation-keyed address, and those addresses are
    // served `immutable` for a year. A cached copy of this page is the one way that
    // guarantee is defeated without the logo route being wrong, so it is never stored —
    // the same reason `/` sets it.
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
 * An address that no longer names anything — a bookmark, a second tab, a reload after the
 * capability it named was deleted, or a link that was never right (PLAN decision 21).
 *
 * A direct navigation loads the bare desk and says why on the prompt bar, in the slot the
 * bar already has. It opens no window: the served desk carries no logo for that id, and
 * `addressAsks` (`public/desk-window.js`) answers an address naming nothing that is
 * standing with the bare desk. So this case adds no window state and no third notice
 * component — there is nothing to design inside a window for a capability that is gone.
 *
 * An `HX-Request` is a different question and keeps a fragment: it is a press on a tile in
 * a desk that is already up, and answering it with a whole page would swap a document into
 * a window. That fragment says the same sentence and carries `data-error-code`, so the
 * shell lifts it onto the same prompt bar the page above seeds — a second tab's press on a
 * tile the other tab deleted is answered rather than swallowed.
 *
 * Still a 404. The status is about the capability the address names, which is genuinely
 * not there; the desk in the body is what the person gets *instead*, not a claim that the
 * address was good. `no-store` for the same reason `/` sets it: the page names every
 * logo's incarnation-keyed address, and those are served `immutable` for a year.
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

  // The whole request body is read here — before a read token, before the write lease, and
  // before `BEGIN IMMEDIATE`. It used to be read from inside the handler scope, which meant
  // a client that opened a POST and dribbled its body held the record-write lease, an open
  // immediate transaction and a read token for as long as it cared to: every record write on
  // every capability refused, every build queued, and the capability undeletable, because the
  // drain waits for a reader that is waiting for a socket. Nothing is held while this awaits.
  const spec = capabilitySpecFromRow(row);
  let parsedRequest: ParsedCapabilityRequest;
  try {
    parsedRequest = await parseCapabilityRequest(c.req.raw, action, spec);
    // The two structural refusals the platform owns the answer to — an undeclared choice
    // value and an over-long string — are settled here, before any generated code loads.
    // They used to be reachable only through the mutation port, so a Handler that caught
    // one could have answered 200 where the platform authored a 422; three documents said
    // this ran before the Handler and none of it did.
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
    // A read is abandoned the moment its reader goes away. That is the server half of
    // the content region's release rule: the client's abort *is* the read-token release,
    // rather than a second mechanism that has to agree with one.
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
    // Ownership first, then the lease — and in that order for a reason. A Handler the
    // deadline abandoned is still running, and its mutation port only refuses once this
    // route's read ownership is revoked. Handing the lease back first opened a window in
    // which the next request's `BEGIN IMMEDIATE` was live and the abandoned write, seeing
    // `database.inTransaction`, joined *that* transaction instead of being refused. The
    // outer scope releases the same tokens again; release is by identity and idempotent.
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
  // Everything past validation is the build-and-run path: a throw anywhere in it —
  // handler loading, handler execution, or a contract violation — becomes one warm,
  // internals-free failure. The request itself was already parsed, before anything was held.
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
    return answerWithHandlerFragment(c, id, spec, action, fragment);
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
  // Nobody is listening for this one. Answering at all is a formality; what matters is
  // that the route stopped waiting, so its `finally` has already handed the read tokens
  // back. 499 is the conventional "client closed request".
  if (error instanceof CapabilityReadAbandonedError) {
    return new Response(null, { status: 499 });
  }
  return internalFailure(c, id, action, error);
}

// Whether the action is one the capability actually declares it can do. `tools` is
// the validated allow-list (registry spec); a request for anything outside it is
// refused the same as a request for a capability that doesn't exist.
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
