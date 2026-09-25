// The write window a writing Handler is handed: its mutation port writes from the call until its
// answer settles, and refuses every write after, through the router and the notes fixture.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { createApp } from "../../../server/app.ts";
import { CapabilityDataValidationError } from "../../data/index.ts";
import type { CapabilityCreateContext } from "../contract.ts";
import {
  formBody,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

let dir: string;
let databases: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns: databases } = setupRouterTest());
  install(databases, notesRow());
});

afterEach(() => teardownRouterTest(dir, databases));

async function create(loadHandler: HandlerLoader): Promise<Response> {
  return createApp({ capabilityRouter: { databases, loadHandler } }).request(
    "/capability/notes/create",
    formBody({ text: "Answered" }),
  );
}

const stored = () => databases.readwrite.query(`SELECT "text" FROM "cap_notes"`).all();

describe("a write queued behind the Handler's answer is refused", () => {
  type Late = (write: () => void) => Promise<string>;
  const handlers: readonly [string, Late][] = [
    [
      "a Handler that never awaited",
      async (write) => {
        queueMicrotask(write);
        return "<p>answered first</p>";
      },
    ],
    [
      "a write queued in the turn an awaiting Handler answers in",
      async (write) => {
        await null;
        queueMicrotask(write);
        return "<p>answered first</p>";
      },
    ],
    [
      "work a Handler left running when it answered",
      async (write) => {
        await null;
        void (async () => {
          for (let turn = 0; turn < 3; turn += 1) await null;
          write();
        })();
        return "<p>answered first</p>";
      },
    ],
  ];

  for (const [name, late] of handlers) {
    test(name, async () => {
      const refused: unknown[] = [];
      const response = await create(
        async () => (context: CapabilityCreateContext) =>
          late(() => {
            try {
              context.mutation.create({ text: "Late" });
            } catch (error) {
              refused.push(error);
            }
          }),
      );
      await Bun.sleep(0);

      expect(response.status).toBe(200);
      expect(refused).toEqual([expect.any(CapabilityDataValidationError)]);
      expect(stored()).toEqual([]);
    });
  }
});

test("a Handler that answers with a promise holds the window open until it is adopted", async () => {
  const outcomes: string[] = [];
  const refused: unknown[] = [];
  const response = await create(async () => async (context: CapabilityCreateContext) => {
    const write = (text: string) => () => {
      try {
        context.mutation.create({ text });
        outcomes.push(`${text} written`);
      } catch (error) {
        refused.push(error);
        outcomes.push(`${text} refused`);
      }
    };
    queueMicrotask(write("during"));
    void (async () => {
      for (let turn = 0; turn < 5; turn += 1) await null;
      write("after")();
    })();
    return Promise.resolve("<p>answered with a promise</p>");
  });
  await Bun.sleep(0);

  expect(response.status).toBe(200);
  expect(outcomes).toEqual(["during written", "after refused"]);
  expect(refused).toEqual([expect.any(CapabilityDataValidationError)]);
  expect(stored()).toEqual([{ text: "during" }]);
});
