// A build's link step beside its tests and units: a step that answers is
// read and paid for, one still silent when the units are done gets a grace and no more, a build that
// ends stops it quietly, and the narration names what it connects. No test calls a real provider.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { makeSpecProvider } from "../../builder/spec/spec-gen.test-support.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import {
  abortableProvider,
  type GenerateResult,
  type Provider,
  type TokenUsage,
} from "../../platform/provider/index.ts";
import { buildConnecting } from "../../presentation/controls/link/link-copy.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import * as store from "../../registry/store/store.ts";
import { install } from "../../runtime/router/dispatch/router.test-support.ts";
import { NEW_CAPABILITY_INTENT, NOTES_INCARNATION_ID } from "../../server/app.test-support.ts";
import { escapeHtml } from "../../server/http/html.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import type { DemoBuildAccumulator } from "../metrics-recorder.ts";
import { connectingNarration, startLinkStep } from "./linking.ts";

let env: ScratchDbEnv;
let calls: number;
let acc: DemoBuildAccumulator;

/** A provider whose link call never answers, the way a stuck one does. */
const silent: Provider = {
  generate: (): GenerateResult<never> => {
    calls += 1;
    return {
      partialStream: (async function* () {})(),
      object: new Promise(() => {}),
      usage: new Promise(() => {}),
    };
  },
};

function start(provider: Provider, graceMs = 60_000) {
  return startLinkStep({
    provider,
    prompt: "track how many copies of each book I own",
    intent: { ...NEW_CAPABILITY_INTENT, related_capabilities: [BOOKS.id] },
    spec: validSpec(),
    incarnationId: NOTES_INCARNATION_ID,
    acc,
    database: env.conns,
    graceMs,
  });
}

/** Runs `check` with `console.error` recorded and silenced. */
async function logging(check: (logged: ReturnType<typeof spyOn>) => Promise<void>) {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    await check(logged);
  } finally {
    logged.mockRestore();
  }
}

describe("a build's link step", () => {
  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-linking-");
    install(env.conns, deskRow(BOOKS));
    calls = 0;
    acc = { usages: [], timings: {} };
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("a step that answers is read, and its cost joins the build's", async () => {
    const cost: TokenUsage = { inputTokens: 700, outputTokens: 30, totalTokens: 730 };
    const answer = { relations: [{ field: "text", capability: BOOKS.id, target_field: "title" }] };
    await logging(async (logged) => {
      const linked = await start(makeSpecProvider(answer, cost)).settled();

      expect(linked.relations).toStrictEqual([
        {
          field: "text",
          to: { capability: BOOKS.id, incarnation: BOOKS_INCARNATION, field: "title" },
        },
      ]);
      expect(acc.usages).toStrictEqual([cost]);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  test("a step still silent when the units are done gets the grace, then the build goes on", async () => {
    await logging(async (logged) => {
      const run = start(silent, 10);
      expect(calls).toBe(1);
      expect((await run.settled()).relations).toStrictEqual([]);
      expect(acc.usages).toStrictEqual([]);
      expect(logged).toHaveBeenCalled();
    });
  });

  test("a build that ends stops a step still running at once, and says nothing of it", async () => {
    await logging(async (logged) => {
      const run = start(silent);
      await run.stop();
      const ended = await Promise.race([run.settled(), Bun.sleep(50).then(() => "running")]);

      expect(ended).not.toBe("running");
      expect(calls).toBe(1);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  test("a build cancelled or out of lease ends the step, and says nothing of it", async () => {
    await logging(async (logged) => {
      const lease = new AbortController();
      const run = start(abortableProvider(silent, lease.signal));
      lease.abort();

      expect((await run.settled()).relations).toStrictEqual([]);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  test("a step that cannot read the desk links nothing, says why, and the build goes on", async () => {
    const unreadable = spyOn(store, "listCapabilities").mockImplementation(() => {
      throw new Error("database is locked");
    });
    try {
      await logging(async (logged) => {
        expect((await start(silent).settled()).relations).toStrictEqual([]);
        expect(calls).toBe(0);
        expect(logged).toHaveBeenCalled();
      });
    } finally {
      unreadable.mockRestore();
    }
  });

  test("the sentence names each connected field once, in the spec's order, as text", () => {
    const spec = validSpec({
      noun: "adaptation",
      schema: {
        fields: [
          textField("film", "Film <title>"),
          textField("notes", "Notes"),
          textField("book", "Book & edition"),
        ],
      },
    });
    const books = deskRow(BOOKS);
    const authors = deskRow(AUTHORS);
    const relations = [
      {
        field: "book",
        to: { capability: BOOKS.id, incarnation: BOOKS_INCARNATION, field: "title" },
      },
      {
        field: "film",
        to: { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, field: "name" },
      },
    ];
    const [film, , book] = spec.schema.fields;

    expect(connectingNarration(spec, { relations, flagged: [books, authors] })).toBe(
      escapeHtml(
        buildConnecting(spec.noun, [
          { field: film ?? { label: "" }, targetPlural: authors.plural_noun },
          { field: book ?? { label: "" }, targetPlural: books.plural_noun },
        ]),
      ),
    );
    expect(connectingNarration(spec, { relations: [], flagged: [books] })).toBe("");
  });
});
