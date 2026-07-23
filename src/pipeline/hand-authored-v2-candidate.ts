// TEMPORARY — Module 4.6/05 removes this hand-authored regenerate-all tracer input.
//
// It deliberately has no Diff or selective-copy policy: it starts from one verified
// committed snapshot and supplies the complete six-unit inventory to the temporary
// v2 tracer. 4.6 replaces this with candidate generation and Diff ownership.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type GeneratedUnit,
  runCapabilityGate,
  verifyCapabilitySnapshot,
} from "../builder/index.ts";
import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import type { CapabilityRow } from "../registry/index.ts";
import type { HandAuthoredV2Candidate } from "./hand-authored-v2-tracer.ts";

const UNIT_FILES = [
  "item.ts",
  "create.ts",
  "read.ts",
  "update.ts",
  "delete.ts",
  "search.ts",
] as const;

/** Build the temporary complete v2 candidate from verified committed v1 source. */
export async function handAuthoredV2Candidate(
  active: CapabilityRow,
): Promise<HandAuthoredV2Candidate> {
  const verified = verifyCapabilitySnapshot(active.artifacts_path);
  if (
    verified.manifest.capability_id !== active.id ||
    verified.manifest.incarnation_id !== active.incarnation_id ||
    verified.manifest.version !== active.version
  ) {
    throw new Error("The selected capability pointer no longer matches its verified snapshot.");
  }

  const units = UNIT_FILES.map((filename) => unitFromSnapshot(verified.directory, filename));
  const itemRenderer = units.find((unit) => unit.filename === "item.ts")?.content;
  if (!itemRenderer) throw new Error("Hand-authored v2 candidate is missing item.ts.");
  const handlers = Object.fromEntries(
    units
      .filter(
        (unit): unit is Extract<GeneratedUnit, { kind: "handler" }> => unit.kind === "handler",
      )
      .map((unit) => [unit.name, unit.content]),
  );
  const gate = await runCapabilityGate({
    spec: verified.spec,
    ddl: deriveCapabilityTableDdl(verified.spec),
    handlers,
    itemRenderer,
    behavioralTier: { enabled: false },
  });
  return { spec: verified.spec, units, gate };
}

function unitFromSnapshot(directory: string, filename: (typeof UNIT_FILES)[number]): GeneratedUnit {
  const source = readFileSync(join(directory, filename), "utf8");
  const content = filename === "read.ts" ? addV2TracerMarker(source) : source;
  if (filename === "item.ts") {
    return {
      kind: "item-renderer",
      name: "item",
      filename,
      content,
      attempts: [
        { attempt: 1, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ],
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
  return {
    kind: "handler",
    name: filename.slice(0, -3) as "create" | "read" | "update" | "delete" | "search",
    filename,
    content,
    attempts: [
      { attempt: 1, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    ],
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

function addV2TracerMarker(source: string): string {
  const marker = '"<span data-v2-tracer=\\"true\\"></span>"';
  const marked = source.replace(
    /return ([^;]+);/u,
    `const v2TracerOutput = $1;\n  return v2TracerOutput === "" ? v2TracerOutput : ${marker} + v2TracerOutput;`,
  );
  if (marked === source) throw new Error("Hand-authored v2 tracer could not mark read.ts.");
  return marked;
}
