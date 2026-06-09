// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). Every later epic attaches its routes here: the
// shell page, the SSE channel, the capability router (/capability/:id/:action),
// and file serving (/files/:key).
//
// At this stage it serves the fixed shell page at `/`, static assets under
// /static/*, and a demo SSE channel at /demo/stream (Epic 1.3). No database or
// capability logic yet — those land in later epics and build on this.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";

export const app = new Hono();

// Root route — the fixed shell (ARCH §6.1). Returns the authored static page
// public/index.html via Bun.file, read per request (Bun file I/O is
// microsecond-fast and stays live under `bun --watch`). Content-Type is set
// explicitly: Bun infers it from the file, but that lazily-computed header is
// dropped when the Response passes through Hono's router. Kept as an explicit
// route — rather than a serveStatic fall-through — so `/` stays greppable for
// later epics and `app.request("/")`-testable.
app.get(
  "/",
  () =>
    new Response(Bun.file("./public/index.html"), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
);

// Demo SSE channel (ARCH §4, §6.2) — a stand-in for the future build narration
// that will power "watch the UI build itself". It streams product-voice tokens
// incrementally, then a small HTML fragment, then closes cleanly. No generation
// or domain logic; the content is demo-only. GET (so the next epic can consume it
// with EventSource, and `curl -N` can verify it) under the /demo/* prefix, which
// marks it clearly removable and out of the reserved real routes
// (/capability/:id/:action, /files/:key, the production SSE channel).
//
// streamSSE sets the SSE headers (text/event-stream, no-cache, keep-alive) and
// closes the connection when the callback returns.
const DEMO_NARRATION = ["Got it — ", "putting that ", "together ", "for you ", "now…"];
const DEMO_FRAGMENT = `<p class="demo-build">Here's a little something I made. ✨</p>`;
const DEMO_TICK_MS = 120;

app.get("/demo/stream", (c) =>
  streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    let id = 0;
    for (const token of DEMO_NARRATION) {
      if (aborted) return;
      await stream.writeSSE({ id: String(id++), event: "narration", data: token });
      await stream.sleep(DEMO_TICK_MS);
    }
    if (aborted) return;
    await stream.writeSSE({ id: String(id++), event: "fragment", data: DEMO_FRAGMENT });
    await stream.writeSSE({ id: String(id++), event: "done", data: "ok" });
  }),
);

// Static assets live in ./public and are served under the /static/* prefix
// (e.g. the shell's CSS/JS will be referenced as /static/<file>). A dedicated
// prefix keeps the asset namespace clear of the root-level route conventions
// that arrive later (/capability/:id/:action, /files/:key, the SSE channel).
// rewriteRequestPath strips the prefix so /static/app.css resolves to
// ./public/app.css rather than ./public/static/app.css.
app.use(
  "/static/*",
  serveStatic({
    root: "./public",
    rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
  }),
);
