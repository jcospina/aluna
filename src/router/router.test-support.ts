// Shared setup, fixtures, and helpers for the deterministic capability router tests.
// Split out of router.test.ts so the per-concern sibling test files can each import
// exactly what they use. Not a test file itself (no `*.test.ts`), so bun never runs it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCapabilityTableDdl,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import type { CapabilityRow, CapabilitySpec } from "../registry/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import type { HandlerLoader } from "./router.ts";

// Each case runs against a throwaway file db so the real data file is never touched.
// setup/teardown preserve the exact temp-dir + database lifecycle the original
// describe's beforeEach/afterEach established, per test.
export function setupRouterTest(): { dir: string; conns: PlatformDatabase } {
  const dir = mkdtempSync(join(tmpdir(), "omni-crud-router-"));
  const conns = openDatabase(join(dir, "test.db"));
  runMigrations(conns.readwrite);
  return { dir, conns };
}

export function teardownRouterTest(dir: string, conns: PlatformDatabase): void {
  conns.readwrite.close();
  conns.readonly.close();
  rmSync(dir, { recursive: true, force: true });
}

export function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const mutation = createCapabilityMutationPort(spec, databases.readwrite);
  const query = createCapabilityQueryPort(databases.readonly, { target: spec });
  return {
    insert: (values: Record<string, unknown>) =>
      materializeCapabilityActionRecord(mutation.create(values)),
    select: () => selectCapabilityRows(spec, query),
  };
}

export const NOTES_ARTIFACTS = "src/router/__fixtures__/notes/v1/";
export const BOOM_ARTIFACTS = "src/router/__fixtures__/boom/v1/";
export const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

// The notes fixture's spec — matches the hand-written handler files.
export function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

export function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    ...notesSpec(),
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
    artifacts_path: NOTES_ARTIFACTS,
    ...overrides,
  };
}

// A fixture whose handler throws — proves a handler failure stays friendly.
export function boomRow(): CapabilityRow {
  return {
    id: "boom",
    label: "Boom",
    incarnation_id: "22222222-2222-4222-8222-222222222222",
    version: 1,
    schema: {
      fields: [
        { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["note"] },
      collection: { layout: "feed" },
      detail: { shows: ["note"] },
    },
    behavior: "Always fails, to prove failures stay friendly.",
    behavioral_errors: [],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    artifacts_path: BOOM_ARTIFACTS,
    prompt_context: "A fixture whose handler throws.",
  };
}

// Install a capability the way a committed build would: its data table exists and
// its registry row is present, both on the scratch db.
export function install(conns: PlatformDatabase, row: CapabilityRow): void {
  applyCapabilityTableDdl(rowSpec(row), conns.readwrite);
  insertCapability(row, conns.readwrite);
}

export function rowSpec(row: CapabilityRow): CapabilitySpec {
  return {
    id: row.id,
    label: row.label,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  };
}

// A loader that records its calls and never actually loads anything — used to prove
// validation happens *before* any handler code is reached.
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

export async function inspectCapabilitySurfacePlacement(html: string): Promise<{
  insideColdStart: boolean;
  insideActiveContent: boolean;
}> {
  let surfaceAncestors: string[][] | undefined;
  const stack: string[][] = [];
  const rewriter = new HTMLRewriter().on("*", {
    element(element) {
      const classList = classNames(element.getAttribute("class"));
      stack.push(classList);

      if (classList.includes("capability-surface")) {
        surfaceAncestors = stack.map((classes) => [...classes]);
      }

      if (element.canHaveContent) {
        element.onEndTag(() => {
          stack.pop();
        });
      } else {
        stack.pop();
      }
    },
  });

  await new Response(rewriter.transform(new Response(html)).body).text();

  if (!surfaceAncestors) {
    throw new Error("missing .capability-surface in direct capability shell");
  }

  return {
    insideColdStart: surfaceAncestors.some((classes) => classes.includes("cold-start")),
    insideActiveContent: surfaceAncestors.some((classes) => classes.includes("content__active")),
  };
}

export async function collectToolbarEntryText(html: string): Promise<string[]> {
  const entries: string[] = [];
  let currentEntry: string | undefined;
  const rewriter = new HTMLRewriter().on("[data-capability-entry]", {
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

export function classNames(value: string | null): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

export function normalizeSpace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}
