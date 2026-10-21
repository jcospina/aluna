// A linking-only request whose step does not answer: the grace stops a stuck call so it
// cannot hold the build lease and every record save behind it, and a person who leaves is told
// nothing. Nothing is written either way. No test calls a real provider.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import {
  abortableProvider,
  type GenerateResult,
  type Provider,
} from "../../platform/provider/index.ts";
import { getCapability, readActiveRegistryCatalog } from "../../registry/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import { install } from "../../runtime/router/dispatch/router.test-support.ts";
import { PROMPT_BUILD_USAGE, promptBarSentences } from "../../server/app.test-support.ts";
import { AUTHORS, BOOKS, deskRow } from "../../server/routes/lifecycle/link.test-support.ts";
import type { IntentClassification } from "../intent/index.ts";
import type { BuildJob } from "../jobs/build-jobs.ts";
import { carriedResolverMeasurement } from "../metrics-recorder.ts";
import { FAILED_BUILD_ENDING } from "../streaming/terminal-presentation.ts";
import { runLinkingOnlyRequest } from "./linking-only-request.ts";

let env: ScratchDbEnv;
let quiet: ReturnType<typeof spyOn>;

const LINKING: IntentClassification = {
  type: "link_capability",
  confidence: 0.93,
  target_capability: BOOKS.id,
  resolution: "extend",
  proposed_identity: null,
  proposed_action: "Connect each book's author to Authors.",
  user_facing_label: "I'll connect your books to their authors.",
  related_capabilities: [AUTHORS.id],
  requires_confirmation: false,
};

/** A provider whose call never answers, the way a stuck one does; `asked` runs as it is made. */
function silent(asked: () => void): Provider {
  return {
    generate: (): GenerateResult<never> => {
      asked();
      return {
        partialStream: (async function* () {})(),
        object: new Promise(() => {}),
        usage: new Promise(() => {}),
      };
    },
  };
}

/** Run the request on the scratch desk, every event it sends kept, as the route would run it. */
function run(
  provider: Provider,
  context: { isAborted: () => boolean; signal?: AbortSignal },
  prepare: (coordinator: MutationCoordinator) => unknown = () => undefined,
) {
  const catalog = readActiveRegistryCatalog(env.conns.readonly);
  const ids = catalog.capabilities.map(({ id }) => id);
  const sent: { id: string; event: string; data: string }[] = [];
  const job: BuildJob = {
    id: "prompt-link",
    prompt: "link each book to its author",
    restoration: { kind: "neutral" },
    status: "running",
  };
  const coordinator = createMutationCoordinator();
  prepare(coordinator);
  const completion = runLinkingOnlyRequest({
    context: {
      job,
      send: async (event, data) => void sent.push({ id: "", event, data }),
      canPresent: () => !context.isAborted(),
      ...context,
    },
    provider,
    intent: LINKING,
    resolver: carriedResolverMeasurement(LINKING, PROMPT_BUILD_USAGE, 0, catalog.fingerprint, ids),
    catalog,
    buildDatabases: env.conns,
    mutationCoordinator: coordinator,
    terminalPresenterTimeoutMs: 1_000,
    graceMs: 20,
  });
  return { completion, sent, coordinator };
}

describe("a linking-only request whose step does not answer", () => {
  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-linking-only-grace-");
    install(env.conns, deskRow(BOOKS));
    install(env.conns, deskRow(AUTHORS));
    quiet = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    quiet.mockRestore();
    teardownScratchDbEnv(env);
  });

  test("is stopped when its grace runs out, lets the lease go and fails having written nothing", async () => {
    let asked = 0;
    const { completion, sent, coordinator } = run(
      silent(() => {
        asked += 1;
      }),
      { isAborted: () => false },
    );

    expect(await completion).toBe("terminal-sent");
    expect(asked).toBe(1);
    expect(coordinator.snapshot().activeLease).toBeNull();
    expect(getCapability(BOOKS.id, env.conns.readonly)?.relations).toStrictEqual([]);
    expect(promptBarSentences(sent).at(-1)).toBe(FAILED_BUILD_ENDING);
  });

  test("a lease the coordinator refuses is a failure said on the bar, and nothing is written", async () => {
    let asked = 0;
    const { completion, sent, coordinator } = run(
      silent(() => {
        asked += 1;
      }),
      { isAborted: () => false },
      (refusing) =>
        spyOn(refusing, "withBuildLease").mockRejectedValue(new Error("the coordinator is closed")),
    );

    expect(await completion).toBe("terminal-sent");
    expect(asked).toBe(0);
    expect(coordinator.snapshot().activeLease).toBeNull();
    expect(getCapability(BOOKS.id, env.conns.readonly)?.relations).toStrictEqual([]);
    expect(promptBarSentences(sent).at(-1)).toBe(FAILED_BUILD_ENDING);
  });

  test("says nothing to a person who left while it decided, and writes nothing", async () => {
    const left = new AbortController();
    // The route binds the provider to the job's signal before the request runs.
    const provider = abortableProvider(
      silent(() => left.abort()),
      left.signal,
    );
    const { completion, sent, coordinator } = run(provider, {
      isAborted: () => left.signal.aborted,
      signal: left.signal,
    });

    expect(await completion).toBeUndefined();
    expect(coordinator.snapshot().activeLease).toBeNull();
    expect(getCapability(BOOKS.id, env.conns.readonly)?.relations).toStrictEqual([]);
    expect(sent.some(({ event }) => event === "done")).toBe(false);
  });
});
