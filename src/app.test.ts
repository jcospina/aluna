// Tests for the platform's one route file. The demo SSE channel (Epic 1.3) is
// exercised through app.request(), which drives app.fetch without binding a port
// — so no live server is needed. Incrementality is asserted structurally (the
// body arrives in more than one chunk, and every demo event is present), not via
// wall-clock timing, to stay non-flaky.

import { describe, expect, test } from "bun:test";

import { app } from "./app.ts";

describe("GET /demo/stream", () => {
  test("responds with SSE headers", async () => {
    const res = await app.request("/demo/stream");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    await res.body?.cancel();
  });

  test("streams demo events incrementally, then closes", async () => {
    const res = await app.request("/demo/stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("expected a readable SSE body");

    const decoder = new TextDecoder();
    let chunks = 0;
    let payload = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break; // stream terminated cleanly
      chunks += 1;
      payload += decoder.decode(value, { stream: true });
    }
    payload += decoder.decode();

    // More than one chunk proves the body streamed over time rather than
    // arriving as a single buffered blob.
    expect(chunks).toBeGreaterThan(1);

    // Every narration token, the HTML fragment, and the terminal event arrived.
    const narrationEvents = payload.match(/event: narration/g) ?? [];
    expect(narrationEvents).toHaveLength(5);
    expect(payload).toContain("event: fragment");
    expect(payload).toContain("event: done");
    expect(payload).toContain("Here's a little something I made.");
  });
});
