// The guard every writing route carries on its own registration (Module 7 PLAN decisions 9 and
// 10, ADR-0009): a cross-site refusal, then the route's own body limit, both before the route
// reads a byte. Bun's `maxRequestBodySize` is the file cap and Bun does not apply it to a chunked
// body at all, so the count here is what bounds one.

import type { Context, MiddlewareHandler } from "hono";

/** What a route taking text accepts: the global cap every route lived under before files. */
export const TEXT_BODY_LIMIT_BYTES = 1024 * 1024;

/** What a streamed body raises to the route that reads it past its guard's limit. */
export class BodyTooLargeError extends Error {
  override readonly name = "BodyTooLargeError";
}

export interface WritingRouteGuard {
  readonly maxBodyBytes: number;
  /** The body reaches the route as a counted stream instead of buffered. */
  readonly streams: boolean;
}

const NO_STORE = { "cache-control": "no-store" } as const;

const guards = new WeakMap<object, WritingRouteGuard>();
const passThroughs = new WeakSet<object>();
/** Errors the socket raised under a streamed body, so a hang-up is told apart from our own aborts. */
const socketErrors = new WeakSet<object>();

/**
 * A browser sends `Sec-Fetch-Site` on every request, and another site's form posts a urlencoded
 * body with no preflight, carrying the person's session. Absent means a client that is not a
 * browser; `none` is the person's own navigation.
 */
function isCrossSiteRequest(c: Context): boolean {
  const site = c.req.header("sec-fetch-site");
  return site !== undefined && site !== "same-origin" && site !== "none";
}

function declaredLength(request: Request): number {
  const declared = request.headers.get("content-length");
  return declared !== null && /^\d+$/.test(declared) ? Number(declared) : 0;
}

/** The whole body, or null the moment it passes `limit`; never holds more than `limit` bytes. */
async function readWithin(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<ArrayBuffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Bun.concatArrayBuffers(chunks);
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
}

async function readSocket<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (typeof error === "object" && error !== null) socketErrors.add(error);
    throw error;
  }
}

/** Pulls from the socket only as the route reads, so nothing arrives that the route did not ask for. */
function countedWithin(
  body: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let size = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await readSocket(() => reader.read());
        if (done) return controller.close();
        size += value.byteLength;
        if (size <= limit) return controller.enqueue(value);
        reader.cancel().catch(() => undefined);
        controller.error(new BodyTooLargeError(`body passed ${limit} bytes`));
      },
      cancel: (reason) => reader.cancel(reason),
    },
    { highWaterMark: 0 },
  );
}

function tooLarge(c: Context): Response {
  return c.text("Content Too Large", 413, NO_STORE);
}

/** Nobody reads this answer; it only keeps a hang-up from being answered as a server failure. */
function hungUp(c: Context): Response {
  return c.body(null, 400, NO_STORE);
}

/**
 * Whether an error that escaped a route was the sender's doing rather than a failure: a streamed
 * body read past its limit, or the socket failing under a streamed body because the client left.
 */
export function isSendersDoing(error: unknown): boolean {
  if (error instanceof BodyTooLargeError) return true;
  return typeof error === "object" && error !== null && socketErrors.has(error);
}

function refuseUnread(c: Context, maxBodyBytes: number): Response | undefined {
  if (isCrossSiteRequest(c)) return c.text("Forbidden", 403, NO_STORE);
  if (declaredLength(c.req.raw) > maxBodyBytes) return tooLarge(c);
  return undefined;
}

async function bufferWithin(c: Context, maxBodyBytes: number): Promise<Response | undefined> {
  if (!c.req.raw.body) return undefined;
  let body: ArrayBuffer | null;
  try {
    body = await readWithin(c.req.raw.body, maxBodyBytes);
  } catch (error) {
    // Only the socket read is in here, so an aborted signal means the client left mid-body.
    if (c.req.raw.signal.aborted) return hungUp(c);
    throw error;
  }
  if (!body) return tooLarge(c);
  c.req.raw = new Request(c.req.raw, { body });
  return undefined;
}

function streamWithin(c: Context, maxBodyBytes: number): void {
  if (!c.req.raw.body) return;
  const body = countedWithin(c.req.raw.body, maxBodyBytes);
  c.req.raw = new Request(c.req.raw, { body, duplex: "half" } as RequestInit);
}

function registered(guard: MiddlewareHandler, description: WritingRouteGuard): MiddlewareHandler {
  guards.set(guard, description);
  return guard;
}

/**
 * Refuse a cross-site request with 403, then a body over `maxBodyBytes` with 413, whether its
 * length was declared or found by counting. An admitted body is buffered (a text route parses the
 * whole of it anyway) and handed on intact. GET and HEAD pass: they carry no body.
 *
 * The route receives a rebuilt `Request`: its abort signal follows the socket, but Bun's
 * `server.requestIP` and `server.timeout` do not recognize it.
 */
export function guardWritingRoute(maxBodyBytes: number): MiddlewareHandler {
  return registered(
    async (c, next) => {
      if (c.req.method === "GET" || c.req.method === "HEAD") return next();
      const refusal = refuseUnread(c, maxBodyBytes) ?? (await bufferWithin(c, maxBodyBytes));
      if (refusal) return refusal;
      await next();
    },
    { maxBodyBytes, streams: false },
  );
}

/**
 * The same refusals for a body too large to buffer (PLAN decision 8): the route reads it as it
 * arrives, and the read raises {@link BodyTooLargeError} past `maxBodyBytes`. A route that lets
 * the error escape is answered 413; one that catches it to clean up must answer 413 itself. Read
 * through the body's reader or `for await`: `Bun.write` never settles on an erroring stream.
 */
export function guardStreamingRoute(maxBodyBytes: number): MiddlewareHandler {
  return registered(
    async (c, next) => {
      if (c.req.method === "GET" || c.req.method === "HEAD") return next();
      const refusal = refuseUnread(c, maxBodyBytes);
      if (refusal) return refusal;
      streamWithin(c, maxBodyBytes);
      await next();
      if (isSendersDoing(c.error)) {
        c.res = c.error instanceof BodyTooLargeError ? tooLarge(c) : hungUp(c);
      }
    },
    { maxBodyBytes, streams: true },
  );
}

/**
 * Declares one `use` registration of middleware that reads no body and writes nothing, such as the
 * response headers on every path. The route walk counts every other non-GET entry as a door that
 * needs a guard, and exempts this one only where it is registered for every method.
 */
export function passesThrough(middleware: MiddlewareHandler): MiddlewareHandler {
  const registration: MiddlewareHandler = (c, next) => middleware(c, next);
  passThroughs.add(registration);
  return registration;
}

export function isPassThrough(handler: unknown): boolean {
  return typeof handler === "function" && passThroughs.has(handler);
}

/** What a route handler was registered as, if it is one of the guards above. */
export function writingRouteGuard(handler: unknown): WritingRouteGuard | undefined {
  return typeof handler === "function" ? guards.get(handler) : undefined;
}
