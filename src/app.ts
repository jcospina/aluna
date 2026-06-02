// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). Every later epic attaches its routes here: the
// shell page, the SSE channel, the capability router (/capability/:id/:action),
// and file serving (/files/:key).
//
// At this stage (Epic 1.2, issue 01) it does the bare minimum: answer the root
// route and serve static assets. No shell markup, SSE, database, or capability
// logic yet — those land in later epics and build on this.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

export const app = new Hono();

// Root route. A 200 here proves the server is up. The next issue (1.2 issue 02)
// replaces this with the fixed shell HTML page; for now it is a plain stub.
app.get("/", (c) => c.text("omni-crud platform — server up"));

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
