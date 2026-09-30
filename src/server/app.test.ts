// Tests for the platform's one route file — the cold-start shell and the
// deterministic, provider-free demo surfaces (detail interaction, few-shot
// gallery). The provider-driven build/stream slices live in the sibling
// app.*.test.ts files; shared setup, fixtures, and fake providers live in
// app.test-support.ts. app.request drives app.fetch without binding a port.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROMPT_FIELD_ID,
  PROMPT_NOTICE_ID,
  PROMPT_TRIGGER_ID,
  WINDOW_CONTENT_ID,
} from "#shell/core/shell-dom.js";
import { DEV_SEED_SELECTOR, DEV_TILE_SELECTOR } from "#shell/desk/window/desk-dev-panel.js";
import { PROMPT_FORM_ID, WINDOW_LAYER_SELECTOR } from "#shell/desk/window/desk-window.js";
import { code } from "../presentation/safety/source.test-support.ts";
import { responseText } from "./app.test-support.ts";
import {
  byId,
  elementsOf,
  moduleSources,
  type ServedElement,
  scriptSources,
} from "./http/served-page.test-support.ts";
import { createTestApp } from "./isolated-app.test-support.ts";

describe("platform security headers", () => {
  test("every app response carries the policy, on a page and on a fragment", async () => {
    const app = createTestApp();

    for (const path of ["/", "/capability/does-not-exist", "/nope"]) {
      const res = await app.request(path);
      const csp = res.headers.get("content-security-policy") ?? "";

      // The one that matters: an injected inline `<script>` is refused, because
      // `'unsafe-inline'` is never granted to scripts.
      expect(csp, path).toContain("script-src 'self' 'unsafe-eval'");
      expect(csp, path).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("base-uri 'none'");
      expect(csp, path).toContain("object-src 'none'");
      // The browser-side half of the record exfiltration ban: a remote pixel cannot load.
      expect(csp, path).toContain("img-src 'self' data:");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("referrer-policy"), path).toBe("no-referrer");
    }
  });
});

describe("developer surfaces", () => {
  // The lifecycle payload is not a page anyone opens: it is embedded in `GET /` and every direct
  // capability address, and carries model ids, timings and absolute paths. Escaped, so disclosure.
  test("a production bundle carries the shell without the lifecycle payload", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = createTestApp();
      const html = await responseText(await app.request("/"));
      const elements = await elementsOf(html);

      // The slot the shell ships is still there and still empty: nothing is seeded into it.
      const seeds = elements.filter(carrying(DEV_SEED_SELECTOR));
      expect(seeds.map(({ attributes, text }) => [attributes.has("hidden"), text])).toEqual([
        [true, ""],
      ]);
      expect(html).not.toContain("lifecycles");
      expect(html).not.toContain("committedVersions");
      expect(elements.filter(carrying(DEV_TILE_SELECTOR))).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});

/** Whether an element answers an attribute selector a shell module exports, `[name]` alone. */
function carrying(selector: string) {
  const name = /^\[([\w-]+)\]$/.exec(selector)?.[1];
  if (name === undefined) throw new Error(`not a bare attribute selector: ${selector}`);
  return (element: ServedElement) => element.attributes.has(name);
}

/** The shell page, parsed. */
async function shellPage(): Promise<readonly ServedElement[]> {
  return elementsOf(await responseText(await createTestApp().request("/")));
}

describe("GET / (shell)", () => {
  test("the prompt bar posts a build into the window", async () => {
    const app = createTestApp();
    const html = await responseText(await app.request("/"));
    const elements = await elementsOf(html);
    const form = byId(elements, PROMPT_FORM_ID);

    expect(form.tag).toBe("form");
    expect(
      Object.fromEntries(
        ["hx-post", "hx-target", "hx-swap"].map((name) => [name, form.attributes.get(name)]),
      ),
    ).toEqual({
      "hx-post": "/prompt",
      "hx-target": `#${WINDOW_CONTENT_ID}`,
      "hx-swap": "beforeend",
    });
    const field = byId(elements, PROMPT_FIELD_ID);
    expect(field.within).toContain(PROMPT_FORM_ID);
    expect(field.attributes.get("placeholder")).toBeTruthy();
    expect(field.attributes.has("value")).toBe(false);
    expect(byId(elements, PROMPT_NOTICE_ID).within).toContain(PROMPT_FORM_ID);
    // The developer panel's eight readouts left the page with the rail; they are code blocks in
    // the panel's own window now (public/desk/window/desk-dev-panel.js). The page still carries the tile.
    expect(elements.filter(carrying(DEV_TILE_SELECTOR))).toHaveLength(1);
    expect(elements.filter(carrying(DEV_SEED_SELECTOR))).toHaveLength(1);
    expect(moduleSources(elements)).toContain("/static/desk/window/desk-dev-panel.js");
  });

  test("the bar's button says it is working exactly while the shell is busy", async () => {
    const elements = await shellPage();
    const trigger = byId(elements, PROMPT_TRIGGER_ID);
    const label = elements.find(
      (element) => element.attributes.has("x-text") && element.within.includes(PROMPT_TRIGGER_ID),
    );
    const expression = label?.attributes.get("x-text") ?? "";
    const labelWhen = (promptBusy: boolean) =>
      String(Function("promptBusy", `return (${expression});`)(promptBusy));

    expect(trigger.within).toContain(PROMPT_FORM_ID);
    expect(trigger.attributes.get("type")).toBe("submit");
    // What stands before Alpine runs is what Alpine says of an idle bar, so nothing flickers.
    expect(labelWhen(false)).toBe(label?.text ?? "no label stands before Alpine");
    expect(labelWhen(true)).not.toBe(labelWhen(false));
    expect(labelWhen(true)).toBeTruthy();
  });

  test("loads the vendored htmx SSE extension after htmx", async () => {
    const scripts = scriptSources(await shellPage());

    // The extension calls htmx.defineExtension at load, so its script has to come second.
    expect(scripts.indexOf("/static/vendor/htmx.min.js")).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf("/static/vendor/htmx.min.js")).toBeLessThan(
      scripts.indexOf("/static/vendor/htmx-ext-sse.min.js"),
    );
  });

  test("loads the shell's Alpine component before Alpine itself", async () => {
    const elements = await shellPage();
    const deferred = elements
      .filter((element) => element.tag === "script" && element.attributes.has("defer"))
      .map((element) => element.attributes.get("src"));

    // app.js registers the Alpine `shell` component on `alpine:init`, so it must load before
    // alpine.min.js, which initializes on load. Both are `defer`, so document order is run order.
    expect(deferred).toContain("/static/app.js");
    expect(deferred.indexOf("/static/app.js")).toBeLessThan(
      deferred.indexOf("/static/vendor/alpine.min.js"),
    );
  });

  test("mounts no modal and loads the record view's own glue instead", async () => {
    const html = await responseText(await createTestApp().request("/"));
    const elements = await elementsOf(html);
    const modules = elements
      .filter((element) => element.tag === "script" && element.attributes.get("type") === "module")
      .map((element) => element.attributes.get("src"));

    // Nothing opens over anything else: a record opens through a view swap inside the
    // window, so the shell mounts no dialog and nothing is ever made inert.
    expect(elements.filter((element) => element.tag === "dialog")).toEqual([]);
    // Alpine's `:inert` and `x-bind:inert` make an element inert as surely as the bare attribute.
    const inert = elements.filter((element) =>
      [...element.attributes.keys()].some((name) => /(?:^|:)inert$/.test(name)),
    );
    expect(inert).toEqual([]);
    // The dumb glue files load: the record swap, its mutation feedback, and search.
    for (const glue of [
      "records/record-view.js",
      "records/record-mutations.js",
      "records/search-chrome.js",
    ]) {
      expect(modules).toContain(`/static/${glue}`);
    }
  });

  test("serves every file the page loads, and every file those reach, byte for byte", async () => {
    const app = createTestApp();
    const elements = await shellPage();
    const loaded = [
      ...scriptSources(elements),
      ...elements
        .filter(
          (element) => element.tag === "link" && element.attributes.get("rel") === "stylesheet",
        )
        .map((element) => element.attributes.get("href") as string),
    ];
    const pending = [...loaded];
    const served = new Set<string>();

    while (pending.length > 0) {
      const path = pending.pop() as string;
      if (served.has(path)) continue;
      served.add(path);
      const res = await app.request(path);
      const body = await res.text();

      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(res.headers.get("content-type") ?? "", path).toContain(
        path.endsWith(".css") ? "text/css" : "javascript",
      );
      expect(body, path).toBe(await Bun.file(onDisk(path)).text());
      pending.push(...reachedFrom(path, body));
    }
    // The walk followed the modules' own imports, not only the tags on the page.
    expect(served.size).toBeGreaterThan(loaded.length);
  });
});

const REPO_ROOT = resolve(import.meta.dir, "../..");

/** Where a served path is read from: the two static mounts `app.ts` declares. */
function onDisk(path: string): string {
  const mount = /^\/(static|design)\/(.+)$/.exec(path);
  if (mount === null) throw new Error(`not a static path: ${path}`);
  return resolve(REPO_ROOT, mount[1] === "static" ? "public" : "design", mount[2] as string);
}

/** The paths a served module imports or a served stylesheet `@import`s, resolved as a browser would. */
function reachedFrom(path: string, body: string): string[] {
  const specifiers = path.endsWith(".css")
    ? [...body.matchAll(/@import url\("([^"]+)"\)/g)]
    : [...code(body).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)];
  return specifiers.map(
    ([, specifier]) => new URL(specifier as string, `http://shell${path}`).pathname,
  );
}

describe("GET / (shell) — the window layer", () => {
  test("the page carries the layer the window opens on, and no region of its own", async () => {
    const elements = await shellPage();
    const layerClass = WINDOW_LAYER_SELECTOR.slice(1);
    const layers = elements.filter((element) =>
      (element.attributes.get("class") ?? "").split(/\s+/).includes(layerClass),
    );

    // The target the prompt form and every logo name is created by the client, inside the window.
    // The page carries the ground it stands on and the module that stands it there, nothing else.
    expect(layers.map(({ text }) => text)).toEqual([""]);
    expect(moduleSources(elements)).toContain("/static/desk/window/desk-window.js");
    expect(
      elements.filter((element) => element.attributes.get("id") === WINDOW_CONTENT_ID),
    ).toEqual([]);
    expect(elements.filter((element) => element.tag === "main")).toEqual([]);
  });
});

describe("GET /stream (the Module 1 greeting liveness route, removed in 4.8/06)", () => {
  test("is not registered — the provider round-trip is proved by the prompt bar", async () => {
    expect((await createTestApp().request("/stream")).status).toBe(404);
  });
});

describe("GET / (shell) — prompt admission", () => {
  test("preserves only an exact canonical revision or a truly neutral output", () => {
    const appScript = readFileSync(resolve("public/app.js"), "utf8");
    const shouldPreserve = Function(
      "document",
      "window",
      "requestAnimationFrame",
      `${appScript}\nreturn shouldPreserveRestoration;`,
    )({ addEventListener() {}, querySelector() {}, getElementById() {} }, {}, () => undefined);
    const v1 = { id: "notes", incarnation: "inc-1", version: "1" };

    expect(shouldPreserve("capability", v1, { ...v1 }, true, false)).toBe(true);
    expect(shouldPreserve("capability", v1, { ...v1, version: "2" }, true, false)).toBe(false);
    expect(shouldPreserve("capability", v1, { ...v1 }, false, false)).toBe(false);
    expect(shouldPreserve("neutral", null, null, false, true)).toBe(true);
    expect(shouldPreserve("neutral", null, null, false, false)).toBe(false);
  });
});

describe("GET / (shell) — stream close glue", () => {
  test("clears and refocuses the prompt when the build stream closes", () => {
    const listeners = new Map<string, (event?: Event) => void>();
    class InputStub {
      value = "track my notes";
      focused = false;

      focus() {
        this.focused = true;
      }
    }
    const promptField = new InputStub();
    let shellFactory: (() => { init(): void; promptBusy: boolean }) | undefined;
    const documentStub = {
      addEventListener(name: string, listener: () => void) {
        listeners.set(name, listener);
      },
      querySelector() {
        return null;
      },
      getElementById(id: string) {
        return id === PROMPT_FIELD_ID ? promptField : null;
      },
      // The close asks the prompt bar whether it was still saying anything about the run. No bar
      // stands in this scene, so nothing is cancelled and the prompt wakes and clears as always.
      dispatchEvent: () => true,
    };
    const windowStub = {
      Alpine: {
        data(_name: string, factory: typeof shellFactory) {
          shellFactory = factory;
        },
      },
      matchMedia() {
        return { matches: true, addEventListener() {} };
      },
    };
    const appScript = readFileSync(resolve("public/app.js"), "utf8");
    Function(
      "document",
      "window",
      "requestAnimationFrame",
      "HTMLInputElement",
      "HTMLElement",
      appScript,
      // `HTMLElement` because the close first asks whether the window is holding an ending; a
      // window with nothing in it answers no. The yes case is `app.build-ending.test.ts`.
    )(documentStub, windowStub, (callback: () => void) => callback(), InputStub, class {});

    listeners.get("alpine:init")?.();
    const state = shellFactory?.();
    if (state === undefined) throw new Error("shell factory was not registered");
    state.init();
    state.promptBusy = true;

    // A close the desk caused — a run left at 5.8/04's question, a logo switch — is not a run
    // finishing with something to say. The navigation that caused it has already placed focus.
    listeners.get("htmx:sseClose")?.(
      new CustomEvent("htmx:sseClose", { detail: { type: "nodeReplaced" } }),
    );
    expect(state.promptBusy).toBe(true);
    expect(promptField.focused).toBe(false);

    listeners.get("htmx:sseClose")?.(
      new CustomEvent("htmx:sseClose", { detail: { type: "message" } }),
    );

    expect(state.promptBusy).toBe(false);
    expect(promptField.value).toBe("");
    expect(promptField.focused).toBe(true);
  });
});

// Every surface these four tests name came down, and none of them answers in any environment.
// `/demo` itself is reserved for throwaway scaffolding (ADR-0002), which is why a route that
// stood in it is pinned gone rather than merely deleted: a revert restores four lines of
// registration, and nothing else in the suite would notice.
describe("the retired /demo surfaces are gone", () => {
  const previous = process.env.NODE_ENV;
  afterEach(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  test("module 5's inspection surfaces are unregistered in every environment", async () => {
    // All three came down, none taking evidence with it: gate-design-lint-high-meadow.test.ts,
    // router.read-gates.test.ts, fragments.test.ts and swap-target.test.ts now hold it.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createTestApp();
      for (const path of [
        "/demo/few-shot-gallery",
        "/demo/region-lifecycle",
        "/demo/region-lifecycle/read",
        "/demo/region-lifecycle/readers",
        "/demo/swap-targets",
      ]) {
        expect((await app.request(path)).status).toBe(404);
      }
      expect((await app.request("/demo/region-lifecycle/drain", { method: "POST" })).status).toBe(
        404,
      );
      // The product surface is untouched.
      expect((await app.request("/")).status).toBe(200);
    }
  });

  test("epic 4.9's previews are unregistered in every environment", async () => {
    // Both came down. The read gates' atomic token sets and drain/reopen are covered by
    // router.read-gates.test.ts, and the cleanup seam by the deletion fault battery.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createTestApp();
      for (const path of [
        "/demo/read-gates",
        "/demo/read-gates/state",
        "/demo/deletion-cleanup",
        "/demo/deletion-cleanup/state",
      ]) {
        expect((await app.request(path)).status).toBe(404);
      }
      for (const path of [
        "/demo/read-gates/notes/hold",
        "/demo/deletion-cleanup/notes/record-events",
        "/demo/deletion-cleanup/replay-batch",
      ]) {
        expect((await app.request(path, { method: "POST" })).status).toBe(404);
      }
    }
  });

  test("module 6's one-question exercise is unregistered in every environment", async () => {
    // It ran the whole query loop against the real database while the module was headless, so it
    // was open outside production and spent provider tokens. 6.5/03 made the real path visible
    // and 6.5/05 took it down; every claim it carried about the loop is proved elsewhere now.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createTestApp();
      expect((await app.request("/demo/question")).status).toBe(404);
      expect(
        (
          await app.request("/demo/question", {
            method: "POST",
            body: new URLSearchParams({ question: "how many notes?" }),
          })
        ).status,
      ).toBe(404);
      expect((await app.request("/")).status).toBe(200);
    }
  });

  test("the retired build surfaces are unregistered in every environment", async () => {
    // The evolution tracer's routes retired together with the legacy spec-build demo, so `/prompt`
    // is the single admission path. 404 here is Hono's "no such route", not an unknown capability.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createTestApp();
      expect((await app.request("/demo/spec-build")).status).toBe(404);
      expect((await app.request("/demo/evolution/build/nope/stream")).status).toBe(404);
      expect(
        (
          await app.request("/demo/evolution/notes", {
            method: "POST",
            body: new URLSearchParams({ intent: "Add something" }),
          })
        ).status,
      ).toBe(404);
    }
  });
});
