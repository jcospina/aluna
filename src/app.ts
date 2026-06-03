// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). Every later epic attaches its routes here: the
// shell page, the SSE channel, the capability router (/capability/:id/:action),
// and file serving (/files/:key).
//
// At this stage (Epic 1.2, issue 02) it serves the fixed shell page at `/` and
// static assets under /static/*. No SSE, database, or capability logic yet —
// those land in later epics and build on this.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

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
