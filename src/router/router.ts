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
//   2. Loads the handler for that action from the version directory the row's
//      `artifacts_path` points to.
//   3. Builds the platform context (ADR-0004): parsed input (form/query — the
//      handler never touches raw HTTP) plus the data tool **already scoped** to
//      this capability (it cannot name another table).
//   4. Invokes the handler's single default-exported async function and wraps the
//      returned HTML fragment in the HTTP response — the platform owns headers,
//      status, and routing.
//
// A handler that throws (or any internal slip) surfaces a warm, product-voice
// failure; the precise cause is logged for the developer, never leaked to the UI
// (CONTEXT.md "Product voice", ARCH §9.7).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context, Hono } from "hono";

import { createCapabilityDataTool, MissingRequiredFieldsError } from "../capability-data/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "../db.ts";
import {
  capabilityCreateErrorId,
  createPresentationAdapter,
  type ItemRenderer,
  type PresentationAdapter,
  type RenderableCapability,
} from "../presentation/index.ts";
import { type CapabilityRow, type CapabilitySpec, getCapability } from "../registry/index.ts";
import { renderCachedCapabilityShell, renderCachedCapabilitySurface } from "../web/index.ts";
import type { CapabilityHandler } from "./contract.ts";
import { parseCapabilityRequest, WireProtocolError } from "./wire-protocol.ts";

// How the router turns a row's `artifacts_path` + an action into a runnable
// handler. Injectable so the gate (2.5) and tests can substitute loading without
// touching disk; the default loads the real version-keyed file.
export type HandlerLoader = (artifactsPath: string, action: string) => Promise<CapabilityHandler>;

// How the router turns a row's `artifacts_path` into that capability's item renderer —
// the composition input for its presentation adapter (epic 3.4/01, ADR-0005 §2). One
// renderer per capability, so this takes no action. Injectable for the same reasons as
// {@link HandlerLoader}; the default loads the version-keyed file 3.4/02 generates.
export type ItemRendererLoader = (artifactsPath: string) => Promise<ItemRenderer>;

export interface CapabilityRouterDeps {
  // The read-write / read-only pair the lookup and the scoped data tool ride.
  // Defaults to the platform singletons; tests inject a scratch pair.
  readonly databases?: PlatformDatabase;
  // Defaults to {@link defaultLoadHandler}.
  readonly loadHandler?: HandlerLoader;
  // Defaults to {@link defaultLoadItemRenderer}.
  readonly loadItemRenderer?: ItemRendererLoader;
}

// The fixed route. Registered for the methods M2's two actions use (read = GET,
// create = POST); update/delete arrive with their own methods in later modules.
const CAPABILITY_ROUTE = "/capability/:id/:action";
const CAPABILITY_VIEW_ROUTE = "/capability/:id";

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

  app.get(CAPABILITY_VIEW_ROUTE, (c) => handleCapabilityViewRequest(c, databases));
  app.on(["GET", "POST"], CAPABILITY_ROUTE, (c) =>
    handleCapabilityRequest(c, databases, loadHandler, loadItemRenderer),
  );
}

function handleCapabilityViewRequest(c: Context, databases: PlatformDatabase): Response {
  const id = c.req.param("id");
  if (!id) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  const row = getCapability(id, databases.readonly);
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
): Promise<Response> {
  const id = c.req.param("id");
  const action = c.req.param("action");
  // The route pattern always binds both, but the typed params are optional; a miss
  // is the same clean not-found as any other unroutable request.
  if (!id || !action) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  // Validate against the registry row's declared tools *before* loading any code.
  // An unknown capability (no row) or an undeclared action both fail here, cleanly.
  const row = getCapability(id, databases.readonly);
  if (!row || !isDeclaredAction(row, action)) {
    return c.html(NOT_FOUND_FRAGMENT, 404);
  }

  // Everything past validation is the build-and-run path: a throw anywhere in it —
  // input parsing, handler loading, handler execution, or a contract violation —
  // becomes one warm, internals-free failure.
  try {
    const spec = specFromRow(row);
    const { input } = await parseCapabilityRequest(c.req.raw, action as "create" | "read", spec);
    const data = createCapabilityDataTool(spec, databases);
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    const handler = await loadHandler(row.artifacts_path, action);

    const fragment = await handler({ input, data, present });
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
    return internalFailure(c, id, action, error);
  }
}

function missingRequiredFieldsFailure(
  c: Context,
  capabilityId: string,
  error: MissingRequiredFieldsError,
): Response {
  const fields = error.fields.join(" ");
  c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
  c.header("HX-Reswap", "innerHTML");
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">I still need a little more before I can add this.</p>`,
    422,
  );
}

// Whether the action is one the capability actually declares it can do. `tools` is
// the validated allow-list (registry spec); a request for anything outside it is
// refused the same as a request for a capability that doesn't exist.
function isDeclaredAction(row: CapabilityRow, action: string): boolean {
  return (row.tools as readonly string[]).includes(action);
}

// The spec embedded in a registry row — the row minus the two platform-assigned
// values (`version`, `artifacts_path`). The data tool's constructor parses against
// the strict spec schema, which rejects those extra keys, so the row can't be
// handed over whole.
function specFromRow(row: CapabilityRow): CapabilitySpec {
  return {
    id: row.id,
    label: row.label,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  };
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
