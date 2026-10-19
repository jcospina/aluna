// A request the Intent Resolver flags as about Books reaches the spec writer with what Books
// holds: its name, description, record noun and single-line text fields
// with their limits, and nothing else. Scripted end to end through POST /prompt with a fake provider.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readRelatedCapabilities, relatedCapabilityPromptLines } from "../../../builder/index.ts";
import { relatedCapabilityView } from "../../../builder/spec/related-capabilities.ts";
import type { IntentClassification } from "../../../pipeline/intent/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { getCapability, insertCapabilityDeletionTombstone } from "../../../registry/index.ts";
import { install } from "../../../runtime/router/dispatch/router.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { AUTHORS, BOOKS, deskRow, textField } from "../lifecycle/link.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

/** The one multi-line JSON array a spec prompt carries: the flagged capabilities. */
function flaggedPayload(prompt: string): unknown {
  const lines = prompt.split("\n");
  const start = lines.indexOf("[");
  const end = lines.indexOf("]", start);
  return start === -1 ? undefined : JSON.parse(lines.slice(start, end + 1).join("\n"));
}

/** Build through the prompt bar on the scratch desk, answering the Resolver with `intent`. */
async function buildWith(intent: IntentClassification, request: string) {
  const { provider, prompts } = makePromptBuildProvider(intent);
  const app = makeScratchApp(
    { dir, conns, artifactsRoot },
    provider,
    makeMetricsRecorder().recordMetrics,
  );
  const fragment = await responseText(await postPrompt(app, request));
  const stream = await app.request(`/build/${buildJobIdFromSubscriber(fragment)}/stream`);
  return { done: eventData(collectSseEvents(await readSse(stream)), "done"), prompts };
}

describe("the spec writer sees what the Resolver flagged", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-flagged-"));
    install(conns, deskRow(BOOKS));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a new capability flagging Books and Authors gets their text fields and limits, and nothing else", async () => {
    install(conns, deskRow(AUTHORS));
    const booksBefore = getCapability(BOOKS.id, conns.readonly);
    const authors = getCapability(AUTHORS.id, conns.readonly);
    const { done, prompts } = await buildWith(
      { ...NEW_CAPABILITY_INTENT, related_capabilities: [BOOKS.id, "ghosts", AUTHORS.id] },
      "track how many copies of each book I own",
    );

    expect(done).toBe("ok");
    // Long text, numbers, dates and hidden fields stay out, and the desk's order is kept.
    expect(flaggedPayload(prompts[1] ?? "")).toEqual([
      {
        name: AUTHORS.label,
        description: authors?.prompt_context,
        record_noun: AUTHORS.noun,
        single_line_text_fields: [
          { name: "name", label: "Name", max_length: 120 },
          { name: "pen_name", label: "Pen name", max_length: 80 },
        ],
      },
      {
        name: BOOKS.label,
        description: booksBefore?.prompt_context,
        record_noun: BOOKS.noun,
        single_line_text_fields: [
          { name: "title", label: "Title", max_length: 300 },
          { name: "author", label: "Author", max_length: 120 },
        ],
      },
    ]);

    // A flag is no read dependency: the built capability declares none, and Books is untouched.
    const built = getCapability("notes", conns.readonly);
    expect(Object.values(built?.read_dependencies ?? {}).flat()).toEqual([]);
    expect(getCapability(BOOKS.id, conns.readonly)).toEqual(booksBefore);
  });

  test("a capability is seen by the name it was renamed to, and only through fields a link holds", () => {
    const row = deskRow({
      ...BOOKS,
      fields: [
        textField("title", "Title"),
        textField("tags", "Tags", { type: "string[]" }),
        textField("status", "Status", {
          type: "choice",
          values: [{ value: "owned", label: "Owned" }],
        }),
        textField("cover", "Cover", { type: "file", accepts: ["image"] }),
      ],
    });
    const view = relatedCapabilityView({ ...row, display_label_override: "My library" });

    expect(view.name).toBe("My library");
    expect(view.single_line_text_fields).toEqual([
      { name: "title", label: "Title", max_length: null },
    ]);
  });

  test("a flag naming a capability no longer on the desk reads as nothing", () => {
    install(conns, deskRow(AUTHORS));
    insertCapabilityDeletionTombstone(
      { capabilityId: AUTHORS.id, incarnationId: AUTHORS.incarnation, manifest: [] },
      conns.readwrite,
    );
    const read = readRelatedCapabilities([BOOKS.id, AUTHORS.id, "ghosts"], conns.readonly);
    expect(read.map(({ name }) => name)).toStrictEqual([BOOKS.label]);
  });

  test("with nothing flagged the spec writer reads no capability", async () => {
    const { done, prompts } = await buildWith(NEW_CAPABILITY_INTENT, "track my notes");
    const flaggedHeading = relatedCapabilityPromptLines([relatedCapabilityView(deskRow(BOOKS))])[0];

    expect(done).toBe("ok");
    expect(flaggedPayload(prompts[1] ?? "")).toBeUndefined();
    expect(prompts[1]).not.toContain(flaggedHeading ?? "");
  });
});
