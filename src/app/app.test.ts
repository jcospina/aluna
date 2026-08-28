// Tests for the platform's one route file — the cold-start shell and the
// deterministic, provider-free demo surfaces (detail interaction, few-shot
// gallery). The provider-driven build/stream slices live in the sibling
// app.*.test.ts files; shared setup, fixtures, and fake providers live in
// app.test-support.ts. app.request drives app.fetch without binding a port.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { responseText } from "./app.test-support.ts";
import { createApp } from "./app.ts";

describe("GET / (shell)", () => {
  test("uses the prompt bar for the build-job flow and removes the old greeting button", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('id="spec-build-form"');
    expect(html).toContain('hx-post="/prompt"');
    expect(html).toContain('hx-target="#spec-build-output"');
    expect(html).toContain('hx-swap="beforeend"');
    expect(html).not.toContain("@htmx:sseOpen.window");
    expect(html).not.toContain("@htmx:sseClose.window");
    expect(html).not.toContain("@htmx:sseError.window");
    expect(html).toContain("promptBusy ? 'Making it' : 'Make it'");
    expect(html).toContain('id="spec-build-prompt"');
    expect(html).toContain('placeholder="What would you like to keep track of?"');
    expect(html).not.toContain('value="I want to keep track of my notes"');
    expect(html).toContain('id="spec-build-trigger"');
    expect(html).toContain("Make it");
    // The developer panel's eight readouts left the page with the rail that held
    // them: they are code blocks in the panel's own window now, built client-side
    // (public/desk-dev-panel.js). What the page still carries is the way in — the
    // tile — and the one stage the server already knows the answer to.
    expect(html).toContain("data-dev-tile");
    expect(html).toContain('id="dev-stage-seed"');
    expect(html).toContain('data-dev-stage-seed="metrics"');
    expect(html).toContain("/static/desk-dev-panel.js");
    expect(html).not.toContain('class="devbar"');
    expect(html).not.toContain('id="spec-metrics-preview"');
    expect(html).not.toContain('id="spec-gate-preview"');
    expect(html).not.toContain("panel-toggle");
    expect(html).toContain('id="prompt-notice"');
    expect(html).not.toContain("Meet Aluna");
    expect(html).not.toContain('id="intro-trigger"');
    expect(html).not.toContain('id="intro-output"');
  });

  test("loads the vendored htmx SSE extension after htmx", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // The extension is vendored locally and its <script> is loaded after htmx's
    // (it calls htmx.defineExtension at load). Compare the full src attributes so
    // prose mentions of the filenames in nearby comments can't skew the order.
    expect(html).toContain('src="/static/vendor/htmx-ext-sse.min.js"');
    expect(html.indexOf('src="/static/vendor/htmx.min.js"')).toBeLessThan(
      html.indexOf('src="/static/vendor/htmx-ext-sse.min.js"'),
    );
  });

  test("loads the shell's Alpine component before Alpine itself", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // app.js registers the Alpine `shell` component on `alpine:init`, so it MUST load
    // before alpine.min.js — the cdn build initializes on load and would fire the event
    // before the component existed. Both are `defer`, so document order is run order.
    expect(html).toContain('<script defer src="/static/app.js"></script>');
    expect(html).toContain('<script defer src="/static/vendor/alpine.min.js"></script>');
    expect(html.indexOf('src="/static/app.js"')).toBeLessThan(
      html.indexOf('src="/static/vendor/alpine.min.js"'),
    );
  });

  test("serves the vendored htmx SSE extension as JavaScript at its static path", async () => {
    const app = createApp();
    const res = await app.request("/static/vendor/htmx-ext-sse.min.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    // It is the htmx SSE extension: it registers itself on htmx at load.
    expect(body).toContain('defineExtension("sse"');
  });

  test("mounts no modal and loads the record view's own glue instead", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // Nothing opens over anything else: a record opens through a view swap inside the
    // window, so the shell mounts no dialog and nothing is ever made inert.
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("detail-modal");
    expect(html).not.toMatch(/\binert\s*(=|>)/);
    // The dumb glue files load: the record swap, its mutation feedback, and search.
    expect(html).toContain('<script type="module" src="/static/record-view.js"></script>');
    expect(html).toContain('<script type="module" src="/static/record-mutations.js"></script>');
    expect(html).toContain('<script type="module" src="/static/search-chrome.js"></script>');
  });

  test("serves the record swap as JavaScript at its static path", async () => {
    const app = createApp();
    const res = await app.request("/static/record-view.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    // It swaps a record's form in for the collection, releasing what the collection held.
    expect(body).toContain(".capability-item");
    expect(body).toContain("releaseRegionContent");
  });

  test("serves the record mutation feedback module", async () => {
    const app = createApp();
    const res = await app.request("/static/record-mutations.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    expect(body).toContain("data-record-edit-form");
    expect(body).toContain("leaveRecordView");
  });

  test("serves the committed-read refresh module imported by create and search", async () => {
    const app = createApp();
    const res = await app.request("/static/records-refresh.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    expect(body).toContain("refreshCommittedRecords");
    expect(body).toContain('"HX-Request": "true"');
  });

  test("serves the shared records-region request owner imported by search and refresh", async () => {
    const app = createApp();
    const res = await app.request("/static/records-region-requests.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("createRecordsRegionRequestCoordinator");
  });

  test("serves the debounced search controller as JavaScript at its static path", async () => {
    const app = createApp();
    const res = await app.request("/static/search-chrome.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    expect(body).toContain("createDebouncedCapabilitySearch");
    expect(body).toContain("data-capability-search-input");
    expect(body).toContain('"HX-Request": "true"');
  });
});

describe("GET / (shell) — the window layer", () => {
  test("the page carries the layer the window opens on, and no region of its own", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // The target the prompt form and every logo name is created by the client, inside
    // the window. The served page carries the ground that window stands on, the module
    // that stands it there, and nothing else where the content area used to be.
    expect(html).toContain('<div class="desk__windows"></div>');
    expect(html).toContain('<script type="module" src="/static/desk-window.js"></script>');
    expect(html).not.toContain('id="spec-build-output"');
    expect(html).not.toContain("<main");
  });
});

describe("removed transitional installer", () => {});

describe("GET /stream (the Module 1 greeting liveness route, removed in 4.8/06)", () => {
  test("is not registered — the provider round-trip is proved by the prompt bar", async () => {
    expect((await createApp().request("/stream")).status).toBe(404);
  });
});

describe("GET / (shell) — browser glue", () => {
  test("browser prompt glue leaves the prompt request and stream connection to HTMX", async () => {
    const app = createApp();
    const js = await responseText(await app.request("/static/app.js"));
    const html = await responseText(await app.request("/"));

    expect(js).toContain('document.addEventListener("htmx:sseBeforeMessage"');
    expect(js).toContain('document.addEventListener("htmx:sseOpen"');
    expect(js).toContain('document.addEventListener("htmx:sseClose"');
    expect(js).toContain('document.addEventListener("htmx:sseError"');
    expect(js).toContain("tellDeskTheWindowTookCapability");
    expect(js).toContain('new CustomEvent("aluna:window-took-capability"');
    expect(js).toContain('document.addEventListener("htmx:configRequest"');
    expect(js).toContain("__aluna_restore_capability_id");
    expect(js).toContain("__aluna_restore_incarnation_id");
    expect(js).toContain("finishTerminalPresentation");
    expect(js).toContain("data-build-restoration-behavior");
    expect(js).toContain("preserveActiveView");
    expect(js).toContain("activeViewIsCanonical");
    expect(js).toContain("outputHasOnlyDormantSubscriber");
    expect(js).toContain("promoteElement");
    expect(js).toContain("subscriber.remove()");
    expect(js).toContain("output.append(...promoted)");
    expect(js).toContain("releaseDisplacedContent(output, promoted)");
    // The promoted View is wired up rather than re-fetched, so its own `load` trigger is
    // the one canonical read — whether or not htmx's 20ms settle got there first.
    expect(js).toContain("processPromotedContent(promoted)");
    expect(js).toContain("htmx.process(node)");
    expect(js).toContain("commit.childNodes.length > 0");
    expect(js).toContain('subscriber.querySelector(".build-stream__narration")');
    // The window has no refresh verb, so the glue has no hand-rebuilt read: the
    // restoration's own View read is kept alive by promoting before releasing, and
    // every open is one fresh read (PLAN decision 15; ARCH §8).
    expect(js).not.toContain("reloadRestoredRecords");
    expect(js).not.toContain('.ajax("GET"');
    expect(js).not.toContain('removeAttribute("hx-trigger")');
    expect(js).toContain('closeType !== "message"');
    expect(js).toContain("window.history.replaceState");
    // The address is the desk's to write: the glue reports what happened and never pushes.
    expect(js).not.toContain("history.pushState");
    expect(js).toContain(":scope > [data-active-capability-id]");
    // A stage name, not an element id: the developer panel is a window that may not be
    // standing, so the glue hands the payload over rather than writing it into a <pre>.
    expect(js).toContain("dataset.previewStage");
    expect(js).not.toContain("dataset.previewTarget");
    expect(js).toContain('STAGE_PAYLOAD_EVENT = "aluna:stage-payload"');
    expect(js).toContain('STAGES_CLEARED_EVENT = "aluna:stages-cleared"');
    // A run that ended with something to tell you holds the window there; the press is
    // what gives back what it displaced (PLAN decisions 23 and 25).
    expect(js).toContain('BUILD_ENDING_SELECTOR = "[data-build-ending]"');
    expect(js).toContain('BUILD_DISMISS_SELECTOR = "[data-build-dismiss]"');
    expect(js).toContain("holdRestoration");
    expect(js).toContain("giveBackTheWindow");
    expect(js).toContain("dropHeldRun");
    expect(js).toContain("rescueHeldEnding");
    // The repeated-value rows are a module of their own now (public/list-field.js), so
    // the glue neither owns them nor knows they exist.
    expect(js).not.toContain("collapseListFieldRows");
    expect(js).not.toContain("data-list-field");
    // Recovering a severed capability deletion is a module of its own too
    // (`public/capability-deletion.js`), and it took its half of `htmx:configRequest`
    // with it — the glue's copy now only captures what a *prompt* displaces.
    expect(js).not.toContain("focusCapabilityDeletion");
    expect(js).not.toContain("[data-capability-deletion-focus]");
    expect(js).not.toContain("restore_surface");
    // The rail and the gate it hid behind are gone from the page and from the glue.
    expect(js).not.toContain("hasCapabilities");
    expect(html).not.toContain("has-capabilities");
    expect(html).not.toContain('id="capability-toolbar"');
    expect(html).toContain('id="capability-logos"');
    expect(js).not.toContain("new EventSource");
    expect(js).not.toContain('fetch("/prompt"');
    expect(js).not.toContain('addEventListener("submit"');
  });

  test("structured create validation swaps into its retarget without becoming a successful create", () => {
    const listeners = new Map<string, (event: { detail: Record<string, unknown> }) => void>();
    const documentStub = {
      addEventListener(
        name: string,
        listener: (event: { detail: Record<string, unknown> }) => void,
      ) {
        listeners.set(name, listener);
      },
      querySelector() {
        return null;
      },
      getElementById() {
        return null;
      },
    };
    const windowStub = {
      Alpine: { data() {} },
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
      appScript,
    )(documentStub, windowStub, () => undefined, class InputStub {});

    for (const [code, status] of [
      ["missing_required_fields", 422],
      ["mutation_busy", 422],
      ["record_not_found", 404],
      ["mutation_failed", 500],
    ] as const) {
      const detail = {
        xhr: {
          status,
          responseText: `<p data-role="error" data-error-code="${code}">Try again</p>`,
        },
        shouldSwap: false,
        isError: true,
        successful: false,
      };
      listeners.get("htmx:beforeSwap")?.({ detail });

      expect(detail.shouldSwap).toBe(true);
      expect(detail.isError).toBe(true);
      expect(detail.successful).toBe(false);
    }
  });
});

test("keeps a pending stream dormant until foreground narration begins", async () => {
  const app = createApp();
  const css = await responseText(await app.request("/static/css/demo.css"));

  expect(css).toMatch(/\.build-stream\s*\{[^}]*display:\s*none/s);
  expect(css).toContain(".build-stream__narration:not(:empty)");
  expect(css).toContain("#spec-build-output:has(> .build-stream");

  // The shell's own content area is gone with the window: a window that holds nothing
  // does not exist, so there is no longer a surface to keep quiet until it does. Every
  // rule that hid one is retired rather than ported.
  expect(css).not.toContain(".content__active");
  expect(css).not.toContain(".intro__output");
  expect(css).not.toMatch(/:has\([^)]*:has\(/);
});

test("permanent deletion captures neutral or exact-capability restoration in browser glue", async () => {
  const app = createApp();
  // Its own module since M5 plan 1 — deletion recovery is a subject, reached only
  // through events, and nothing about it has to be in place before Alpine starts.
  const js = await responseText(await app.request("/static/capability-deletion.js"));
  const css = await responseText(await app.request("/static/css/demo.css"));
  const shell = await responseText(await app.request("/"));

  expect(js).toContain('detail.parameters.restore_surface = "neutral"');
  expect(js).toContain('detail.parameters.restore_surface = "capability"');
  expect(shell).toContain('<script type="module" src="/static/capability-deletion.js"></script>');
  expect(css).not.toContain("data-capability-deletion-neutral");
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

  // htmx will not swap any 4xx on its own, so a refusal the shell does not rescue is a
  // refusal the user never sees. This drives the real handler with the real fragments.
  test("the shell rescues the read-gate refusal the router actually sends", async () => {
    const listeners = new Map<string, (event: { detail: Record<string, unknown> }) => void>();
    const appScript = readFileSync(resolve("public/app.js"), "utf8");
    Function(
      "document",
      "window",
      "requestAnimationFrame",
      "HTMLInputElement",
      "HTMLFormElement",
      appScript,
    )(
      {
        addEventListener(name: string, listener: (event: { detail: never }) => void) {
          listeners.set(name, listener as never);
        },
        querySelector: () => null,
        getElementById: () => null,
      },
      { matchMedia: () => ({ matches: false, addEventListener() {} }) },
      () => undefined,
      class {},
      class {},
    );

    const beforeSwap = listeners.get("htmx:beforeSwap");
    expect(beforeSwap).toBeDefined();
    const swapDecision = (status: number, responseText: string) => {
      const detail = { xhr: { status, responseText }, shouldSwap: false };
      beforeSwap?.({ detail } as never);
      return detail.shouldSwap;
    };

    // The exact bodies src/router/read-refusal.ts returns for a closing incarnation.
    const readRefusal =
      '<p class="notice" data-role="error" data-error-code="read_unavailable">I’m making a careful change here. Give me a moment, then try that again.</p>';

    expect(swapDecision(409, readRefusal)).toBe(true);
    expect(swapDecision(422, readRefusal)).toBe(true);
    // An unmarked 4xx body is still none of the shell's business.
    expect(swapDecision(409, '<p class="notice">something else entirely</p>')).toBe(false);
  });
});

describe("GET / (shell) — stream close glue", () => {
  test("clears and refocuses the prompt when the build stream closes", () => {
    const listeners = new Map<string, () => void>();
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
        return id === "spec-build-prompt" ? promptField : null;
      },
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
      // `HTMLElement` because the close first asks whether the window is holding an
      // ending; a window with nothing in it answers no, and the prompt wakes as it always
      // has. What it does when the answer is yes is `app.build-ending.test.ts`.
    )(documentStub, windowStub, (callback: () => void) => callback(), InputStub, class {});

    listeners.get("alpine:init")?.();
    const state = shellFactory?.();
    if (state === undefined) throw new Error("shell factory was not registered");
    state.init();
    state.promptBusy = true;

    listeners.get("htmx:sseClose")?.();

    expect(state.promptBusy).toBe(false);
    expect(promptField.value).toBe("");
    expect(promptField.focused).toBe(true);
  });
});

// The dev-only guard over the surviving `/demo/*` inspection routes. A
// production bundle must not answer them, and that must be provable here rather than
// resting on someone remembering to run `bun run build` — hence the guard reads the
// environment per `createApp` call instead of freezing at import.
describe("the dev-only guard on the remaining /demo/* inspection routes", () => {
  const previous = process.env.NODE_ENV;
  afterEach(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  test("a production run serves the shell but not the developer inspection routes", async () => {
    process.env.NODE_ENV = "production";
    const app = createApp();

    expect((await app.request("/demo/few-shot-gallery")).status).toBe(404);
    expect((await app.request("/demo/region-lifecycle")).status).toBe(404);
    expect((await app.request("/demo/region-lifecycle/readers")).status).toBe(404);
    expect((await app.request("/demo/swap-targets")).status).toBe(404);
    expect((await app.request("/demo/read-gates")).status).toBe(404);
    // The product surface is untouched by the guard.
    expect((await app.request("/")).status).toBe(200);
  });

  test("epic 4.9's previews are unregistered in every environment", async () => {
    // Both came down. A demo is scaffolding for work in progress: the read
    // gates' atomic token sets and drain/reopen are covered by
    // src/router/router.read-gates.test.ts, and the cleanup seam by the deletion fault
    // battery and the two seam-fake suites, so neither removal took evidence with it.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createApp();
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

  test("the retired build surfaces are unregistered in every environment", async () => {
    // The evolution tracer's content-area control and its routes retired together
    // and the legacy spec-build demo followed, so `/prompt` is the
    // single admission path for every build. Nothing answers here any more — 404 is
    // Hono's "no such route", not a route reporting an unknown capability.
    for (const nodeEnv of ["production", "development"]) {
      process.env.NODE_ENV = nodeEnv;
      const app = createApp();
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
