// The evolution-candidate dev tracer routes — Module 4.6/01. Route-level proof
// of the living demo: the developer-panel affordance admits a live capability
// plus a hand-typed intent, the trace streams the candidate assembling, and the
// terminal presentation carries the accepted candidate (or the warm rejection)
// into the developer preview while the displaced View is restored. Nothing
// durable changes either way: no version bump, no commit event, no metrics
// lifecycle row. Driven entirely through fake providers — no network, no spend.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  readSse,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import {
  type CandidateDraft,
  candidateFrom,
  journalCapabilityRow,
  makeCandidateProvider,
  shelvesCapabilityRow,
} from "./builder/candidate.test-support.ts";
import {
  CANDIDATE_ACCEPTED_NOTICE,
  CANDIDATE_REJECTED_NOTICE,
} from "./pipeline/terminal-presentation.ts";
import { compareAndSwapCapability, getCapability, insertCapability } from "./registry/index.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("aluna-evolution-candidate-");
  insertCapability(journalCapabilityRow(), env.conns.readwrite);
  insertCapability(shelvesCapabilityRow(), env.conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

function scratchApp(response: unknown) {
  const { recordMetrics, rows, lifecycles } = makeMetricsRecorder();
  const { provider, prompts } = makeCandidateProvider(response);
  const app = makeScratchApp(env, provider, recordMetrics);
  return { app, prompts, rows, lifecycles };
}

async function admitTrace(app: ReturnType<typeof scratchApp>["app"], intent: string) {
  const res = await app.request("/demo/evolution-candidate/journal", {
    method: "POST",
    body: new URLSearchParams({ intent }),
  });
  expect(res.status).toBe(200);
  const fragment = await res.text();
  const jobId = buildJobIdFromSubscriber(fragment);
  return { fragment, jobId, streamPath: `/demo/evolution-candidate/build/${jobId}/stream` };
}

describe("the developer-panel affordance", () => {
  test("a full-page capability load renders the intent form targeting that capability", async () => {
    const { app } = scratchApp(candidateFrom(journalCapabilityRow()));
    const res = await app.request("/capability/journal");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="developer-evolution-candidate-control"');
    expect(html).toContain('hx-post="/demo/evolution-candidate/journal"');
    expect(html).toContain('name="intent"');
    expect(html).toContain("Evolution candidate");
    expect(html).toContain('id="spec-candidate-preview"');
  });

  test("the cold-start shell keeps the empty placeholder — no capability, no form", async () => {
    const bare = createScratchDbEnv("aluna-evolution-candidate-bare-");
    try {
      const { recordMetrics } = makeMetricsRecorder();
      const { provider } = makeCandidateProvider({});
      const app = makeScratchApp(bare, provider, recordMetrics);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('<div id="developer-evolution-candidate-control"></div>');
      expect(html).not.toContain('hx-post="/demo/evolution-candidate/');
    } finally {
      teardownScratchDbEnv(bare);
    }
  });
});

describe("admission", () => {
  test("an unknown capability is a warm 404", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/ghosts", {
      method: "POST",
      body: new URLSearchParams({ intent: "Add something" }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("I can't find that here");
  });

  test("a blank intent is a warm 422 and admits nothing", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/journal", {
      method: "POST",
      body: new URLSearchParams({ intent: "   " }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Tell me what you'd like to change first.");
  });

  test("an admitted trace returns the build subscriber wired to its own stream", async () => {
    const { app } = scratchApp(candidateFrom(journalCapabilityRow()));
    const { fragment, jobId } = await admitTrace(app, "Add a mood field");
    expect(fragment).toContain(`/demo/evolution-candidate/build/${jobId}/stream`);
    expect(fragment).toContain(`/demo/evolution-candidate/build/${jobId}/cancel`);
  });

  test("cancelling an unknown job is a 404", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/build/missing/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("an accepted candidate", () => {
  test("streams the trace and hands the validated candidate to the developer preview", async () => {
    const authored = candidateFrom(journalCapabilityRow());
    authored.schema.fields.push({
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "active",
    });
    const { app, prompts, rows, lifecycles } = scratchApp(authored);
    const { jobId, streamPath } = await admitTrace(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    // Foreground narration stays in product voice: the intent line, then the
    // accepted notice — never an internals word.
    const narration = eventData(events, "narration");
    expect(narration).toContain("Let me think through that change.");
    expect(narration).toContain(CANDIDATE_ACCEPTED_NOTICE);

    // The developer watches the candidate assemble, then receives the accepted
    // candidate — the exact validated value the Diff stage (4.6/02) consumes.
    expect(eventData(events, "spec-preview")).toContain('"mood"');
    const preview = JSON.parse(eventData(events, "candidate-preview"));
    expect(preview.kind).toBe("evolution-candidate-preview");
    expect(preview.status).toBe("accepted");
    expect(preview.capabilityId).toBe("journal");
    expect(preview.committedVersion).toBe(1);
    expect(preview.proposedAction).toBe("Add a mood field");
    expect(preview.candidate).toEqual(JSON.parse(JSON.stringify(authored)));
    expect(preview.issues).toBeUndefined();

    // The displaced View is restored and the stream closes warm.
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("ok");

    // The prompt carried the hand-typed intent; the trace changed nothing
    // durable: no commit event, no version bump, no metrics lifecycle row.
    expect(prompts[0]).toContain("Add a mood field");
    expect(eventData(events, "commit")).toBe("");
    expect(eventData(events, "metrics-preview")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    expect(rows).toHaveLength(0);
    expect(lifecycles).toHaveLength(0);
    expect(jobId.length).toBeGreaterThan(0);
  });
});

describe("a rejected candidate", () => {
  test("streams the warm rejection with every violation in the developer preview", async () => {
    const authored = candidateFrom(journalCapabilityRow());
    authored.schema.fields = authored.schema.fields.filter(
      (field) => field.name !== "archived_reason",
    );
    const { app, rows } = scratchApp(authored);
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

    // Warm rejection, not a crash — and still nothing durable.
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    expect(rows).toHaveLength(0);
  });
});

describe("a stale target", () => {
  test("a capability changed between admit and lease fails the trace, not the registry", async () => {
    const draft: CandidateDraft = candidateFrom(journalCapabilityRow());
    const { app } = scratchApp(draft);
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
      "changed before its evolution trace began",
    );
    expect(eventData(events, "candidate-preview")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(2);
  });
});
