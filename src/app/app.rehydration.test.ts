// Registry read-side payoff. The rehydration cases run against a scratch
// db shared with the router, so an injected (or freshly committed) capability shows
// up in the rehydrated toolbar and a click serves its cached view. Shared setup and
// fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../metrics/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { insertCapability } from "../registry/index.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  makePromptBuildProvider,
  NEW_CAPABILITY_INTENT,
  NOTES_INCARNATION_ID,
  NOTES_SPEC,
  notesCapabilityRow,
  responseText,
  runPromptBuild,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";

// The registry's read-side payoff: on load the capability toolbar
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

  test("an interrupted build is visible in the developer metrics preview after restart", async () => {
    startGenerationLifecycle(
      {
        buildId: "build-interrupted-preview",
        incarnationId: "33333333-3333-4333-8333-333333333333",
      },
      conns.readwrite,
    );
    reconcileRunningGenerationLifecycles(conns.readwrite);
    const app = createApp({ capabilityRouter: { databases: conns } });

    const html = await responseText(await app.request("/"));

    expect(html).toContain('id="spec-metrics-preview"');
    expect(html).toContain("build-interrupted-preview");
    expect(html).toContain("&quot;lifecycleStatus&quot;: &quot;interrupted&quot;");
    expect(html).toContain("&quot;outcome&quot;: &quot;interrupted&quot;");
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
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });

    // Build the Notes capability through the prompt bar's real commit path (fake provider).
    const { payload } = await runPromptBuild(app, "track my notes");
    expect(payload).toContain("event: commit");

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

test("GET / lists committed versions per capability in the developer preview", async () => {
  const env = createScratchDbEnv("omni-crud-version-preview-");
  try {
    insertCapability(
      notesCapabilityRow({
        version: 2,
        artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v2/`,
      }),
      env.conns.readwrite,
    );
    const app = createApp({ capabilityRouter: { databases: env.conns } });

    const html = await responseText(await app.request("/"));

    expect(html).toContain("&quot;committedVersions&quot;");
    expect(html).toContain("&quot;liveVersion&quot;: 2");
    expect(html).toContain("&quot;versions&quot;: [");
  } finally {
    teardownScratchDbEnv(env);
  }
});
