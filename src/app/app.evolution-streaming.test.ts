// The evolution run's streamed liveness.6/05, driven through the prompt bar
// Assembly is the long half of a
// run: several live regenerations plus the Gate. It streams like a v1 build rather than
// landing as one terminal payload — the derived plan first (it needs no model call), then
// the units, then the Gate — and a run that dies or is cancelled mid-assembly must close
// its running plan out rather than leaving the panel showing work nobody is doing. The
// submit/activate/reject seam lives in `app.evolution.test.ts`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  candidateFrom,
  journalCapabilityRow,
} from "../builder/evolution/candidate.test-support.ts";
import {
  createHandlerFor,
  itemRendererFor,
  makeSequenceProvider,
  searchHandlerFor,
  updateHandlerFor,
} from "../builder/gate/gate.test-support.ts";
import type { Provider } from "../provider/index.ts";
import { getCapability } from "../registry/index.ts";
import {
  buildEvolutionRouteGates,
  type EvolutionRouteFixture,
  journalEvolutionIntent,
  journalSpec,
  moodCandidate,
  moodEvolutionApp,
  pausingProvider,
  pinBehavioralTierOff,
  resolvedBy,
  scratchApp,
  setUpEvolutionRouteEnv,
  submitEvolution,
  tearDownEvolutionRouteEnv,
} from "./app.evolution.test-support.ts";
import {
  collectSseEvents,
  eventData,
  lastEventData,
  makeMetricsRecorder,
  makeScratchApp,
  readSse,
  type ScratchDbEnv,
} from "./app.test-support.ts";

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

/**
 * An app whose engine work is answered by `provider`, behind a resolver that classifies
 * `intentText` as one evolution of `journal`.
 */
function evolutionApp(provider: Provider, intentText: string) {
  const { recordMetrics } = makeMetricsRecorder();
  return makeScratchApp(
    env,
    resolvedBy(journalEvolutionIntent(intentText), provider),
    recordMetrics,
  );
}

describe("the streamed assembly", () => {
  test("streams the assembly plan, the units, and the Gate while the work runs", async () => {
    const candidate = moodCandidate();
    const { app, submit } = moodEvolutionApp(env, candidate, "Add a mood field");
    const { streamPath } = await submit();

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    const names = events.map((event) => event.event);
    const candidatePreviews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));

    // The running plan lands before any unit work: the whole shape of the evolution —
    // the added column and the copy/regenerate split — is visible while the units are
    // still being written, with no Gate verdict yet.
    expect(candidatePreviews.length).toBeGreaterThan(1);
    const running = candidatePreviews[0];
    expect(running.assembly.status).toBe("running");
    expect(running.assembly.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...running.assembly.copiedUnits].sort()).toEqual(["delete", "item", "read"]);
    expect(running.assembly.additiveMigration).toEqual([
      'ALTER TABLE "cap_journal" ADD COLUMN "mood" TEXT;',
    ]);
    // The prior-source decisions are already final in the running plan: admissibility is
    // deterministic, so a developer knows which units are seeing their old source before
    // the first of them is written.
    expect(running.assembly.priorSource).toEqual([
      { unit: "create", admitted: true },
      { unit: "update", admitted: true },
      { unit: "search", admitted: true },
    ]);
    expect(running.assembly.gate).toEqual([]);
    expect(names.indexOf("candidate-preview")).toBeLessThan(names.indexOf("units-preview"));

    // An evolution uses the capability's existing logo. Standing a second, build-id-keyed
    // tile beside it would say a second capability was being made, which is exactly what
    // an evolution is not — so no desk sidecar goes out before the terminal.
    expect(events.filter((event) => event.data.includes("data-provisional-logo"))).toHaveLength(0);

    // The units block fills as the regenerated units assemble, and the copied units join
    // the same inventory already complete — the developer sees all six, not a list at the end.
    const units = JSON.parse(lastEventData(events, "units-preview"));
    expect(units.status).toBe("complete");
    expect(units.units.map((unit: { name: string }) => unit.name).sort()).toEqual([
      "create",
      "delete",
      "item",
      "read",
      "search",
      "update",
    ]);
    expect(units.units.every((unit: { status: string }) => unit.status === "complete")).toBe(true);
    const copiedItem = units.units.find((unit: { name: string }) => unit.name === "item");
    expect(copiedItem.content).toBe(itemRendererFor(journalSpec()));
    expect(copiedItem.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    // The Gate verdict streams into its own block before the terminal candidate preview.
    const gate = JSON.parse(lastEventData(events, "gate-preview"));
    expect(gate.kind).toBe("gate-preview");
    expect(gate.rungs.find((rung: { rung: string }) => rung.rung === "structural").status).toBe(
      "passed",
    );
    expect(gate.rungs.find((rung: { rung: string }) => rung.rung === "smoke").status).toBe(
      "passed",
    );
    expect(names.lastIndexOf("gate-preview")).toBeLessThan(names.lastIndexOf("candidate-preview"));

    // The terminal preview is the complete one: same plan, now carrying the Gate.
    expect(candidatePreviews.at(-1).assembly.status).toBe("complete");
    expect(candidatePreviews.at(-1).assembly.gate.length).toBeGreaterThan(0);
  });

  // A trace that dies mid-assembly must not leave the panel showing a plan that nothing
  // is working on any more.
  test("a failed assembly closes out the running plan instead of leaving it hanging", async () => {
    const candidate = moodCandidate();
    // The candidate authors fine; the create Handler never passes its checks, so its
    // bounded write→check→fix loop exhausts and the assembly throws.
    const { provider } = makeSequenceProvider([
      candidate,
      { content: "export default 'not a handler';" },
      { content: "export default 'still not a handler';" },
    ]);
    const app = evolutionApp(provider, "Add a mood field");
    const { streamPath } = await submitEvolution(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    const previews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));
    expect(previews).toHaveLength(2);
    expect(previews[0].assembly.status).toBe("running");
    expect(previews.at(-1).assembly.status).toBe("failed");
    // The failure itself still reports through the error preview, and nothing durable moved.
    expect(eventData(events, "build-error-preview")).toContain("did not pass");
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
  });

  // Cancel is a deliberate stop, not a failure — and the plan must still be closed out.
  test("a cancelled assembly closes the plan out as cancelled", async () => {
    const candidate = moodCandidate();
    const { provider: queued } = makeSequenceProvider([
      candidate,
      { content: createHandlerFor(candidate) },
      { content: updateHandlerFor(candidate) },
      { content: searchHandlerFor(candidate) },
    ]);
    // Hold the last regeneration open so the cancel lands mid-assembly, deterministically.
    const { provider, reached, release } = pausingProvider(queued, 4);
    const app = evolutionApp(provider, "Add a mood field");
    const { jobId, streamPath } = await submitEvolution(app, "Add a mood field");
    const payload = readSse(await app.request(streamPath));

    await reached;
    const cancelled = await app.request(`/build/${jobId}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(202);
    release();

    const events = collectSseEvents(await payload);
    const previews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));
    expect(previews.at(-1).assembly.status).toBe("cancelled");
    // The Gate never ran, the View came back, and nothing durable moved.
    expect(eventData(events, "gate-preview")).toBe("");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("error");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
  });

  test("a measured no-op streams no assembly work at all", async () => {
    const { app, submit } = scratchApp(
      env,
      candidateFrom(journalCapabilityRow()),
      "Keep it exactly as it is",
    );
    const { streamPath } = await submit();

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    // Nothing to assemble: no units, no Gate, and exactly one terminal candidate preview.
    expect(eventData(events, "units-preview")).toBe("");
    expect(eventData(events, "gate-preview")).toBe("");
    expect(events.filter((event) => event.event === "candidate-preview")).toHaveLength(1);
  });
});

// A pre-flight guard for the homepage. Every event the run puts on the wire has to
// have somewhere to land in the browser: either a `sse-swap` region on the subscriber
// fragment, or a hidden preview listener whose `data-preview-target` is a real element in
// the shipped shell. An event with no home is invisible on the homepage — the failure mode
// that wastes a human sign-off rather than failing a test.
describe("the developer panel can receive everything the run emits", () => {
  test("every emitted event has a subscriber region and a live shell target", async () => {
    const candidate = moodCandidate();
    const { app, submit } = moodEvolutionApp(env, candidate, "Add a mood field");
    const { fragment, streamPath } = await submit();
    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    const emitted = [...new Set(events.map((event) => event.event))];
    expect(emitted.length).toBeGreaterThan(0);

    const swapped = new Set([...fragment.matchAll(/sse-swap="([^"]+)"/g)].map((match) => match[1]));
    // `done` is the stream's own close signal (`sse-close="done"`), not a swap target.
    for (const event of emitted) {
      if (event === "done") continue;
      expect(swapped.has(event)).toBe(true);
    }

    const shell = await (await app.request("/")).text();
    for (const [, target] of [...fragment.matchAll(/data-preview-target="([^"]+)"/g)]) {
      expect(shell).toContain(`id="${target}"`);
    }
  });
});
