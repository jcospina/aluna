import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createScratchDbEnv,
  notesCapabilityRow,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../app.test-support.ts";
import { insertCapability } from "../registry/index.ts";
import { captureRestorationDescriptor, renderRestorationFragment } from "./restoration.ts";

describe("complete-View restoration descriptor", () => {
  let env: ScratchDbEnv;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-restoration-");
    insertCapability(notesCapabilityRow(), env.conns.readwrite);
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("captures only a matching active id/incarnation and carries no records or path", () => {
    const descriptor = captureRestorationDescriptor(
      {
        capabilityId: "notes",
        incarnationId: "11111111-1111-4111-8111-111111111111",
      },
      env.conns.readonly,
    );

    expect(descriptor).toEqual({
      kind: "capability",
      capabilityId: "notes",
      incarnationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(JSON.stringify(descriptor)).not.toContain("artifacts");
    expect(
      captureRestorationDescriptor(
        {
          capabilityId: "notes",
          incarnationId: "22222222-2222-4222-8222-222222222222",
        },
        env.conns.readonly,
      ),
    ).toEqual({ kind: "neutral" });
  });

  test("resolves the then-current row and restores fresh search/read chrome", () => {
    const descriptor = captureRestorationDescriptor(
      {
        capabilityId: "notes",
        incarnationId: "11111111-1111-4111-8111-111111111111",
      },
      env.conns.readonly,
    );
    env.conns.readwrite.run(
      "UPDATE capability_registry SET label = ?, version = ?, artifacts_path = ? WHERE id = ?",
      ["Journal", 2, "capabilities/notes/11111111-1111-4111-8111-111111111111/v2/", "notes"],
    );

    const fragment = renderRestorationFragment(descriptor, env.conns.readonly);
    expect(fragment).toContain('data-build-restoration="capability"');
    expect(fragment).toContain('aria-label="Journal"');
    expect(fragment).toContain('data-search-state="idle"');
    expect(fragment).toContain('hx-get="/capability/notes/read" hx-trigger="load"');
    expect(fragment).not.toContain("v1/");
  });

  test("can carry a product explanation into the restored complete View", () => {
    const descriptor = captureRestorationDescriptor(
      {
        capabilityId: "notes",
        incarnationId: "11111111-1111-4111-8111-111111111111",
      },
      env.conns.readonly,
    );
    const fragment = renderRestorationFragment(
      descriptor,
      env.conns.readonly,
      "You already have Notes, so I didn't create another one.",
    );

    expect(fragment).toContain('id="prompt-notice" hx-swap-oob="innerHTML"');
    expect(fragment).toContain("You already have Notes");
    expect(fragment).toContain('data-active-capability-id="notes"');
  });

  test("marks a deterministic no-op so the browser can preserve the active View", () => {
    const descriptor = captureRestorationDescriptor(
      {
        capabilityId: "notes",
        incarnationId: "11111111-1111-4111-8111-111111111111",
      },
      env.conns.readonly,
    );
    const fragment = renderRestorationFragment(
      descriptor,
      env.conns.readonly,
      "You already have Notes, so I didn't create another one.",
      "preserve",
    );

    expect(fragment).toContain('data-build-restoration-behavior="preserve"');
    expect(fragment).toContain('data-active-capability-id="notes"');
  });

  test("returns the neutral surface when the captured incarnation no longer resolves", () => {
    const descriptor = captureRestorationDescriptor(
      {
        capabilityId: "notes",
        incarnationId: "11111111-1111-4111-8111-111111111111",
      },
      env.conns.readonly,
    );
    env.conns.readwrite.run("DELETE FROM capability_registry WHERE id = ?", ["notes"]);

    expect(renderRestorationFragment(descriptor, env.conns.readonly)).toBe(
      '<div data-build-restoration="neutral"></div>',
    );
  });
});
