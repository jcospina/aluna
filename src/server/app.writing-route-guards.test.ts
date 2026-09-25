// Every writing route guards its own door (Module 7 PLAN decisions 9 and 10). The walk reads the
// app's own route table, so a writing route registered later — the upload route, the pending-only
// route — is held to both refusals without anyone remembering to list it here. Every door gets one
// refused probe of each kind, addressed and shaped so its route would spend if it ran; only a
// streaming door, whose route reads the body itself, is also probed with a counted body.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Context, Hono } from "hono";
import { findTargetHandler } from "hono/utils/handler";
import { CAPABILITY_PATH_PREFIX } from "#shell/routes.js";
import type { LogoGenerationProvider } from "../lifecycle/logo/index.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import type { Provider } from "../platform/provider/index.ts";
import { install, notesRow } from "../runtime/router/dispatch/router.test-support.ts";
import type { HandlerLoader, WireProtocolAction } from "../runtime/router/index.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import {
  type ProbeBody,
  probeBody,
  streamedInit,
} from "./http/writing-route-guard.test-support.ts";
import {
  guardStreamingRoute,
  guardWritingRoute,
  isPassThrough,
  passesThrough,
  type WritingRouteGuard,
  writingRouteGuard,
} from "./http/writing-route-guard.ts";

/**
 * The file cap the walked app is built with: cheap to probe past, and below the probe body's chunk
 * size, so a streaming route that answers before reading shows whether anything was pulled early.
 */
const PROBE_FILE_CAP = 16 * 1024;

const PROBED_CAPABILITY = notesRow();

/** Each path parameter names the installed capability, so a route that ran would act on it. */
const PARAM_SAMPLES: Record<string, string> = {
  id: PROBED_CAPABILITY.id,
  incarnation_id: PROBED_CAPABILITY.incarnation_id,
  action: "create" satisfies WireProtocolAction,
};

/** A form the prompt route would build from, the way a cross-site page would post it. */
const SPENDING_FORM = { head: "prompt=probe&", type: "application/x-www-form-urlencoded" };

interface Door {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly guard: WritingRouteGuard | undefined;
  readonly guardedFirst: boolean;
}

type RouteEntry = Hono["routes"][number];

const target = (route: RouteEntry | undefined): unknown =>
  route && findTargetHandler(route.handler);

const isAppWidePassThrough = (route: RouteEntry): boolean =>
  route.method === "ALL" && isPassThrough(target(route));

/**
 * Every entry that can carry a body and is neither a guard nor pass-through middleware, whatever
 * its arity or path: a handler taking `next`, and middleware registered with `use`, can write too.
 */
function isDoor(route: RouteEntry): boolean {
  if (route.method === "GET" || route.method === "HEAD") return false;
  return !writingRouteGuard(target(route)) && !isAppWidePassThrough(route);
}

/** A `{regex}` parameter gets the first of its sample and a number that the pattern accepts. */
function probePath(pattern: string): string {
  return pattern
    .replace(/:([^/{]+)(?:\{([^}]*)\})?/g, (_param, name: string, regex: string | undefined) => {
      const samples = [PARAM_SAMPLES[name] ?? "probe", "1"];
      const accepts = (sample: string) => !regex || new RegExp(`^(?:${regex})$`).test(sample);
      return samples.find(accepts) ?? "probe";
    })
    .replace(/\*/g, "probe");
}

function doors(app: Hono): Door[] {
  return app.routes.flatMap((route, index) => {
    if (!isDoor(route)) return [];
    const guardAt = app.routes.findIndex(
      (candidate) =>
        candidate.method === route.method &&
        candidate.path === route.path &&
        writingRouteGuard(target(candidate)) !== undefined,
    );
    return [
      {
        label: `${route.method} ${route.path}`,
        method: route.method === "ALL" ? "POST" : route.method,
        path: probePath(route.path),
        guard: writingRouteGuard(target(app.routes[guardAt])),
        guardedFirst: guardAt !== -1 && guardAt < index,
      },
    ];
  });
}

async function send(
  app: Hono,
  door: Door,
  body: ProbeBody,
  headers: Record<string, string> = {},
): Promise<number> {
  const response = await app.request(door.path, streamedInit(door.method, body, headers));
  // Drained, so a route that streams the body back, or reads it after answering, has done so.
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
}

function declarationProblems({ label, guard, guardedFirst }: Door): string[] {
  if (!guard) return [`${label} is registered without a writing-route guard`];
  if (!guardedFirst) return [`${label} is registered before its guard`];
  if (guard.streams && guard.maxBodyBytes !== PROBE_FILE_CAP) {
    return [`${label} accepts ${guard.maxBodyBytes}B where the file cap is ${PROBE_FILE_CAP}B`];
  }
  return [];
}

async function unreadProblems(app: Hono, door: Door, limit: number): Promise<string[]> {
  const problems: string[] = [];
  const crossSite = probeBody(limit, SPENDING_FORM.head);
  const crossSiteStatus = await send(app, door, crossSite, {
    "content-type": SPENDING_FORM.type,
    "sec-fetch-site": "cross-site",
  });
  if (crossSiteStatus !== 403 || crossSite.pulledBytes() > 0) {
    problems.push(
      `${door.label} answered a cross-site request ${crossSiteStatus} after ${crossSite.pulledBytes()}B`,
    );
  }
  const unread = probeBody(limit + 1, SPENDING_FORM.head);
  const status = await send(app, door, unread, {
    "content-type": SPENDING_FORM.type,
    "content-length": String(limit + 1),
  });
  if (status !== 413 || unread.pulledBytes() > 0) {
    problems.push(`${door.label} answered a declared ${limit + 1}B body ${status}`);
  }
  return problems;
}

/**
 * Past the limit a door answers 413, or answers without having read past it: an upload route
 * refuses an incarnation it does not know before it streams a byte.
 */
async function countedProblems(app: Hono, door: Door, limit: number): Promise<string[]> {
  const problems: string[] = [];
  const over = probeBody(limit + 1);
  const overStatus = await send(app, door, over);
  if (overStatus !== 413 && over.pulledBytes() > limit) {
    problems.push(`${door.label} read a chunked ${limit + 1}B body and answered ${overStatus}`);
  }
  const honestStatus = await send(app, door, probeBody(limit, "x="), {
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
  });
  if (honestStatus === 403 || honestStatus === 413) {
    problems.push(
      `${door.label} refused a same-origin body of exactly ${limit}B (${honestStatus})`,
    );
  }
  return problems;
}

/** What is wrong with one door; empty when both refusals hold and an honest body passes. */
async function auditDoor(app: Hono, door: Door): Promise<string[]> {
  const declared = declarationProblems(door);
  if (declared.length > 0 || !door.guard) return declared;
  const limit = door.guard.maxBodyBytes;
  const unread = await unreadProblems(app, door, limit);
  if (!door.guard.streams) return unread;
  return [...unread, ...(await countedProblems(app, door, limit))];
}

async function auditApp(app: Hono): Promise<string[]> {
  const problems: string[] = [];
  for (const door of doors(app)) problems.push(...(await auditDoor(app, door)));
  return problems;
}

async function flaggedPaths(app: Hono): Promise<string[]> {
  const flagged = (await auditApp(app)).map((problem) => problem.split(" ")[1] ?? problem);
  return [...new Set(flagged)].sort();
}

/** Open each path over a real socket, send part of a chunked body, hang up, and say what each got. */
async function hangUpMidBody(app: Hono, paths: readonly string[]): Promise<string[]> {
  const answered: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const response = await app.fetch(request);
      answered.push(`${new URL(request.url).pathname} ${response.status}`);
      return response;
    },
  });
  try {
    for (const path of paths) {
      const socket = await Bun.connect({
        hostname: server.url.hostname,
        port: Number(server.url.port),
        socket: { data() {} },
      });
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n` +
          `10\r\n${"a".repeat(16)}\r\n`,
      );
      await Bun.sleep(20);
      socket.end();
    }
    const deadline = Date.now() + 5000;
    while (answered.length < paths.length && Date.now() < deadline) await Bun.sleep(10);
    return answered.sort();
  } finally {
    server.stop(true);
  }
}

const wrote = async (c: Context) => c.text("wrote");

const readAll = async (c: Context) => c.text(String((await c.req.raw.arrayBuffer()).byteLength));

function quietApp(): Hono {
  const app = new Hono();
  app.onError((_error, c) => c.text("failed", 500));
  app.use(
    "*",
    passesThrough(async (_c, next) => next()),
  );
  return app;
}

describe("every writing route guards its own door", () => {
  let env: ScratchDbEnv;
  let spent: string[];

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-writing-route-guards-");
    install(env.conns, PROBED_CAPABILITY);
    spent = [];
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  function guardedApp(): Hono {
    const provider: Provider = {
      generate() {
        spent.push("provider");
        throw new Error("no refused or probing request reaches the provider");
      },
    };
    const logoProvider: LogoGenerationProvider = {
      generate() {
        spent.push("logo");
        return Promise.reject(new Error("no refused or probing request reaches the logo service"));
      },
    };
    const loadHandler: HandlerLoader = () => {
      spent.push("handler");
      return Promise.reject(new Error("no refused or probing request reaches a handler"));
    };
    return createApp({
      getProvider: () => provider,
      recordMetrics: makeMetricsRecorder().recordMetrics,
      buildDatabases: env.conns,
      artifactsRoot: env.artifactsRoot,
      capabilityRouter: { databases: env.conns, loadHandler },
      buildJobs: createBuildJobQueue({
        createId: () => {
          spent.push("build job");
          return "probe-job";
        },
      }),
      logoProvider,
      maxFileBytes: PROBE_FILE_CAP,
    });
  }

  test("each refuses another site and an oversized body, declared or counted, before it runs", async () => {
    const app = guardedApp();
    expect(doors(app).length).toBeGreaterThan(0);
    // Exempting middleware from the walk is a decision; a new one changes this line on purpose.
    const exempt = app.routes.filter(isAppWidePassThrough);
    expect(exempt.map((route) => `${route.method} ${route.path}`)).toEqual(["ALL /*"]);
    expect(await auditApp(app)).toEqual([]);
    expect(spent).toEqual([]);
  });

  test("a read through the record router is not a door, and another site may still ask", async () => {
    const response = await guardedApp().request(`${CAPABILITY_PATH_PREFIX}/probe/read`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(response.status).not.toBe(403);
  });

  test("an overflow a streaming route lets escape is answered 413, not logged as a failure", async () => {
    const app = guardedApp();
    app.post("/streamed", guardStreamingRoute(PROBE_FILE_CAP), readAll);
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app.request(
        "/streamed",
        streamedInit("POST", probeBody(PROBE_FILE_CAP + 1)),
      );
      expect(response.status).toBe(413);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test("a client that hangs up mid-body is not logged as a failure, streamed or buffered", async () => {
    const app = guardedApp();
    app.post("/streamed", guardStreamingRoute(PROBE_FILE_CAP), async (c) => {
      for await (const _chunk of c.req.raw.body ?? []) {
        // Drained as an upload route drains into its staging file.
      }
      return c.text("read");
    });
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const paths = ["/streamed", "/capability-rename/probe"];
      expect(await hangUpMidBody(app, paths)).toEqual(paths.map((path) => `${path} 400`).sort());
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe("the route walk", () => {
  test("finds every way a door can be left open", async () => {
    const app = quietApp();
    app.post("/unguarded", wrote);
    app.post("/takes-next", async (c, _next) => wrote(c));
    app.use("/middleware-writes", wrote);
    app.post("/guard-after", wrote);
    app.post("/guard-after", guardWritingRoute());
    app.post("/generous-stream", guardStreamingRoute(2 * PROBE_FILE_CAP), wrote);
    app.post("/swallows", guardStreamingRoute(PROBE_FILE_CAP), async (c) => {
      try {
        return await readAll(c);
      } catch {
        return c.text("swallowed", 507);
      }
    });
    app.post("/echoes", guardStreamingRoute(PROBE_FILE_CAP), (c) => new Response(c.req.raw.body));
    app.post("/exempted", passesThrough(wrote));
    const shared = async (c: Context, next: () => Promise<void>) => {
      await c.req.raw.arrayBuffer();
      await next();
    };
    app.use("/headers", passesThrough(shared));
    app.post("/shares", shared, wrote);
    const mounted = new Hono();
    mounted.post("/inside", wrote);
    app.route("/mounted", mounted);
    app.all("*", wrote);
    app.use(wrote);

    expect(await flaggedPaths(app)).toEqual([
      "/*",
      "/echoes",
      "/exempted",
      "/generous-stream",
      "/guard-after",
      "/middleware-writes",
      "/mounted/inside",
      "/shares",
      "/swallows",
      "/takes-next",
      "/unguarded",
    ]);
  });

  test("passes every door that is shut, however it is registered", async () => {
    const app = quietApp();
    app.all("/guarded/:id", guardWritingRoute(), wrote);
    app.post("/numbered/:id{[0-9]+}", guardWritingRoute(), wrote);
    app.post("/streamed", guardStreamingRoute(PROBE_FILE_CAP), readAll);
    app.post("/knows-nobody/:id", guardStreamingRoute(PROBE_FILE_CAP), (c) => c.text("who?", 404));
    app.on("HEAD", "/head", wrote);
    const inner = new Hono();
    inner.onError((_error, c) => c.text("inner failed", 500));
    inner.post("/inside", guardWritingRoute(), wrote);
    app.route("/mounted", inner);

    expect(doors(app).length).toBe(5);
    expect(await auditApp(app)).toEqual([]);
  });
});
