// The developer panel's live units view — the `units-preview` SSE stream.
//
// One unit inventory assembles in the panel's Units block as generation runs: each unit
// appears when it starts, its content grows as partials arrive, a failed check flips it to
// "fixing", and it lands complete. Extracted from the v1 build path so evolution's partial
// regeneration (4.6/03) drives the *same* surface: a v1 build and an evolution differ only
// in which units are generated and which arrive already-complete, never in how a developer
// watches them.
//
// Partial-driven updates are throttled (a token-rate stream would otherwise flood the
// wire); lifecycle transitions — start, attempt, landed, copied — always force a send.

import type {
  GeneratedUnit,
  UnitDescriptor,
  UnitGenerationAttempt,
  UnitGenerationObserver,
} from "../builder/index.ts";
import type { Send } from "../sse/index.ts";
import {
  buildUnitsPreview,
  type DemoUnitPreview,
  type DemoUnitsPreview,
  finalUnitPreview,
  unitPreviewFilename,
  unitPreviewKey,
} from "./previews.ts";

/** The shortest gap between two partial-driven `units-preview` sends. */
export const UNIT_PREVIEW_THROTTLE_MS = 500;

export interface UnitPreviewStream {
  /** Wire this into unit generation; it streams the live view as each unit assembles. */
  readonly observer: UnitGenerationObserver;
  /**
   * Place an already-complete unit in the live view without any generation having run —
   * evolution's byte-copied units, which never enter a generation prompt (decision 21).
   */
  record(unit: GeneratedUnit): void;
  /** Send the current snapshot. Throttled unless `force`; silent once aborted. */
  flush(status: DemoUnitsPreview["status"], force?: boolean): Promise<void>;
}

/**
 * Open a live units view over `send`. The returned observer owns the whole generation
 * lifecycle; `record` and `flush` let a caller seed units it assembled by other means
 * (a copy) and mark the inventory complete.
 */
export function createUnitPreviewStream(
  send: Send,
  isAborted: () => boolean = () => false,
): UnitPreviewStream {
  const liveUnits = new Map<string, DemoUnitPreview>();
  let lastPreviewAt = 0;

  const flush = async (status: DemoUnitsPreview["status"], force = false): Promise<void> => {
    if (isAborted()) return;
    const now = performance.now();
    if (!force && now - lastPreviewAt < UNIT_PREVIEW_THROTTLE_MS) return;
    lastPreviewAt = now;
    await send("units-preview", JSON.stringify(buildUnitsPreview([...liveUnits.values()], status)));
  };

  const updateLiveUnit = (
    unit: UnitDescriptor,
    patch: Partial<Omit<DemoUnitPreview, "kind" | "name" | "filename">>,
  ) => {
    const key = unitPreviewKey(unit);
    const current = liveUnits.get(key);
    liveUnits.set(key, {
      kind: unit.kind,
      name: unit.name,
      filename: unitPreviewFilename(unit),
      status: current?.status ?? "generating",
      attempts: current?.attempts ?? 0,
      content: current?.content ?? "",
      ...patch,
    });
  };

  const recordAttempt = (unit: UnitDescriptor, attempt: UnitGenerationAttempt) => {
    updateLiveUnit(unit, {
      status: attempt.error ? "fixing" : "generating",
      attempts: attempt.attempt,
      durationMs: attempt.durationMs,
      usage: attempt.usage,
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  };

  const observer: UnitGenerationObserver = {
    async onUnitStart({ unit, attempt }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt });
      await flush("running", true);
    },
    async onUnitPartial({ unit, attempt, content }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt, content });
      await flush("running");
    },
    async onUnitAttempt({ unit, attempt }) {
      recordAttempt(unit, attempt);
      await flush("running", true);
    },
    async onUnitGenerated(unit) {
      liveUnits.set(unitPreviewKey(unit), finalUnitPreview(unit));
      await flush("running", true);
    },
  };

  return {
    observer,
    record(unit) {
      liveUnits.set(unitPreviewKey(unit), finalUnitPreview(unit));
    },
    flush,
  };
}
