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

import { createCapabilityDataTool } from "../capability-data/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "../db.ts";
import { type CapabilityRow, type CapabilitySpec, getCapability } from "../registry/index.ts";
import type { CapabilityHandler, CapabilityInput } from "./contract.ts";

// How the router turns a row's `artifacts_path` + an action into a runnable
// handler. Injectable so the gate (2.5) and tests can substitute loading without
// touching disk; the default loads the real version-keyed file.
export type HandlerLoader = (artifactsPath: string, action: string) => Promise<CapabilityHandler>;

export interface CapabilityRouterDeps {
  // The read-write / read-only pair the lookup and the scoped data tool ride.
  // Defaults to the platform singletons; tests inject a scratch pair.
  readonly databases?: PlatformDatabase;
  // Defaults to {@link defaultLoadHandler}.
  readonly loadHandler?: HandlerLoader;
}

// The fixed route. Registered for the methods M2's two actions use (read = GET,
// create = POST); update/delete arrive with their own methods in later modules.
const CAPABILITY_ROUTE = "/capability/:id/:action";

// Product-voice failures (CONTEXT.md). The not-found copy is deliberately the same
// for an unknown capability and an undeclared action — the user need not, and must
// not, learn which internal check failed. Neither names an internal (no "handler",
// "action", "capability", "route").
const NOT_FOUND_FRAGMENT =
  "<p class=\"notice\">Hmm — I can't find that here. It might be something I haven't made yet.</p>";
const INTERNAL_ERROR_FRAGMENT =
  '<p class="notice">Hmm, something went sideways on my end just now. Mind trying again?</p>';

// Attach the capability router to the app (called from createApp). Generated code
// reaches the platform only through what this builds — never the Hono context.
export function registerCapabilityRoutes(app: Hono, deps: CapabilityRouterDeps = {}): void {
  const databases = deps.databases ?? { readwrite: db, readonly: dbReadonly };
  const loadHandler = deps.loadHandler ?? defaultLoadHandler;

  app.on(["GET", "POST"], CAPABILITY_ROUTE, (c) =>
    handleCapabilityRequest(c, databases, loadHandler),
  );
}

async function handleCapabilityRequest(
  c: Context,
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
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
    const input = await parseInput(c);
    const data = createCapabilityDataTool(specFromRow(row), databases);
    const handler = await loadHandler(row.artifacts_path, action);

    const fragment = await handler({ input, data });
    if (typeof fragment !== "string") {
      throw new TypeError(
        `Handler ${id}/${action} returned ${typeof fragment}; the contract requires an HTML string.`,
      );
    }
    return c.html(fragment);
  } catch (error) {
    return internalFailure(c, id, action, error);
  }
}

// Whether the action is one the capability actually declares it can do. `tools` is
// the validated allow-list (registry spec); a request for anything outside it is
// refused the same as a request for a capability that doesn't exist.
function isDeclaredAction(row: CapabilityRow, action: string): boolean {
  return (row.tools as readonly string[]).includes(action);
}

// Parse the request into the flat string map the handler contract speaks: query
// params for a GET (read), the form body otherwise (create). M2 has no file
// fields, so non-string body parts (uploads) are dropped here rather than reaching
// a handler that can't take them yet.
async function parseInput(c: Context): Promise<CapabilityInput> {
  if (c.req.method === "GET") {
    return c.req.query();
  }

  const body = await c.req.parseBody();
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      input[key] = value;
    }
  }
  return input;
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
    prompt_context: row.prompt_context,
  };
}

// The default loader: import the version-keyed handler file and confirm it honors
// the export half of the contract — a single default-exported function. A file URL
// keeps the absolute path importable across platforms; dynamic import caches by
// path, which is exactly right when `artifacts_path` is version-namespaced.
const defaultLoadHandler: HandlerLoader = async (artifactsPath, action) => {
  const file = resolve(process.cwd(), artifactsPath, `${action}.ts`);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Handler file ${file} has no default-exported function.`);
  }
  return loaded.default as CapabilityHandler;
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
