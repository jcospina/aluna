// The evolution dev tracer routes — Module 4.6/05. Route-level proof of the living
// demo: the content-area control admits a live capability plus a hand-typed
// intent, and the terminal presentation is one of exactly three shapes — an activated
// version behind a complete View swap, the measured no-op, or the warm rejection. The
// engine's own end-to-end battery lives in `src/pipeline/evolution/evolution-run.test.ts`
// and the streamed liveness in `app.evolution-streaming.test.ts`; this file owns the
// admit/activate/reject seam. Driven through fake providers — no spend.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CandidateDraft,
  candidateFrom,
  journalCapabilityRow,
  makeCandidateProvider,
} from "../builder/evolution/candidate.test-support.ts";
import {
  createHandlerFor,
  makeSequenceProvider,
  searchHandlerFor,
  updateHandlerFor,
} from "../builder/gate/gate.test-support.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import {
  CANDIDATE_NO_CHANGE_NOTICE,
  CANDIDATE_REJECTED_NOTICE,
} from "../pipeline/streaming/terminal-presentation.ts";
import { compareAndSwapCapability, getCapability } from "../registry/index.ts";
import {
  admitTrace,
  buildEvolutionRouteGates,
  type EvolutionRouteFixture,
  moodCandidate,
  moodEvolutionApp,
  pinBehavioralTierOff,
  scratchApp,
  setUpEvolutionRouteEnv,
  tearDownEvolutionRouteEnv,
} from "./app.evolution.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  lastEventData,
  makeMetricsRecorder,
  makeScratchApp,
  readSse,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";

let env: ScratchDbEnv;
let fixture: EvolutionRouteFixture;
let restoreTier: () => void;

beforeAll(async () => {
  restoreTier = pinBehavioralTierOff();
  fixture = await buildEvolutionRouteGates();
});

afterAll(() => {
  restoreTier();
});

beforeEach(async () => {
  env = await setUpEvolutionRouteEnv(fixture);
});

afterEach(() => {
  tearDownEvolutionRouteEnv(env);
});

describe("the content-area living-demo control", () => {
  test("a full-page capability load renders the intent form outside the read-only panel", async () => {
    const { app } = scratchApp(env, candidateFrom(journalCapabilityRow()));
    const res = await app.request("/capability/journal");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('hx-post="/demo/evolution/journal"');
    expect(html).toContain('name="intent"');
    expect(html).toContain("Evolution candidate");
    expect(html).toContain('id="spec-candidate-preview"');
    const content = html.slice(
      html.indexOf('<main class="content">'),
      html.indexOf("</main>") + "</main>".length,
    );
    const panel = html.slice(
      html.indexOf('<aside class="devbar" id="developer-panel"'),
      html.indexOf("</aside>") + "</aside>".length,
    );
    expect(content).toContain('class="capability-evolution"');
    expect(content).toContain('hx-post="/demo/evolution/journal"');
    expect(panel).toContain('id="spec-candidate-preview"');
    expect(panel).not.toContain('class="capability-evolution"');
    expect(panel).not.toContain('hx-post="/demo/evolution/');
    expect(panel).not.toContain('name="intent"');
  });

  test("the cold-start shell has no capability and therefore no evolution form", async () => {
    const bare = createScratchDbEnv("aluna-evolution-bare-");
    try {
      const { recordMetrics } = makeMetricsRecorder();
      const { provider } = makeCandidateProvider({});
      const app = makeScratchApp(bare, provider, recordMetrics);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).not.toContain("developer-evolution-control");
      expect(html).not.toContain('class="capability-evolution"');
      expect(html).not.toContain('hx-post="/demo/evolution/');
    } finally {
      teardownScratchDbEnv(bare);
    }
  });
});

describe("admission", () => {
  test("an unknown capability is a warm 404", async () => {
    const { app } = scratchApp(env, {});
    const res = await app.request("/demo/evolution/ghosts", {
      method: "POST",
      body: new URLSearchParams({ intent: "Add something" }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("I can't find that here");
  });

  test("a blank intent is a warm 422 and admits nothing", async () => {
    const { app } = scratchApp(env, {});
    const res = await app.request("/demo/evolution/journal", {
      method: "POST",
      body: new URLSearchParams({ intent: "   " }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Tell me what you'd like to change first.");
  });

  test("an admitted trace returns the build subscriber wired to its own stream", async () => {
    const { app } = scratchApp(env, candidateFrom(journalCapabilityRow()));
    const { fragment, jobId } = await admitTrace(app, "Add a mood field");
    expect(fragment).toContain(`/demo/evolution/build/${jobId}/stream`);
    expect(fragment).toContain(`/demo/evolution/build/${jobId}/cancel`);
  });

  test("cancelling an unknown job is a 404", async () => {
    const { app } = scratchApp(env, {});
    const res = await app.request("/demo/evolution/build/missing/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("an accepted candidate", () => {
  test("streams the run and activates the next version behind one complete View swap", async () => {
    const candidate = moodCandidate();
    const { app, prompts, lifecycles } = moodEvolutionApp(env, candidate);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    // Foreground narration stays in product voice — no internals leak (ARCH §9.7).
    const narration = eventData(events, "narration");
    expect(narration).toContain("Let me think through that change.");
    expect(narration).not.toMatch(/handler|spec|migration|schema|gate/i);

    // The developer receives the accepted candidate and the Diff Engine's facts/work plan.
    expect(eventData(events, "spec-preview")).toContain('"mood"');
    const preview = JSON.parse(lastEventData(events, "candidate-preview"));
    expect(preview.status).toBe("accepted");
    expect(preview.capabilityId).toBe("journal");
    expect(preview.committedVersion).toBe(1);
    expect(preview.candidate).toEqual(JSON.parse(JSON.stringify(candidate)));
    expect(preview.diff.isNoop).toBe(false);
    expect(preview.diff.facts).toEqual([
      { kind: "new_active_field", field: "mood", fieldType: "string" },
    ]);
    expect(preview.diff.workPlan.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect(preview.diff.workPlan.platformWork).toEqual(["add_column", "platform_form_detail"]);

    // 4.6/03: the executed-work summary — regenerated vs. byte-copied units, the additive
    // DDL, and the Gate over the assembled snapshot.
    expect(preview.assembly.status).toBe("complete");
    expect(preview.assembly.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...preview.assembly.copiedUnits].sort()).toEqual(["delete", "item", "read"]);
    expect(preview.assembly.additiveMigration).toEqual([
      'ALTER TABLE "cap_journal" ADD COLUMN "mood" TEXT;',
    ]);
    // 4.6/04: and per regenerated unit, whether its prior committed source was admitted
    // into the regeneration prompt. Adding a field takes nothing away, so all three fit.
    expect(preview.assembly.priorSource).toEqual([
      { unit: "create", admitted: true },
      { unit: "update", admitted: true },
      { unit: "search", admitted: true },
    ]);
    const gate = Object.fromEntries(
      preview.assembly.gate.map((rung: { rung: string; status: string }) => [
        rung.rung,
        rung.status,
      ]),
    );
    expect(gate.structural).toBe("passed");
    expect(gate.smoke).toBe("passed");

    // 4.6/05: the run does not stop at the candidate. It publishes, activates, and swaps
    // the complete View exactly once — `commit` is reserved for a real pointer activation,
    // so there is no restoring `fragment` on this path at all.
    expect(prompts[0]).toContain("Add a mood field");
    expect(events.filter((event) => event.event === "commit")).toHaveLength(1);
    expect(eventData(events, "commit")).toContain('data-active-capability-version="2"');
    expect(eventData(events, "fragment")).toBe("");
    expect(eventData(events, "done")).toBe("ok");
    const commitPreview = JSON.parse(eventData(events, "commit-preview"));
    expect(commitPreview.version).toBe(2);
    // 4.7/03: the published-version pane names the transition row this version landed on, so
    // "why does this version carry (no) frozen tests?" is answerable without opening the
    // predecessor's manifest. A first build has no predecessor and omits it.
    expect(commitPreview.behavioralTierTransition).toMatchObject({
      prior: expect.stringMatching(/^(on|off)$/u),
      candidate: expect.stringMatching(/^(on|off)$/u),
      artifacts: expect.stringMatching(/^(present|absent)$/u),
    });
    expect(commitPreview.behavioralTierTransition.rows.length).toBeGreaterThan(0);

    // The registry points at v2, and the added column is live on the existing table.
    const live = getCapability("journal", env.conns.readonly);
    expect(live?.version).toBe(2);
    expect(live?.artifacts_path).toContain("/v2/");
    expect(
      env.conns.readonly
        .query('SELECT "name" FROM pragma_table_info(?)')
        .all("cap_journal")
        .map((column) => (column as { name: string }).name),
    ).toContain("mood");

    // …and the durable lifecycle row is the one an activated build writes.
    expect(lifecycles.at(-1)).toMatchObject({ lifecycleStatus: "success", outcome: "activated" });
    expect(JSON.parse(eventData(events, "metrics-preview")).outcome).toBe("activated");
  });

  test("routes the surviving records through the new version's handlers", async () => {
    const candidate = moodCandidate();
    const metrics = makeMetricsRecorder();
    const { provider } = makeSequenceProvider([
      candidate,
      { content: createHandlerFor(candidate) },
      { content: updateHandlerFor(candidate) },
      { content: searchHandlerFor(candidate) },
    ]);
    // A spy loader records which version directory each Action was loaded from — the
    // proof that the router follows the swapped pointer, not a cached v1.
    const loadedPaths: string[] = [];
    const app = createApp({
      getProvider: () => provider,
      recordMetrics: metrics.recordMetrics,
      buildDatabases: env.conns,
      artifactsRoot: env.artifactsRoot,
      capabilityRouter: {
        databases: env.conns,
        loadHandler: async (artifactsPath, action) => {
          loadedPaths.push(artifactsPath);
          const module = (await import(
            pathToFileURL(join(artifactsPath, `${action}.ts`)).href
          )) as {
            default: () => Promise<string>;
          };
          return module.default;
        },
        loadItemRenderer: async (artifactsPath) => {
          loadedPaths.push(artifactsPath);
          const module = (await import(pathToFileURL(join(artifactsPath, "item.ts")).href)) as {
            default: (record: Record<string, unknown>) => string;
          };
          return module.default;
        },
      },
      mutationCoordinator: createMutationCoordinator(),
    });

    // One record written under v1, before the new column existed.
    env.conns.readwrite.run('INSERT INTO "cap_journal" ("id", "title", "tags") VALUES (?, ?, ?)', [
      "entry-1",
      "written before mood existed",
      JSON.stringify([]),
    ]);

    const res = await app.request("/demo/evolution/journal", {
      method: "POST",
      body: new URLSearchParams({ intent: "Add a mood field" }),
    });
    const jobId = buildJobIdFromSubscriber(await res.text());
    await readSse(await app.request(`/demo/evolution/build/${jobId}/stream`));
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(2);

    const read = await app.request("/capability/journal/read");
    expect(read.status).toBe(200);
    // Decision 13 through the router: `read` was byte-copied, so its SQL never mentions
    // `mood` — yet the record it renders is the rehydrated canonical row, and it is the
    // record the user already had.
    expect(await read.text()).toContain("written before mood existed");
    expect(loadedPaths.every((path) => path.includes("/v2/"))).toBe(true);
  });
});

describe("a measured no-op", () => {
  test("a semantically identical candidate is success/no_change with the View restored", async () => {
    // The provider re-authors the exact committed spec — a semantic no-op.
    const identical = candidateFrom(journalCapabilityRow());
    const { app, rows, lifecycles } = scratchApp(env, identical);
    const { streamPath } = await admitTrace(app, "Keep it exactly as it is");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    // The dev preview reports the zero-fact Diff as the measured no-op.
    const preview = JSON.parse(eventData(events, "candidate-preview"));
    expect(preview.status).toBe("no_change");
    expect(preview.diff.isNoop).toBe(true);
    expect(preview.diff.facts).toEqual([]);
    expect(preview.diff.workPlan.regeneratedUnits).toEqual([]);

    // Metrics finalize success/no_change with every downstream stage skipped.
    const metrics = JSON.parse(eventData(events, "metrics-preview"));
    expect(metrics.lifecycleStatus).toBe("success");
    expect(metrics.outcome).toBe("no_change");
    expect(metrics.stages).toEqual(
      expect.arrayContaining([{ stage: "activation", state: "skipped" }]),
    );
    const finalLifecycle = lifecycles.at(-1);
    expect(finalLifecycle?.lifecycleStatus).toBe("success");
    expect(finalLifecycle?.outcome).toBe("no_change");

    // Warm close in product voice, committed View restored, no version bump.
    expect(eventData(events, "narration")).toContain(CANDIDATE_NO_CHANGE_NOTICE);
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("ok");
    expect(eventData(events, "commit")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    // The legacy terminal row and the running→success lifecycle are both recorded.
    expect(rows).toHaveLength(1);
    expect(finalLifecycle).toBeDefined();
  });
});

describe("a rejected candidate", () => {
  test("streams the warm rejection with every violation in the developer preview", async () => {
    const authored = candidateFrom(journalCapabilityRow());
    authored.schema.fields = authored.schema.fields.filter(
      (field) => field.name !== "archived_reason",
    );
    const { app, lifecycles } = scratchApp(env, authored);
    const { streamPath } = await admitTrace(app, "Forget the archive note");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    const narration = eventData(events, "narration");
    expect(narration).toContain(CANDIDATE_REJECTED_NOTICE);

    const preview = JSON.parse(eventData(events, "candidate-preview"));
    expect(preview.status).toBe("rejected");
    expect(preview.candidate).toBeUndefined();
    expect(
      preview.issues.some((issue: { message: string }) =>
        issue.message.includes('committed field "archived_reason" must be returned exactly once'),
      ),
    ).toBe(true);

    // Warm rejection, not a crash: the pointer never moves, and the durable row closes
    // at the stage the candidate failed its own gate ("failure is data", ARCH §9.6).
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "commit")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    expect(lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "spec_generation_failed",
    });
  });
});

describe("a stale target", () => {
  test("a capability changed between admit and lease fails the trace, not the registry", async () => {
    const draft: CandidateDraft = candidateFrom(journalCapabilityRow());
    const { app } = scratchApp(env, draft);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    // Another build activates v2 before this trace reaches the queue head.
    const journal = journalCapabilityRow();
    compareAndSwapCapability(
      journalCapabilityRow({
        version: 2,
        artifacts_path: `capabilities/journal/${journal.incarnation_id}/v2/`,
      }),
      {
        state: "active",
        capabilityId: journal.id,
        incarnationId: journal.incarnation_id,
        version: 1,
      },
      env.conns.readwrite,
    );

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "build-error-preview")).toContain(
      "changed before its evolution began",
    );
    expect(eventData(events, "candidate-preview")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(2);
  });
});
