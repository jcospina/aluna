// The deterministic capability router — Module 2, Epic 2.3 (ARCH §6.2 router,
// ADR-0004 consequences). The generated UI never invents routes: it targets the
// one fixed convention `/capability/:id/:action`, and the router loads and runs
// the matching handler. **Routing is never an AI concern** (ARCH §6.2).
//
// For each request the router, in order:
//
//   1. Looks up the registry row and validates `:action` against the row's
//      declared `tools` — an unknown capability or an undeclared action fails
//      cleanly, in product voice, **before any handler code is loaded**.
//   2. Parses the closed Action-specific wire contract, including the reserved
//      record target for update/delete, before generated code loads.
//   3. Builds the platform context (ADR-0004): parsed input (form/query — the
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

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context, Hono } from "hono";

import {
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  MissingRequiredFieldsError,
  RecordNotFoundError,
} from "../capability-data/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "../db.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../mutation-coordinator/index.ts";
import {
  capabilityCreateErrorId,
  capabilityEditErrorId,
  createPresentationAdapter,
  type ItemRenderer,
  type PresentationAdapter,
  type RenderableCapability,
} from "../presentation/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  getCapability,
  resolveActionReadDependencies,
} from "../registry/index.ts";
import { renderCachedCapabilityShell, renderCachedCapabilitySurface } from "../web/index.ts";
import type {
  CapabilityCreateHandler,
  CapabilityDeleteHandler,
  CapabilityHandler,
  CapabilityReadHandler,
  CapabilityUpdateHandler,
} from "./contract.ts";
import {
  type ParsedCapabilityRequest,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "./wire-protocol.ts";

// How the router turns a row's `artifacts_path` + an action into a runnable
// handler. Injectable so the gate (2.5) and tests can substitute loading without
// touching disk; the default loads the real version-keyed file.
export type HandlerLoader = (artifactsPath: string, action: string) => Promise<CapabilityHandler>;

// How the router turns a row's `artifacts_path` into that capability's item renderer —
// the composition input for its presentation adapter (epic 3.4/01, ADR-0005 §2). One
// renderer per capability, so this takes no action. Injectable for the same reasons as
// {@link HandlerLoader}; the default loads the version-keyed file 3.4/02 generates.
export type ItemRendererLoader = (artifactsPath: string) => Promise<ItemRenderer>;

// Registry lookup seam. Production uses the validated registry store; route tests
// inject the coming five-Action shape before issue 4.2/04 admits/persists it.
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
  // Shared atomic admission for every route mutation; reads never acquire it.
  readonly mutationCoordinator?: MutationCoordinator;
}

// The fixed route and complete M4 method/Action matrix. The matrix is independent
// of what one capability advertises: prompt-built transitional capabilities still
// declare only create/read until the steady-state cutover.
const CAPABILITY_ROUTE = "/capability/:id/:action";
const CAPABILITY_VIEW_ROUTE = "/capability/:id";
const METHOD_BY_ACTION = {
  create: "POST",
  delete: "POST",
  read: "GET",
  search: "GET",
  update: "POST",
} as const satisfies Record<WireProtocolAction, "GET" | "POST">;

// The version-directory filename the item renderer is generated to (epic 3.4/02) and
// loaded from here — the seam that lets the router build a capability's presentation
// adapter without knowing how the renderer was written. A sibling of the handler files
// under the same `artifacts_path`.
export const ITEM_RENDERER_FILE = "item.ts";

// Product-voice failures (CONTEXT.md). The not-found copy is deliberately the same
// for an unknown capability and an undeclared action — the user need not, and must
// not, learn which internal check failed. Neither names an internal (no "handler",
// "action", "capability", "route").
const NOT_FOUND_FRAGMENT =
  "<p class=\"notice\">Hmm — I can't find that here. It might be something I haven't made yet.</p>";
const INTERNAL_ERROR_FRAGMENT =
  '<p class="notice">Hmm, something went sideways on my end just now. Mind trying again?</p>';
const WIRE_PROTOCOL_ERROR_FRAGMENT =
  '<p class="notice">Hmm — I couldn\'t make sense of that submission. Mind trying again?</p>';

// Attach the capability router to the app (called from createApp). Generated code
// reaches the platform only through what this builds — never the Hono context.
export function registerCapabilityRoutes(app: Hono, deps: CapabilityRouterDeps = {}): void {
  const databases = deps.databases ?? { readwrite: db, readonly: dbReadonly };
  const loadHandler = deps.loadHandler ?? defaultLoadHandler;
  const loadItemRenderer = deps.loadItemRenderer ?? defaultLoadItemRenderer;
  const lookupCapability = deps.lookupCapability ?? getCapability;
  const mutationCoordinator = deps.mutationCoordinator ?? createMutationCoordinator();

  app.get(CAPABILITY_VIEW_ROUTE, (c) =>
    handleCapabilityViewRequest(c, databases, lookupCapability),
  );
  // Catch every HTTP method here so a wrong pair receives the same warm product
  // boundary instead of falling through to Hono's generic 404 response.
  app.all(CAPABILITY_ROUTE, (c) =>
    handleCapabilityRequest(
      c,
      databases,
      loadHandler,
      loadItemRenderer,
      lookupCapability,
      mutationCoordinator,
    ),
  );
}

function handleCapabilityViewRequest(
  c: Context,
  databases: PlatformDatabase,
  lookupCapability: CapabilityLookup,
): Response {
  const id = c.req.param("id");
  if (!id) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  const row = lookupCapability(id, databases.readonly);
  if (!row) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  try {
    const html =
      c.req.header("HX-Request") === "true"
        ? renderCachedCapabilitySurface(row)
        : renderCachedCapabilityShell(row, databases.readonly);
    return c.html(html);
  } catch (error) {
    return internalFailure(c, id, "view", error);
  }
}

async function handleCapabilityRequest(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  lookupCapability: CapabilityLookup,
  mutationCoordinator: MutationCoordinator,
): Promise<Response> {
  const target = routableTarget(c);
  if (!target) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }
  const { id, action } = target;

  // Validate against the registry row's declared tools *before* loading any code.
  // An unknown capability (no row) or an undeclared action both fail here, cleanly.
  const row = lookupCapability(id, databases.readonly);
  if (!row || !isDeclaredAction(row, action)) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  if (isMutationAction(action)) {
    return handleRecordMutation(
      c,
      databases,
      loadHandler,
      loadItemRenderer,
      mutationCoordinator,
      row,
      action,
    );
  }
  return executeCapabilityHandler(c, databases, loadHandler, loadItemRenderer, row, action);
}

async function handleRecordMutation(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  mutationCoordinator: MutationCoordinator,
  row: CapabilityRow,
  action: MutationAction,
): Promise<Response> {
  const mutationLease = mutationCoordinator.tryAcquireRecordWrite();
  if (!mutationLease) return recordMutationRefusal(c, row.id, action);

  try {
    return await executeCapabilityHandler(c, databases, loadHandler, loadItemRenderer, row, action);
  } finally {
    mutationCoordinator.release(mutationLease);
  }
}

async function executeCapabilityHandler(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  row: CapabilityRow,
  action: WireProtocolAction,
): Promise<Response> {
  const { id } = row;
  // Everything past validation is the build-and-run path: a throw anywhere in it —
  // input parsing, handler loading, handler execution, or a contract violation —
  // becomes one warm, internals-free failure.
  try {
    const spec = capabilitySpecFromRow(row);
    const parsedRequest = await parseCapabilityRequest(c.req.raw, action, spec);
    const fragment = await invokeCapabilityHandler(
      databases,
      loadHandler,
      loadItemRenderer,
      row,
      spec,
      action,
      parsedRequest,
    );
    if (typeof fragment !== "string") {
      throw new TypeError(
        `Handler ${id}/${action} returned ${typeof fragment}; the contract requires an HTML string.`,
      );
    }
    return c.html(fragment);
  } catch (error) {
    if (error instanceof WireProtocolError) {
      return c.html(WIRE_PROTOCOL_ERROR_FRAGMENT, 400);
    }
    if (error instanceof MissingRequiredFieldsError) {
      return missingRequiredFieldsFailure(c, id, error);
    }
    if (error instanceof RecordNotFoundError) {
      return recordNotFoundFailure(c, error);
    }
    return internalFailure(c, id, action, error);
  }
}

async function invokeCapabilityHandler(
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  row: CapabilityRow,
  spec: CapabilitySpec,
  action: WireProtocolAction,
  parsedRequest: ParsedCapabilityRequest,
): Promise<string> {
  const { input } = parsedRequest;
  const dependencies = resolveActionReadDependencies(row, action, databases.readonly);
  const query = createCapabilityQueryPort(databases.readonly, {
    target: spec,
    dependencies: dependencies.map(capabilitySpecFromRow),
  });

  if (action === "create") {
    const mutation = createCapabilityMutationPort(spec, databases.readwrite);
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    const handler = await loadHandler(row.artifacts_path, action);
    return (handler as CapabilityCreateHandler)({ input, mutation, query, present });
  }
  if (action === "update") {
    const mutation = createCapabilityUpdateMutationPort(
      spec,
      requireRecordTarget(parsedRequest.recordTarget, action),
      new Set(input.submittedFields),
      databases.readwrite,
    );
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    const handler = await loadHandler(row.artifacts_path, action);
    return (handler as CapabilityUpdateHandler)({ input, mutation, query, present });
  }
  if (action === "delete") {
    const mutation = createCapabilityDeleteMutationPort(
      spec,
      requireRecordTarget(parsedRequest.recordTarget, action),
      databases.readwrite,
    );
    const handler = await loadHandler(row.artifacts_path, action);
    return (handler as CapabilityDeleteHandler)({ input, mutation, query });
  }

  const present = await buildPresentationAdapter(row, loadItemRenderer);
  const handler = await loadHandler(row.artifacts_path, action);
  return (handler as CapabilityReadHandler)({ input, query, present });
}

function recordMutationRefusal(c: Context, capabilityId: string, action: MutationAction): Response {
  if (action === "create") {
    c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  } else if (action === "update") {
    c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  }
  return c.html(
    '<p class="notice" data-role="error" data-error-code="mutation_busy">I\'m still putting something together. Give me a moment, then try that again.</p>',
    422,
  );
}

function missingRequiredFieldsFailure(
  c: Context,
  capabilityId: string,
  error: MissingRequiredFieldsError,
): Response {
  const fields = error.fields.join(" ");
  if (error.action === "create") {
    c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  } else if (error.action === "update") {
    c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  }
  const copy =
    error.action === "create"
      ? "I still need a little more before I can add this."
      : "I still need a little more before I can save this.";
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">${copy}</p>`,
    422,
  );
}

function recordNotFoundFailure(c: Context, error: RecordNotFoundError): Response {
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}">I couldn’t find that entry anymore. It may already be gone.</p>`,
    404,
  );
}

function requireRecordTarget(
  recordTarget: string | undefined,
  action: "update" | "delete",
): string {
  if (recordTarget === undefined) {
    throw new WireProtocolError(`${action} requires a validated record target.`);
  }
  return recordTarget;
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

// Build the capability's presentation adapter for the injected toolbox (epic 3.4/01):
// load its item renderer, then bind it with the capability so `present` turns one record
// into safe wrapped item HTML. `present` stays synchronous (record → string) because the
// renderer is resolved here, once, before the handler runs.
//
// The M3 artifact shape is mandatory: every committed capability has one item renderer
// beside its handlers. A missing or malformed renderer fails the request through the
// router's normal product-voice error boundary; there is no M2 compatibility adapter or
// dual-serving path (epic 3.7, ADR-0005 §7).
async function buildPresentationAdapter(
  row: CapabilityRow,
  loadItemRenderer: ItemRendererLoader,
): Promise<PresentationAdapter> {
  const renderItem = await loadItemRenderer(row.artifacts_path);
  return createPresentationAdapter({ capability: renderableFromRow(row), renderItem });
}

// The slice of a row the presentation adapter needs: the id (namespaces the detail
// templates), the user-facing label (the modal title), the fields (the detail body), and
// `ui_intent.detail` (which fields the detail surface shows, and in what order).
function renderableFromRow(row: CapabilityRow): RenderableCapability {
  return {
    id: row.id,
    label: row.label,
    schema: row.schema,
    form: row.ui_intent.form,
    item: row.ui_intent.item,
    detail: row.ui_intent.detail,
  };
}

// The default loader: import the incarnation/version-keyed handler file and confirm it honors
// the export half of the contract — a single default-exported function. A file URL
// keeps the absolute path importable across platforms; dynamic import caches by
// path, which is exactly right when `artifacts_path` is incarnation/version-namespaced.
const defaultLoadHandler: HandlerLoader = async (artifactsPath, action) => {
  const file = resolve(process.cwd(), artifactsPath, `${action}.ts`);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Handler file ${file} has no default-exported function.`);
  }
  return loaded.default as CapabilityHandler;
};

// The default item-renderer loader: import the version-keyed {@link ITEM_RENDERER_FILE}
// and confirm it default-exports a function (the record → inner-markup renderer). Mirrors
// {@link defaultLoadHandler} — same file-URL import, same cache-by-path behavior, which is
// right when `artifacts_path` is incarnation/version-namespaced. Rejects when the file is absent or
// malformed. M3 requires this file for every committed capability.
const defaultLoadItemRenderer: ItemRendererLoader = async (artifactsPath) => {
  const file = resolve(process.cwd(), artifactsPath, ITEM_RENDERER_FILE);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Item renderer file ${file} has no default-exported function.`);
  }
  return loaded.default as ItemRenderer;
};

// Surface a handler/internal failure: precise in the server log for the developer,
// warm and jargon-free in the response (never a stack trace or internals).
function internalFailure(c: Context, id: string, action: string, error: unknown): Response {
  console.error(
    `Capability ${id}/${action} failed:`,
    error instanceof Error ? error.message : error,
  );
  return c.html(INTERNAL_ERROR_FRAGMENT, 500);
}
