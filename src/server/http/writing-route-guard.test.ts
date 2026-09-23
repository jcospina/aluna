import { describe, expect, test } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import { probeBody, streamedInit } from "./writing-route-guard.test-support.ts";
import {
  BodyTooLargeError,
  guardStreamingRoute,
  guardWritingRoute,
  isSendersDoing,
  writingRouteGuard,
} from "./writing-route-guard.ts";

const LIMIT = 200_000;

const GUARDS: readonly [string, (limit: number) => MiddlewareHandler][] = [
  ["buffered", guardWritingRoute],
  ["streaming", guardStreamingRoute],
];

/** A route behind `guard` that answers with what it was handed, so a test sees what got through. */
function guardedEcho(guard: MiddlewareHandler): { app: Hono; reached: () => number } {
  let reached = 0;
  const app = new Hono();
  app.onError((_error, c) => c.text("failed", 500));
  app.all("/write", guard, async (c) => {
    reached += 1;
    const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
    return c.json({ bytes: bytes.byteLength, last: bytes.at(-1) ?? null });
  });
  return { app, reached: () => reached };
}

describe.each(GUARDS)("a %s writing-route guard", (_kind, guardFor) => {
  test("refuses another site's request before it reads a byte of the body", async () => {
    const { app, reached } = guardedEcho(guardFor(LIMIT));
    for (const site of ["cross-site", "same-site"]) {
      const body = probeBody(LIMIT);
      const response = await app.request(
        "/write",
        streamedInit("POST", body, { "sec-fetch-site": site }),
      );
      expect({ site, status: response.status, pulled: body.pulledBytes() }).toEqual({
        site,
        status: 403,
        pulled: 0,
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(reached()).toBe(0);
  });

  test("admits the desk's own request, a navigation and a client that is not a browser", async () => {
    const { app } = guardedEcho(guardFor(LIMIT));
    for (const site of ["same-origin", "none", undefined]) {
      const headers: Record<string, string> = site === undefined ? {} : { "sec-fetch-site": site };
      const response = await app.request("/write", { method: "POST", headers, body: "x=1" });
      expect({ site, status: response.status }).toEqual({ site, status: 200 });
    }
  });

  test("refuses a declared length over its limit without reading the body", async () => {
    const { app, reached } = guardedEcho(guardFor(LIMIT));
    const body = probeBody(LIMIT + 1);
    const response = await app.request(
      "/write",
      streamedInit("POST", body, { "content-length": String(LIMIT + 1) }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.pulledBytes()).toBe(0);
    expect(reached()).toBe(0);
  });

  test("counts a body with no declared length and stops reading once it passes the limit", async () => {
    const { app } = guardedEcho(guardFor(LIMIT));
    const endless = probeBody(Number.POSITIVE_INFINITY);
    const response = await app.request("/write", streamedInit("POST", endless));
    expect(response.status).toBe(413);
    // The overshoot is at most the chunk that crossed the line, and the guard stops reading.
    expect(endless.pulledBytes()).toBeLessThan(LIMIT * 2);
    expect(endless.cancelled()).toBe(true);
  });

  test("counts even when the declared length undersells the body or is not a number", async () => {
    const { app } = guardedEcho(guardFor(LIMIT));
    for (const declared of ["10", "ten", "-1", "1, 1"]) {
      const response = await app.request(
        "/write",
        streamedInit("POST", probeBody(LIMIT + 1), { "content-length": declared }),
      );
      expect({ declared, status: response.status }).toEqual({ declared, status: 413 });
    }
  });

  test("hands a body at its limit to the route intact, across chunks", async () => {
    const { app } = guardedEcho(guardFor(LIMIT));
    const response = await app.request("/write", streamedInit("POST", probeBody(LIMIT, "x=")));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: LIMIT, last: "a".charCodeAt(0) });
  });

  test("passes a request with no body, and never stands in front of a read", async () => {
    const { app, reached } = guardedEcho(guardFor(LIMIT));
    expect((await app.request("/write", { method: "POST" })).status).toBe(200);
    for (const method of ["GET", "HEAD"]) {
      const response = await app.request("/write", {
        method,
        headers: { "sec-fetch-site": "cross-site", "content-length": String(LIMIT + 1) },
      });
      expect({ method, status: response.status }).toEqual({ method, status: 200 });
    }
    expect(reached()).toBe(3);
  });

  test("describes itself to the route walk, and nothing else does", () => {
    const guard = guardFor(LIMIT);
    expect(writingRouteGuard(guard)?.maxBodyBytes).toBe(LIMIT);
    expect(writingRouteGuard(async () => undefined)).toBeUndefined();
    expect(writingRouteGuard(undefined)).toBeUndefined();
  });
});

describe("a buffered writing-route guard", () => {
  test("leaves the body readable by every parser a route uses", async () => {
    const app = new Hono();
    const guard = guardWritingRoute(LIMIT);
    app.post("/raw", guard, async (c) => c.text(String((await c.req.raw.formData()).get("name"))));
    app.post("/parsed", guard, async (c) => c.text(String((await c.req.parseBody()).name)));
    app.post("/json", guard, async (c) => c.text((await c.req.json<{ name: string }>()).name));
    const name = "日本 — naïve";
    const multipart = () => {
      const form = new FormData();
      form.append("name", name);
      return { method: "POST", body: form };
    };
    const urlencoded = { method: "POST", body: new URLSearchParams({ name }) };
    const json = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    };
    for (const [path, init] of [
      ["/raw", multipart()],
      ["/parsed", multipart()],
      ["/raw", urlencoded],
      ["/json", json],
    ] as const) {
      const response = await app.request(path, init);
      expect({ path, said: await response.text() }).toEqual({ path, said: name });
    }
  });

  test("answers a client that hung up mid-body quietly, and a real read failure loudly", async () => {
    const { app, reached } = guardedEcho(guardWritingRoute(LIMIT));
    const send = (hangUp: boolean) => {
      const caller = new AbortController();
      // What Bun raises when the socket closes mid-body, with the request's signal already aborted.
      const body = new ReadableStream<Uint8Array>({
        pull() {
          if (!hangUp) throw new Error("the body stopped arriving");
          caller.abort();
          throw new DOMException("The connection was closed.", "AbortError");
        },
      });
      return app.request("/write", {
        ...streamedInit("POST", { stream: body, pulledBytes: () => 0, cancelled: () => false }),
        signal: caller.signal,
      });
    };
    expect((await send(true)).status).toBe(400);
    expect((await send(false)).status).toBe(500);
    expect(reached()).toBe(0);
  });
});

describe("a streaming writing-route guard", () => {
  test("hands the body over as it arrives, without holding it", async () => {
    const app = new Hono();
    const body = probeBody(LIMIT, "x=");
    let pulledBeforeReading = -1;
    app.post("/write", guardStreamingRoute(LIMIT), async (c) => {
      pulledBeforeReading = body.pulledBytes();
      const reader = c.req.raw.body?.getReader();
      const first = await reader?.read();
      const pulledAtFirstChunk = body.pulledBytes();
      await reader?.cancel();
      return c.json({ first: first?.value?.byteLength, pulledAtFirstChunk });
    });
    const response = await app.request("/write", streamedInit("POST", body));
    const answer = (await response.json()) as { first: number; pulledAtFirstChunk: number };
    expect(pulledBeforeReading).toBe(0);
    expect(answer.first).toBeGreaterThan(0);
    expect(answer.pulledAtFirstChunk).toBeLessThan(LIMIT);
  });

  test("tells the sender's doing from an abort of the server's own", () => {
    expect(isSendersDoing(new BodyTooLargeError("past the limit"))).toBe(true);
    expect(isSendersDoing(new DOMException("a deadline passed", "AbortError"))).toBe(false);
    expect(isSendersDoing(undefined)).toBe(false);
  });

  test("raises BodyTooLargeError to a route that reads past the limit", async () => {
    const app = new Hono();
    app.post("/write", guardStreamingRoute(LIMIT), async (c) => {
      try {
        await c.req.raw.arrayBuffer();
        return c.text("read it all");
      } catch (error) {
        return c.text(error instanceof BodyTooLargeError ? "cleaned up" : "other", 507);
      }
    });
    const response = await app.request("/write", streamedInit("POST", probeBody(LIMIT + 1)));
    expect({ status: response.status, said: await response.text() }).toEqual({
      status: 507,
      said: "cleaned up",
    });
  });
});
