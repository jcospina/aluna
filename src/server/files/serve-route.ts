// `/files/:key` (Module 7 PLAN decisions 23, 24, 26 and 27; ADR-0009). The read token covers the
// open and is back before the body streams. A row admission could not have written, or bytes that
// no longer match their row, answer as absent. Bun sends a stream body chunked, whatever length the
// route states, so only a HEAD carries one. Range requests are 7.2/02's.

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
import type { OpenedObject } from "../../platform/files/object-store.ts";
import { tryReadToken } from "./read-token.ts";
import type { FileRouteDeps } from "./upload-route.ts";

const FILE_SERVE_ROUTE = `${FILE_URL_PREFIX}:key`;

type FileServeDeps = Pick<FileRouteDeps, "databases" | "readGates" | "objectStore">;

const SERVED_STATES: ReadonlySet<FileLedgerState> = new Set(["pending", "owned"]);

/** What a family's bytes may do opened as a document: nothing, as the logo route's may not. */
const POLICY_BY_KIND: ReadonlyMap<string, string> = new Map([
  ["image", "default-src 'none'; sandbox"],
]);

const NOSNIFF = { "x-content-type-options": "nosniff" } as const;

/** A random key's bytes never change, so a year and `immutable`, as the logo route's. */
const IMMUTABLE = "public, max-age=31536000, immutable";

function absent(c: Context): Response {
  return c.body(null, 404, { ...NOSNIFF, "cache-control": "no-store" });
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
  const key = c.req.param("key") ?? "";
  const row = isFileKey(key) ? readFileLedgerRow(deps.databases.readonly, key) : null;
  const policy = servedPolicy(row);
  if (!row || !policy) return absent(c);
  const headers = {
    ...NOSNIFF,
    "content-type": row.mime,
    "content-security-policy": policy,
    "content-disposition": inlineContentDisposition(row.name),
    "cache-control": IMMUTABLE,
  };
  const opened = await openUnderReadToken(deps, row);
  return opened ? answerWith(c, opened, row, headers) : absent(c);
}

export function registerFileServeRoute(app: Hono, deps: FileServeDeps): void {
  app.get(FILE_SERVE_ROUTE, (c) => serveFile(c, deps));
}
