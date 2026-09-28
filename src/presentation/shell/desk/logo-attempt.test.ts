import { describe, expect, test } from "bun:test";

import { disarmLogoAttempt, startLogoAttemptDisarm } from "#shell/logo-attempt.js";
import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  DESK_LOGO_LAYER_ELEMENT_ID,
  renderCapabilityLogo,
} from "../../../server/http/fragments.ts";
import { byId, elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { El, parseHtml } from "../../controls/choice-picker.test-support.ts";
import { readSource } from "../../safety/source.test-support.ts";

// Only a fresh desk render or a newly activated tile may arm one attempt (ADR-0007). This holds
// the arming source the server cannot reach: htmx replaying a snapshot taken mid-attempt.

/** Just enough of an element: read an attribute, remove one, receive an event. */
class Node {
  constructor(readonly attributes: Record<string, string> = {}) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }
}

class Root {
  private readonly listeners = new Map<string, ((event: { target?: unknown }) => void)[]>();

  addEventListener(type: string, listener: (event: { target?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, target: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ target });
  }
}

/** The tile a fresh desk render arms, exactly as the server renders it. */
function armedTile(): El {
  const slot = parseHtml(
    renderCapabilityLogo({
      id: "notes",
      label: "Notes",
      incarnation_id: FIRST_INCARNATION_ID,
      version: 1,
      logo: { status: "absent", attempts: 0 },
      display_label_override: null,
    }),
    new El("div"),
  );
  const [tile, ...more] = slot.querySelectorAll("[hx-post][hx-trigger]");
  if (tile === undefined || more.length > 0) throw new Error("expected one armed tile");
  return tile;
}

describe("a tile disarms itself when its attempt starts", () => {
  test("both arming attributes come off", () => {
    const tile = armedTile();
    const target = tile.getAttribute("hx-target");

    expect(disarmLogoAttempt(tile)).toBe(true);

    expect(tile.getAttribute("hx-trigger")).toBeNull();
    expect(tile.getAttribute("hx-post")).toBeNull();
    // The swap it is already performing is untouched.
    expect(target).not.toBeNull();
    expect(tile.getAttribute("hx-target")).toBe(target);
  });

  test("it is idempotent, and a second pass finds nothing to do", () => {
    const tile = armedTile();
    disarmLogoAttempt(tile);

    expect(disarmLogoAttempt(tile)).toBe(false);
  });

  test("every other request on the desk passes through untouched", () => {
    const logoClick = new Node({ "hx-get": "/capability/notes", "hx-trigger": "click" });
    const prompt = new Node({ "hx-post": "/prompt" });
    const records = new Node({ "hx-get": "/capability/notes/read", "hx-trigger": "load" });

    expect(disarmLogoAttempt(logoClick)).toBe(false);
    expect(disarmLogoAttempt(prompt)).toBe(false);
    expect(disarmLogoAttempt(records)).toBe(false);
    expect(records.getAttribute("hx-trigger")).toBe("load");
    expect(logoClick.getAttribute("hx-get")).toBe("/capability/notes");
  });

  test("anything that is not an element is ignored", () => {
    for (const value of [null, undefined, "a string", 7, {}]) {
      expect(disarmLogoAttempt(value)).toBe(false);
    }
  });

  test("the request beginning is what disarms it", () => {
    const root = new Root();
    const tile = armedTile();
    startLogoAttemptDisarm(root);

    root.dispatch("htmx:beforeRequest", tile);

    // htmx snapshots the *live* DOM into its history cache, so a tile that has fired can
    // never be restored armed — which is what stops Back from spending a second attempt.
    expect(tile.getAttribute("hx-trigger")).toBeNull();
  });
});

describe("the shell it runs in", () => {
  test("the shell loads it", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/logo-attempt.js",
    );
  });

  // The element the attempts queue against has to actually be in the shell, or `hx-sync`
  // names nothing and every tile fires at once again.
  test("the layer an attempt queues against is the one the shell ships", async () => {
    const shell = await elementsOf(readSource("public/index.html"));
    expect(byId(shell, DESK_LOGO_LAYER_ELEMENT_ID).tag).toBe("div");
  });
});
