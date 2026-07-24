// The shared live units view — Module 4.6/03. The v1 build and an evolution both drive
// this stream, so the rules it enforces (lifecycle transitions always send, partials are
// throttled, a byte-copied unit lands complete without any generation) are pinned once
// here rather than re-proved through each pipeline.
//
// Pure by construction: no provider, no database, no Gate — this suite runs anywhere.

import { describe, expect, test } from "bun:test";

import type { GeneratedUnit } from "../builder/index.ts";
import type { DemoUnitsPreview } from "./previews.ts";
import { createUnitPreviewStream, UNIT_PREVIEW_THROTTLE_MS } from "./unit-preview-stream.ts";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;

const CREATE_UNIT = { kind: "handler", name: "create" } as const;

function copiedItem(content: string): GeneratedUnit {
  return {
    kind: "item-renderer",
    name: "item",
    filename: "item.ts",
    content,
    attempts: [{ attempt: 1, durationMs: 0, usage: ZERO_USAGE }],
    durationMs: 0,
    usage: ZERO_USAGE,
  };
}

function recorder() {
  const sent: DemoUnitsPreview[] = [];
  const send = async (event: string, data: string) => {
    if (event === "units-preview") sent.push(JSON.parse(data));
  };
  return { sent, send };
}

describe("the live units preview stream", () => {
  test("sends every lifecycle transition and throttles partials", async () => {
    const { sent, send } = recorder();
    const { observer } = createUnitPreviewStream(send);

    await observer.onUnitStart?.({ unit: CREATE_UNIT, attempt: 1 });
    // Back-to-back partials collapse into the one already-sent start snapshot.
    await observer.onUnitPartial?.({ unit: CREATE_UNIT, attempt: 1, content: "exp" });
    await observer.onUnitPartial?.({ unit: CREATE_UNIT, attempt: 1, content: "export" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.units[0]).toMatchObject({ name: "create", status: "generating", attempts: 1 });

    // A failed check is a transition, so it is never throttled away.
    await observer.onUnitAttempt?.({
      unit: CREATE_UNIT,
      attempt: { attempt: 1, durationMs: 5, usage: ZERO_USAGE, error: "missing export" },
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.units[0]).toMatchObject({ status: "fixing", error: "missing export" });
    // The throttled partials still reached the snapshot they were folded into.
    expect(sent[1]?.units[0]?.content).toBe("export");
  });

  test("a partial sends again once the throttle window has passed", async () => {
    const { sent, send } = recorder();
    const { observer } = createUnitPreviewStream(send);

    await observer.onUnitStart?.({ unit: CREATE_UNIT, attempt: 1 });
    await Bun.sleep(UNIT_PREVIEW_THROTTLE_MS + 20);
    await observer.onUnitPartial?.({ unit: CREATE_UNIT, attempt: 1, content: "export default" });

    expect(sent).toHaveLength(2);
    expect(sent[1]?.units[0]?.content).toBe("export default");
  });

  test("a recorded copy joins the inventory complete, with no generation of its own", async () => {
    const { sent, send } = recorder();
    const stream = createUnitPreviewStream(send);

    stream.record(copiedItem("export default function item() {}"));
    // `record` alone is silent — the caller decides when the inventory is worth sending.
    expect(sent).toHaveLength(0);

    await stream.flush("running", true);
    await landRegeneratedCreate(stream);
    await stream.flush("complete", true);

    const complete = sent.at(-1);
    expect(complete?.status).toBe("complete");
    expect(complete?.units).toHaveLength(2);
    expect(complete?.units[0]).toMatchObject({
      name: "item",
      status: "complete",
      attempts: 1,
      durationMs: 0,
      content: "export default function item() {}",
    });
    expect(complete?.units[1]).toMatchObject({ name: "create", status: "complete" });
  });

  test("an aborted stream goes quiet", async () => {
    const { sent, send } = recorder();
    const { observer } = createUnitPreviewStream(send, () => true);

    await observer.onUnitStart?.({ unit: CREATE_UNIT, attempt: 1 });
    expect(sent).toHaveLength(0);
  });
});

// A regenerated unit landing alongside the copy above — the mixed inventory an evolution
// assembles (copied + regenerated) in one view.
async function landRegeneratedCreate(
  stream: ReturnType<typeof createUnitPreviewStream>,
): Promise<void> {
  await stream.observer.onUnitGenerated?.({
    kind: "handler",
    name: "create",
    filename: "create.ts",
    content: "export default async function create() {}",
    attempts: [{ attempt: 1, durationMs: 12, usage: ZERO_USAGE }],
    durationMs: 12,
    usage: ZERO_USAGE,
  });
}
