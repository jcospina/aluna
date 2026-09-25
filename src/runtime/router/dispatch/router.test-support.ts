// Shared setup, fixtures, and helpers for the deterministic capability router tests.
// Split out of router.test.ts so the per-concern sibling test files can each import
// exactly what they use. Not a test file itself (no `*.test.ts`), so bun never runs it.

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { photoSpec } from "../../../registry/fields/file.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import type { CapabilityRow, CapabilitySpec } from "../../../registry/index.ts";
import { FULL_CAPABILITY_TOOLS, insertCapability } from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import { applyCapabilityTableDdl } from "../../data/index.ts";
import { createCapabilityDataTool } from "../../data/tool.test-support.ts";
import type { HandlerLoader } from "./router.ts";

export { createCapabilityDataTool, notesSpec };

/**
 * Each case runs against a throwaway file db so the real data file is never touched; setup and
 * teardown keep the per-test temp-dir and database lifecycle the original describe established.
 */
export function setupRouterTest(): ScratchDbEnv {
  return createScratchDbEnv("omni-crud-router-");
}

export function teardownRouterTest(dir: string, conns: PlatformDatabase): void {
  teardownScratchDbEnv({ dir, conns });
}

export const NOTES_ARTIFACTS = "src/runtime/router/__fixtures__/notes/v1/";
export const BOOM_ARTIFACTS = "src/runtime/router/__fixtures__/boom/v1/";
export const PHOTOS_ARTIFACTS = "src/runtime/router/__fixtures__/photos/v1/";
export const NOTES_INCARNATION_ID = FIRST_INCARNATION_ID;

export function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    ...notesSpec(),
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
    artifacts_path: NOTES_ARTIFACTS,
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    ...overrides,
  };
}

/** The fixture with a photo field (`__fixtures__/photos`), whose card draws the photo. */
export function photosRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  const spec = photoSpec();
  return notesRow({
    ...spec,
    ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["photo", "caption"] } },
    artifacts_path: PHOTOS_ARTIFACTS,
    ...overrides,
  });
}

/**
 * A fixture whose handler throws — proves a handler failure stays friendly.
 */
export function boomRow(): CapabilityRow {
  return {
    id: "boom",
    label: "Boom",
    subject: "a firecracker",
    ground: "coral_orange",
    companion: "grass_green",
    noun: "boom",
    plural_noun: "booms",
    incarnation_id: SECOND_INCARNATION_ID,
    version: 1,
    seed: 730051,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    schema: {
      fields: [
        { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["note"] },
      collection: { layout: "feed" },
    },
    behavior: "Always fails, to prove failures stay friendly.",
    behavioral_errors: [],
    tools: [...FULL_CAPABILITY_TOOLS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    artifacts_path: BOOM_ARTIFACTS,
    prompt_context: "A fixture whose handler throws.",
  };
}

/**
 * Install a capability the way a committed build would: its data table exists and
 * its registry row is present, both on the scratch db.
 */
export function install(conns: PlatformDatabase, row: CapabilityRow): void {
  applyCapabilityTableDdl(rowSpec(row), conns.readwrite);
  insertCapability(row, conns.readwrite);
}

export function rowSpec(row: CapabilityRow): CapabilitySpec {
  return {
    id: row.id,
    label: row.label,
    subject: row.subject,
    ground: row.ground,
    companion: row.companion,
    noun: row.noun,
    plural_noun: row.plural_noun,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  };
}

/**
 * A loader that records its calls and never actually loads anything — used to prove
 * validation happens *before* any handler code is reached.
 */
export function makeSpyLoader(): {
  calls: Array<{ artifactsPath: string; action: string }>;
  loadHandler: HandlerLoader;
} {
  const calls: Array<{ artifactsPath: string; action: string }> = [];
  const loadHandler: HandlerLoader = async (artifactsPath, action) => {
    calls.push({ artifactsPath, action });
    return async () => "<p>spy: should never run</p>";
  };
  return { calls, loadHandler };
}

export function formBody(
  fields: Record<string, string>,
  presentFields: readonly string[] = ["text", "pinned"],
): RequestInit {
  const body = new URLSearchParams(fields);
  for (const field of presentFields) body.append("__aluna_present", field);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

export async function collectCapabilityLogoText(html: string): Promise<string[]> {
  const entries: string[] = [];
  let currentEntry: string | undefined;
  const rewriter = new HTMLRewriter().on("[data-capability-logo]", {
    element(element) {
      currentEntry = "";
      element.onEndTag(() => {
        entries.push(normalizeSpace(currentEntry ?? ""));
        currentEntry = undefined;
      });
    },
    text(text) {
      if (currentEntry !== undefined) {
        currentEntry += text.text;
      }
    },
  });

  await new Response(rewriter.transform(new Response(html)).body).text();
  return entries;
}

export function normalizeSpace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}
