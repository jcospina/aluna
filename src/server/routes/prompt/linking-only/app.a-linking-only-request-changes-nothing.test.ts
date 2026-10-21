// A linking-only request that changes nothing: a step that fails, finds nothing or can
// join nothing, a desk that moved, a write that fails partway, a lease that runs out and a cancel
// each leave Books as it was and say so on the prompt bar, or clear it for a cancel. Driven through
// POST /prompt with a fake provider; no test calls a real one.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  FAILED_BUILD_ENDING,
  STALE_BUILD_ENDING,
} from "../../../../pipeline/streaming/terminal-presentation.ts";
import type { GenerateResult, Provider } from "../../../../platform/provider/index.ts";
import {
  connectingNote,
  NOTHING_TO_CONNECT,
} from "../../../../presentation/controls/link/link-copy.ts";
import { FIFTH_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import { getCapability } from "../../../../registry/index.ts";
import * as store from "../../../../registry/store/store.ts";
import { createMutationCoordinator } from "../../../../runtime/concurrency/mutation-coordinator.ts";
import { install } from "../../../../runtime/router/dispatch/router.test-support.ts";
import { eventData, lastEventData, teardownScratchDbEnv } from "../../../app.test-support.ts";
import { PROMPT_REFUSAL_ATTRIBUTE } from "../../../http/fragments/fragments.ts";
import {
  AUTHORS,
  BOOKS,
  type DeskCapability,
  deskRow,
  MEMOS,
  READING_LOG,
} from "../../lifecycle/link.test-support.ts";
import {
  AUTHOR_TO_NAME,
  answering,
  ask,
  freshDesk,
  isLinkPrompt,
  LINKING,
  type LinkingDesk,
  linkRows,
  RESOLVING,
  start,
  TITLE_TO_LOG,
  withLinkStep,
} from "./linking-only.test-support.ts";

let desk: LinkingDesk;
let quiet: ReturnType<typeof spyOn>;

beforeEach(() => {
  quiet = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  teardownScratchDbEnv(desk.env);
});

/** A capability that keeps no single-line text field, so nothing can pick from it. */
const RATINGS: DeskCapability = {
  id: "ratings",
  label: "Ratings",
  noun: "rating",
  plural: "ratings",
  incarnation: FIFTH_INCARNATION_ID,
  fields: [{ name: "stars", label: "Stars", type: "number", required: false, lifecycle: "active" }],
};

const down = (): GenerateResult<never> => {
  throw new Error("the provider is down");
};

const NOTE = connectingNote(BOOKS.plural, AUTHORS.plural);

describe("a linking-only request that changes nothing", () => {
  test.each([
    ["fails", FAILED_BUILD_ENDING, LINKING, true, "error"],
    ["finds nothing", NOTHING_TO_CONNECT, LINKING, true, "ok"],
    [
      "has nothing flagged",
      NOTHING_TO_CONNECT,
      { ...LINKING, related_capabilities: [] },
      false,
      "ok",
    ],
    [
      "can join nothing",
      NOTHING_TO_CONNECT,
      { ...LINKING, related_capabilities: [RATINGS.id] },
      false,
      "ok",
    ],
    [
      "targets no capability on the desk",
      FAILED_BUILD_ENDING,
      { ...LINKING, target_capability: "ghosts" },
      false,
      "error",
    ],
  ])("a request whose step %s says so on the prompt bar", async (how, sentence, intent, noted, done) => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    install(desk.env.conns, deskRow(RATINGS));
    const booksBefore = getCapability(BOOKS.id, desk.env.conns.readonly);
    const link = how === "finds nothing" ? { relations: [] } : { relations: [AUTHOR_TO_NAME] };
    const { provider } = answering(link, intent);
    const { events, sentences } = await ask(
      desk,
      how === "fails" ? withLinkStep(provider, down) : provider,
    );

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)).toStrictEqual(booksBefore);
    expect(linkRows(desk)).toBe(0);
    expect(sentences).toStrictEqual(noted ? [RESOLVING, NOTE, sentence] : [RESOLVING, sentence]);
    expect(lastEventData(events, "fragment")).toContain(PROMPT_REFUSAL_ATTRIBUTE);
    expect(eventData(events, "done")).toBe(done);
  });

  test("a write that fails partway undoes the relations and links written before it", async () => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    install(desk.env.conns, deskRow(READING_LOG));
    desk.env.conns.readwrite.run('INSERT INTO "cap_reading_log" ("id", "title") VALUES (?, ?)', [
      "entry-0",
      "Kindred",
    ]);
    const booksBefore = getCapability(BOOKS.id, desk.env.conns.readonly);
    const intent = { ...LINKING, related_capabilities: [AUTHORS.id, READING_LOG.id] };
    const { provider } = answering({ relations: [AUTHOR_TO_NAME, TITLE_TO_LOG] }, intent);
    const writing = store.writeCapabilityRelations;
    let writes = 0;
    const failing = spyOn(store, "writeCapabilityRelations").mockImplementation((...args) => {
      writes += 1;
      if (writes === 2) throw new Error("the disk is full");
      return writing(...args);
    });
    try {
      const { said } = await ask(desk, provider);
      expect(writes).toBe(2);
      expect(said).toBe(FAILED_BUILD_ENDING);
    } finally {
      failing.mockRestore();
    }
    expect(getCapability(BOOKS.id, desk.env.conns.readonly)).toStrictEqual(booksBefore);
    expect(linkRows(desk)).toBe(0);
  });

  test("a desk that changed after the request was read is refused before the step runs", async () => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    const { provider, prompts } = answering({ relations: [AUTHOR_TO_NAME] });
    const changing: Provider = {
      generate(prompt, schema) {
        const result = provider.generate(prompt, schema);
        if (prompts.length === 1) install(desk.env.conns, deskRow(MEMOS));
        return result;
      },
    };
    const { said, events } = await ask(desk, changing);

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([]);
    expect(prompts.some(isLinkPrompt)).toBe(false);
    expect(said).toBe(STALE_BUILD_ENDING);
    expect(eventData(events, "done")).toBe("error");
  });
});

describe("a linking-only request that is stopped", () => {
  test("a build lease that runs out while the step decides is a failure, not a cancel", async () => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    desk.coordinator = createMutationCoordinator({ buildLeaseTtlMs: 50 });
    const { provider } = answering(new Promise(() => {}));
    const { said } = await ask(desk, provider);

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([]);
    expect(said).toBe(FAILED_BUILD_ENDING);
  });

  test.each([
    "while the step decides",
    "while it waits for the build lease",
  ])("a request cancelled %s changes nothing and leaves the prompt bar empty", async (when) => {
    desk = freshDesk([["Kindred", "Octavia E. Butler"]]);
    const { coordinator } = desk;
    const asked = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<unknown>();
    const { provider, prompts } = answering(answer.promise);
    const parked: Provider = {
      generate(prompt, schema) {
        const result = provider.generate(prompt, schema);
        if (isLinkPrompt(prompt)) asked.resolve();
        return result;
      },
    };
    // Another build holds the lease, so the request queues behind it.
    const holding = Promise.withResolvers<void>();
    const held =
      when === "while the step decides"
        ? Promise.resolve()
        : coordinator.withBuildLease(coordinator.reserveBuild(), () => holding.promise);
    const queued = Promise.withResolvers<void>();
    const reserving = coordinator.reserveBuild.bind(coordinator);
    spyOn(coordinator, "reserveBuild").mockImplementation(() => {
      const reservation = reserving();
      queued.resolve();
      return reservation;
    });
    const run = await start(desk, parked);
    await (when === "while the step decides" ? asked.promise : queued.promise);
    expect((await run.cancel()).status).toBe(202);
    answer.resolve({ relations: [AUTHOR_TO_NAME] });
    const { events, sentences, preview } = await run.heard();
    holding.resolve();
    await held;

    expect(getCapability(BOOKS.id, desk.env.conns.readonly)?.relations).toStrictEqual([]);
    expect(linkRows(desk)).toBe(0);
    expect(prompts.filter(isLinkPrompt).length).toBe(when === "while the step decides" ? 1 : 0);
    expect(sentences.at(-1)).toBe("");
    expect(lastEventData(events, "fragment")).not.toContain(PROMPT_REFUSAL_ATTRIBUTE);
    expect(eventData(events, "done")).toBe("error");
    expect(preview).toMatchObject({ outcome: "cancelled" });
  });
});
