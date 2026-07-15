// Registry read-side payoff (Epic 2.1) plus the /stream provider-liveness slices.
// The rehydration cases run against a scratch db shared with the router, so an
// injected (or freshly committed) capability shows up in the rehydrated toolbar and
// a click serves its cached view. The /stream cases drive a fake provider — no
// network, no spend. Shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createScratchDbEnv,
  makeFakeProvider,
  makeMetricsRecorder,
  makeSpecProvider,
  NOTES_SPEC,
  notesCapabilityRow,
  readSse,
  responseText,
  teardownScratchDbEnv,
  throwingProvider,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import type { PlatformDatabase } from "./db.ts";
import { insertCapability } from "./registry/index.ts";

// Reassemble the text of every `narration` event, in order — the greeting as the
// client would see it typed in.
function collectNarration(payload: string): string {
  return payload
    .split("\n\n")
    .filter((block) => block.includes("event: narration"))
    .map(
      (block) =>
        block
          .split("\n")
          .find((line) => line.startsWith("data:"))
          // Strip the field name and the single optional separator space (SSE drops
          // one leading space from the value), keeping the value — including a value
          // that *is* a space.
          ?.replace(/^data: ?/, "") ?? "",
    )
    .join("");
}

// The registry's read-side payoff (Epic 2.1): on load the capability toolbar
// rehydrates from the registry — Aluna remembers you across a refresh. These run
// against a scratch db shared with the router, so an injected (or freshly committed)
// capability shows up in the rehydrated toolbar and a click serves its cached view.
describe("GET / (toolbar rehydration, Epic 2.1)", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-rehydrate-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  function countMatches(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  test("a fresh user (empty registry) stays cold-start — no entries, but the modal still mounts", async () => {
    const app = createApp({ capabilityRouter: { databases: conns } });
    const html = await responseText(await app.request("/"));

    // No entries, and the shell root never flips into has-capabilities — the sidebar
    // stays hidden. (The static page carries the `'has-capabilities'` Alpine binding
    // string regardless, so the check is on the root element's class.) The cold-start
    // prompt surface is intact.
    expect(html).not.toContain("data-capability-entry");
    expect(html).toContain('class="shell"');
    expect(html).not.toContain('class="shell has-capabilities"');
    expect(html).toContain('id="spec-build-output"');
    expect(html).toContain('hx-post="/prompt"');

    // Cold-start means no capabilities, never no modal: the shared detail modal mounts
    // even here, so the FIRST capability this user builds can open it without a refresh.
    expect(html).toContain('<dialog id="aluna-detail-modal"');
    expect(html).not.toContain("Shared detail modal mounts here"); // placeholder consumed
  });

  test("registry rows rehydrate the toolbar on load and flip has-capabilities", async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    insertCapability(
      notesCapabilityRow({
        id: "recipes",
        label: "Recipes",
        incarnation_id: "22222222-2222-4222-8222-222222222222",
        artifacts_path: "capabilities/recipes/22222222-2222-4222-8222-222222222222/v1/",
        prompt_context: "Stores the user's recipes.",
      }),
      conns.readwrite,
    );
    const app = createApp({ capabilityRouter: { databases: conns } });

    const html = await responseText(await app.request("/"));

    // The shell flips so the sidebar shows, and every registry row renders one
    // canonical toolbar entry pointing at the cached-view route a click serves.
    expect(html).toContain('class="shell has-capabilities"');
    expect(countMatches(html, "data-capability-entry")).toBe(2);
    expect(html).toContain('hx-get="/capability/notes"');
    expect(html).toContain('hx-push-url="/capability/notes"');
    expect(html).toContain('hx-get="/capability/recipes"');
    expect(html).toContain('hx-push-url="/capability/recipes"');
    // Ordered by id (the registry's stable order): notes before recipes.
    expect(html.indexOf("/capability/notes")).toBeLessThan(html.indexOf("/capability/recipes"));
    // The load path restores chrome only — no capability view is pre-served into the
    // content area (a toolbar click serves it).
    expect(html).not.toContain("capability-surface");
  });

  test("serving a committed capability reads the collection layout from ui_intent", async () => {
    insertCapability(
      notesCapabilityRow({
        ui_intent: {
          ...NOTES_SPEC.ui_intent,
          collection: { layout: "grid" },
        },
      }),
      conns.readwrite,
    );
    const app = createApp({ capabilityRouter: { databases: conns } });

    const res = await app.request("/capability/notes", { headers: { "HX-Request": "true" } });
    const body = await responseText(res);

    expect(res.status).toBe(200);
    expect(body).toContain('class="capability-records capability-records--grid"');
    expect(body).not.toContain('class="capability-records capability-records--feed"');
  });

  test("the M2 closing beat: build, refresh rehydrates the toolbar, and the note is still there", async () => {
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });

    // Build the Notes capability through the real commit path (fake provider).
    const buildPayload = await readSse(
      await app.request("/demo/spec-build?prompt=track%20my%20notes"),
    );
    expect(buildPayload).toContain("event: commit");

    // Persist a note through the committed capability's create action.
    const created = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Buy milk"],
        ["__aluna_present", "text"],
      ]).toString(),
    });
    expect(created.status).toBe(200);

    // Refresh the page (GET /): the toolbar rehydrates with the Notes entry and the
    // shell shows the sidebar — no AI call, no regeneration.
    const refreshed = await responseText(await app.request("/"));
    expect(refreshed).toContain('class="shell has-capabilities"');
    expect(refreshed).toContain("data-capability-entry");
    expect(refreshed).toContain('hx-get="/capability/notes"');
    expect(refreshed).toContain('hx-push-url="/capability/notes"');

    // Clicking the rehydrated entry serves the spec-rendered, data-free list scaffolding…
    const clicked = await app.request("/capability/notes", { headers: { "HX-Request": "true" } });
    const clickedBody = await clicked.text();
    expect(clicked.status).toBe(200);
    expect(clickedBody).toContain('class="capability-surface"');
    expect(clickedBody).toContain('hx-get="/capability/notes/read"');

    // …and its dynamic region loads the live record through the read action: the note
    // survived the refresh.
    const read = await app.request("/capability/notes/read");
    expect(await read.text()).toContain("Buy milk");
  });
});

describe("GET /stream (provider liveness, fake provider)", () => {
  const greeting = "Hi — I'm so glad you're here.";
  const invitation = "Tell me what you'd like to keep <3";

  test("responds with SSE headers", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const res = await app.request("/stream");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    await res.body?.cancel();
  });

  test("streams the greeting as narration, then the invitation fragment, then closes", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const payload = await readSse(await app.request("/stream"));

    // The greeting arrived incrementally and reassembles to the whole thing.
    expect((payload.match(/event: narration/g) ?? []).length).toBeGreaterThan(1);
    expect(collectNarration(payload)).toBe(greeting);

    // The invitation rides in an HTML fragment, with its dynamic text escaped — the
    // raw "<3" must not reach the page as markup.
    expect(payload).toContain("event: fragment");
    expect(payload).toContain('<p class="intro__invitation">');
    expect(payload).toContain("keep &lt;3");
    expect(payload).not.toContain("keep <3");

    // Terminal event, server closes cleanly.
    expect(payload).toContain("event: done");
  });
});

describe("GET /stream (failure surfaces clearly, not silently)", () => {
  test("a missing key streams a product-voice apology, never a crash", async () => {
    // createProvider would throw "Missing OMNI_API_KEY ..."; the route must turn
    // that into a warm, jargon-free message — and still close cleanly (HTTP 200,
    // an SSE stream, not a 500).
    const app = createApp({ getProvider: throwingProvider("Missing OMNI_API_KEY. ...") });
    const res = await app.request("/stream");
    expect(res.status).toBe(200);

    const payload = await readSse(res);
    expect(payload).toContain("event: narration");
    expect(payload).toMatch(/mind trying again/i);
    expect(payload).toContain("event: done");
    // No internals leak into the UI copy (ARCH §9.7).
    expect(payload).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // No proposal fragment on the error path.
    expect(payload).not.toContain("event: fragment");
  });
});
