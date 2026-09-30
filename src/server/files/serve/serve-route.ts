// `/files/:key` (Module 7 PLAN decisions 23 to 27; ADR-0009). The read token covers the open and is
// back before the body streams. A row admission could not have written, or bytes that no longer
// match their row, answer as absent. Bun sends a stream body chunked, whatever length the route
// states, so the whole file's answer carries none; a range is read whole from the opened
// descriptor first, never from `Bun.file().slice()`, which Bun would open after the token is back,
// so a 206 carries its length and a read that fails answers as absent. A HEAD ignores Range, as
// RFC 9110 has it. `nosniff` is the app's, on every answer (`app.ts`).
//
// A cors-mode request for anything but a player is refused: every fetch and XHR htmx makes is one,
// and htmx swaps any 2xx, so a Handler's `hx-get` would put a polyglot's markup in the page
// unjudged. A browser's own page for a video or a sound opened in a tab asks in cors mode, as one.
// The answer varies on the mode and the destination, or the copy an `<img>` or a player cached
// would answer htmx instead. A client sending no `Sec-Fetch-Mode` is served, as the writing-route
// guard treats it.

import type { Context, Hono } from "hono";
import { isAdmittedType } from "../../../platform/files/admission/admission.ts";
import { inlineContentDisposition } from "../../../platform/files/file-name.ts";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import {
  type FileLedgerRow,
  type FileLedgerState,
  isFileKey,
  readFileLedgerRow,
} from "../../../platform/files/store/ledger.ts";
import type {
  ByteSpan,
  ObjectStore,
  OpenedObject,
} from "../../../platform/files/store/object-store.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { ReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import { IMMUTABLE, NO_STORE } from "../../http/cache-headers.ts";
import { tryReadToken } from "../read-token.ts";
import {
  answerRange,
  contentRange,
  type RangeAnswer,
  strongEtag,
  unsatisfiedRange,
} from "./byte-range.ts";

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

/**
 * What an answer varies on: a player's cors-mode load is served, a script's is not, so a copy one
 * cached must never answer the other.
 */
const VARY = "sec-fetch-mode, sec-fetch-dest";

/** What a player asks for, whatever its mode; a script's fetch asks for `empty`. */
const PLAYER_DESTINATIONS: ReadonlySet<string> = new Set(["video", "audio"]);

/** Whether a page's own script could read this answer, and so must not be given one. */
function readableByScript(c: Context): boolean {
  if (!READABLE_FETCH_MODES.has(c.req.header("sec-fetch-mode") ?? "")) return false;
  return !PLAYER_DESTINATIONS.has(c.req.header("sec-fetch-dest") ?? "");
}

/** What an image's bytes may do opened as a document: nothing, as the logo route's may not. */
export const INERT_IMAGE_POLICY = "default-src 'none'; sandbox";

/**
 * A player's: nothing but load itself. A browser opens a video or a sound in a tab as a page of its
 * own making, whose player fetches the file again in cors mode. `media-src` lets it, and the
 * sandbox keeps the page's own origin so the fetch is same-origin. It still runs no script.
 */
export const INERT_PLAYER_POLICY =
  "default-src 'none'; media-src 'self'; sandbox allow-same-origin";

const POLICY_BY_KIND: ReadonlyMap<string, string> = new Map([
  ["image", INERT_IMAGE_POLICY],
  ["video", INERT_PLAYER_POLICY],
  ["audio", INERT_PLAYER_POLICY],
]);

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
  span: ByteSpan | undefined,
): Promise<OpenedObject | null> {
  const tokens = tryReadToken(deps.readGates, deps.databases.readonly, {
    capabilityId: row.capability_id,
    incarnationId: row.incarnation_id,
  });
  if (!tokens) return null;
  try {
    return await deps.objectStore.get(row.key, span);
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
  span: ByteSpan | undefined,
): Promise<Response> {
  const { signal } = c.req.raw;
  if (opened.size !== row.size || signal.aborted) {
    await opened.close();
    return absent(c);
  }
  if (span) return answerSpan(c, opened, span, headers);
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

/** The span read to its end, which closes the descriptor, and sent with its length. */
async function answerSpan(
  c: Context,
  opened: OpenedObject,
  span: ByteSpan,
  headers: Record<string, string>,
): Promise<Response> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await new Response(opened.body).arrayBuffer());
  } catch {
    return absent(c);
  }
  return c.body(bytes, 206, { ...headers, "content-range": contentRange(span, opened.size) });
}

async function serveFile(c: Context, deps: FileServeDeps): Promise<Response> {
  if (readableByScript(c)) return absent(c);
  const key = c.req.param("key") ?? "";
  const row = isFileKey(key) ? readFileLedgerRow(deps.databases.readonly, key) : null;
  const policy = servedPolicy(row);
  if (!row || !policy) return absent(c);
  const etag = strongEtag(row.key);
  const headers = {
    "content-type": row.mime,
    "content-security-policy": policy,
    "content-disposition": inlineContentDisposition(row.name),
    "accept-ranges": "bytes",
    etag,
    vary: VARY,
    ...IMMUTABLE,
  };
  const range = c.req.method === "GET" ? c.req.header("range") : undefined;
  const asked = answerRange(range, c.req.header("if-range"), row.size, etag);
  const span = spanOf(asked);
  const opened = await openUnderReadToken(deps, row, span);
  if (!opened) return absent(c);
  if (asked.kind !== "unsatisfiable") return answerWith(c, opened, row, headers, span);
  await opened.close();
  return opened.size === row.size ? unsatisfiable(c, row) : absent(c);
}

function spanOf(asked: RangeAnswer): ByteSpan | undefined {
  return asked.kind === "span" ? asked.span : undefined;
}

/** A range the file doesn't hold: nothing sent, nothing cached, and the size to ask within. */
function unsatisfiable(c: Context, row: FileLedgerRow): Response {
  return c.body(null, 416, {
    "accept-ranges": "bytes",
    "content-range": unsatisfiedRange(row.size),
    vary: VARY,
    ...NO_STORE,
  });
}

export function registerFileServeRoute(app: Hono, deps: FileServeDeps): void {
  app.get(FILE_SERVE_ROUTE, (c) => serveFile(c, deps));
}
