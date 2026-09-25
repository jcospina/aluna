// `/files/:key` (Module 7 PLAN decisions 23, 24, 26 and 27; ADR-0009). The read token covers the
// open and is back before the body streams. A row admission could not have written, or bytes that
// no longer match their row, answer as absent. Bun sends a stream body chunked, whatever length the
// route states, so only a HEAD carries one. Range requests are 7.2/02's. `nosniff` is the app's,
// on every answer (`app.ts`). A cors-mode request — every fetch and XHR htmx makes — is refused:
// htmx swaps any 2xx, so a Handler's `hx-get` would put a polyglot's markup in the page unjudged.
// The answer varies on the mode, or the copy an `<img>` cached would answer htmx instead. A client
// sending no `Sec-Fetch-Mode` is served, as the writing-route guard treats it.

import type { Context, Hono } from "hono";
import { isAdmittedType } from "../../platform/files/admission.ts";
import { inlineContentDisposition } from "../../platform/files/file-name.ts";
import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import {
  type FileLedgerRow,
  type FileLedgerState,
  isFileKey,
  readFileLedgerRow,
} from "../../platform/files/ledger.ts";
import type { ObjectStore, OpenedObject } from "../../platform/files/object-store.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import { IMMUTABLE, NO_STORE } from "../http/cache-headers.ts";
import { tryReadToken } from "./read-token.ts";

const FILE_SERVE_ROUTE = `${FILE_URL_PREFIX}:key`;

interface FileServeDeps {
  readonly databases: PlatformDatabase;
  readonly readGates: ReadGateCoordinator;
  readonly objectStore: ObjectStore;
}

const SERVED_STATES: ReadonlySet<FileLedgerState> = new Set(["pending", "owned"]);

/**
 * Modes whose answer a page can read: fetch and XHR, and an element load marked `crossorigin`,
 * which no photo is drawn with. A plain `<img>`, `<video>` or navigation is `no-cors`/`navigate`.
 */
export const READABLE_FETCH_MODES: ReadonlySet<string> = new Set(["cors", "same-origin"]);

/** What an image's bytes may do opened as a document: nothing, as the logo route's may not. */
export const INERT_IMAGE_POLICY = "default-src 'none'; sandbox";

const POLICY_BY_KIND: ReadonlyMap<string, string> = new Map([["image", INERT_IMAGE_POLICY]]);

function absent(c: Context): Response {
  return c.body(null, 404, NO_STORE);
}

/** The policy a row's bytes are served under, or undefined for a row that must not serve. */
function servedPolicy(row: FileLedgerRow | null): string | undefined {
  if (!row || !SERVED_STATES.has(row.state) || !isAdmittedType(row.kind, row.mime))
    return undefined;
  return POLICY_BY_KIND.get(row.kind);
}

async function openUnderReadToken(
  deps: FileServeDeps,
  row: FileLedgerRow,
): Promise<OpenedObject | null> {
  const tokens = tryReadToken(deps.readGates, deps.databases.readonly, {
    capabilityId: row.capability_id,
    incarnationId: row.incarnation_id,
  });
  if (!tokens) return null;
  try {
    return await deps.objectStore.get(row.key);
  } finally {
    deps.readGates.release(tokens);
  }
}

/**
 * Bun drops a response whose client has already gone without cancelling its body, so a client that
 * left while the file was opening gets nothing opened, and one that leaves later closes it.
 */
async function answerWith(
  c: Context,
  opened: OpenedObject,
  row: FileLedgerRow,
  headers: Record<string, string>,
): Promise<Response> {
  const { signal } = c.req.raw;
  if (opened.size !== row.size || signal.aborted) {
    await opened.close();
    return absent(c);
  }
  if (c.req.method === "HEAD") {
    await opened.close();
    return c.body(null, 200, { ...headers, "content-length": String(opened.size) });
  }
  signal.addEventListener("abort", () => void opened.close().catch(() => undefined), {
    once: true,
  });
  try {
    return c.body(opened.body, 200, headers);
  } catch (error) {
    await opened.close();
    throw error;
  }
}

async function serveFile(c: Context, deps: FileServeDeps): Promise<Response> {
  if (READABLE_FETCH_MODES.has(c.req.header("sec-fetch-mode") ?? "")) return absent(c);
  const key = c.req.param("key") ?? "";
  const row = isFileKey(key) ? readFileLedgerRow(deps.databases.readonly, key) : null;
  const policy = servedPolicy(row);
  if (!row || !policy) return absent(c);
  const headers = {
    "content-type": row.mime,
    "content-security-policy": policy,
    "content-disposition": inlineContentDisposition(row.name),
    vary: "sec-fetch-mode",
    ...IMMUTABLE,
  };
  const opened = await openUnderReadToken(deps, row);
  return opened ? answerWith(c, opened, row, headers) : absent(c);
}

export function registerFileServeRoute(app: Hono, deps: FileServeDeps): void {
  app.get(FILE_SERVE_ROUTE, (c) => serveFile(c, deps));
}
