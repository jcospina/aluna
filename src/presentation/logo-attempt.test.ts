import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { disarmLogoAttempt, startLogoAttemptDisarm } from "#shell/logo-attempt.js";
import { renderCapabilityLogo } from "../web/fragments.ts";

// The rule under test is "only a fresh desk render or a newly activated tile may arm one
// attempt" (ADR-0007). The server holds most of it; this holds the one arming source the
// server cannot reach — htmx's history cache replaying a snapshot taken mid-attempt.
//
// What these cases establish, and what they do not: they pin *this module's* rule — which
// elements it disarms, which it leaves alone, and that the request beginning is the
// moment it acts. They do not exercise htmx. That the vendored bundle dispatches
// `htmx:beforeRequest` on the issuing element with `bubbles: true`, that its history
// snapshot is the live DOM taken at swap time, and that a restore re-processes the
// snapshot and re-fires `hx-trigger="load"`, were each read out of
// `public/vendor/htmx.min.js` when this was written. A DOM-free test cannot check that;
// the live desk is where it is confirmed.

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

function armedTile(): Node {
  return new Node({
    class: "logo-tile logo-tile--pending",
    "hx-post": "/capability/notes/11111111-1111-4111-8111-111111111111/logo-attempt",
    "hx-trigger": "load",
    "hx-target": "#capability-logo-notes",
    "hx-swap": "outerHTML",
  });
}

describe("a tile disarms itself when its attempt starts", () => {
  test("both arming attributes come off", () => {
    const tile = armedTile();

    expect(disarmLogoAttempt(tile)).toBe(true);

    expect(tile.getAttribute("hx-trigger")).toBeNull();
    expect(tile.getAttribute("hx-post")).toBeNull();
    // The swap it is already performing is untouched.
    expect(tile.getAttribute("hx-target")).toBe("#capability-logo-notes");
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

describe("the module and the markup agree", () => {
  test("the attributes it strips are the ones the server renders", () => {
    const rendered = renderCapabilityLogo({
      id: "notes",
      label: "Notes",
      incarnation_id: "11111111-1111-4111-8111-111111111111",
      logo: { status: "absent", attempts: 0 },
    });

    expect(rendered).toContain(
      'hx-post="/capability/notes/11111111-1111-4111-8111-111111111111/logo-attempt"',
    );
    expect(rendered).toContain('hx-trigger="load"');
  });

  test("the shell loads it", () => {
    const shell = readFileSync(resolve(import.meta.dir, "../../public/index.html"), "utf8");

    expect(shell).toContain('src="/static/logo-attempt.js"');
  });
});
