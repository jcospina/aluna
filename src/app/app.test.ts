// Tests for the platform's one route file — the cold-start shell and the
// deterministic, provider-free demo surfaces (detail interaction, few-shot
// gallery). The provider-driven build/stream slices live in the sibling
// app.*.test.ts files; shared setup, fixtures, and fake providers live in
// app.test-support.ts. app.request() drives app.fetch without binding a port.

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
    expect(html).toContain('id="spec-metrics-preview"');
    expect(html).toContain('id="spec-build-preview"');
    expect(html).toContain('id="spec-behavioral-tests-preview"');
    expect(html).toContain('id="spec-migration-preview"');
    expect(html).toContain('id="spec-units-preview"');
    expect(html).toContain('id="spec-gate-preview"');
    expect(html).toContain('id="spec-commit-preview"');
    expect(html).toContain('id="spec-build-output"');
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

  test("mounts the one shared detail modal and loads its click-to-open controllers", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // The shared read-only detail modal (epic 3.2/04) mounts on every shell — cold-start
    // included — so a clicked capability item (epic 3.3/02) always has the modal to open.
    // Exactly one shared instance: a platform invariant, not one-per-capability.
    expect(html).toContain('<dialog id="aluna-detail-modal"');
    expect(html).toContain('id="aluna-detail-modal-body"');
    expect(html.split('<dialog id="aluna-detail-modal"').length - 1).toBe(1);
    // Both dumb glue files load: the modal mechanics and the item click-to-open (ARCH §6.1).
    expect(html).toContain('<script type="module" src="/static/detail-modal.js"></script>');
    expect(html).toContain('<script type="module" src="/static/search-chrome.js"></script>');
    expect(html).toContain('src="/static/item-detail.js"');
  });

  test("serves the item click-to-open controller as JavaScript at its static path", async () => {
    const app = createApp();
    const res = await app.request("/static/item-detail.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    // It fires the shared modal's open event when an item is activated.
    expect(body).toContain("aluna:open-detail");
    expect(body).toContain(".capability-item");
  });

  test("serves the modal state module imported by the controller", async () => {
    const app = createApp();
    const res = await app.request("/static/detail-modal-state.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    expect(body).toContain("transitionDetailModalMode");
    expect(body).toContain('deleteConfirm: "delete-confirm"');
  });

  test("serves the committed-read refresh module imported by the controller", async () => {
    const app = createApp();
    const res = await app.request("/static/detail-modal-refresh.js");
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

    expect(js).toContain('document.addEventListener("htmx:sseBeforeMessage"');
    expect(js).toContain('document.addEventListener("htmx:sseOpen"');
    expect(js).toContain('document.addEventListener("htmx:sseClose"');
    expect(js).toContain('document.addEventListener("htmx:sseError"');
    expect(js).toContain('document.addEventListener("htmx:oobAfterSwap"');
    expect(js).toContain("syncCapabilityPresentationState");
    expect(js).toContain("syncActiveCapabilityUrl");
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
    expect(js).toContain("output.replaceChildren(...terminal.element.childNodes)");
    expect(js).toContain("commit.childNodes.length > 0");
    expect(js).toContain('subscriber.querySelector(".build-stream__narration")');
    expect(js).toContain("reloadRestoredRecords(output, terminal.restorationKind)");
    expect(js).toContain('.ajax("GET", readUrl');
    expect(js).toContain("source: records, target: records");
    expect(js).toContain('htmx.trigger(records, "htmx:abort")');
    expect(js).toContain('records.removeAttribute("hx-get")');
    expect(js).toContain('records.removeAttribute("hx-trigger")');
    expect(js).toContain(".catch(() => undefined)");
    expect(js).toContain('closeType !== "message"');
    expect(js).toContain("modal.close()");
    expect(js).toContain("window.history.replaceState");
    expect(js).toContain("[data-active-capability-id]");
    expect(js).toContain("dataset.previewTarget");
    expect(js).toContain('addEventListener("aluna:create-cancelled"');
    expect(js).toContain("collapseListFieldRows(form)");
    expect(js).toContain("Element.prototype.querySelectorAll.call(form");
    expect(js).not.toContain("new EventSource");
    expect(js).not.toContain('fetch("/prompt"');
    expect(js).not.toContain('addEventListener("submit"');
  });

  test("keeps a pending stream dormant until foreground narration begins", async () => {
    const app = createApp();
    const css = await responseText(await app.request("/static/css/demo.css"));

    expect(css).toMatch(/\.build-stream\s*\{[^}]*display:\s*none/s);
    expect(css).toContain(".build-stream__narration:not(:empty)");
    expect(css).toContain("#spec-build-output:has(> .build-stream");
    expect(css).toContain(".build-stream:only-child:not(:has");
    expect(css).toMatch(/only-child[^{}]+build-stream__commit:not\(:empty\)/s);
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

  test("prompt admission clears an old notice and rejects a queued sibling subscriber", () => {
    const listeners = new Map<
      string,
      (event: { detail: Record<string, unknown>; preventDefault(): void }) => void
    >();
    class FormStub {
      id = "spec-build-form";
    }
    let hasSubscriber = false;
    let noticeClears = 0;
    const output = {
      querySelector() {
        return hasSubscriber ? {} : null;
      },
    };
    const documentStub = {
      addEventListener(
        name: string,
        listener: (event: { detail: Record<string, unknown>; preventDefault(): void }) => void,
      ) {
        listeners.set(name, listener);
      },
      querySelector(selector: string) {
        return selector === "#spec-build-output" ? output : null;
      },
      getElementById(id: string) {
        return id === "prompt-notice" ? { replaceChildren: () => (noticeClears += 1) } : null;
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
      "HTMLFormElement",
      appScript,
    )(documentStub, windowStub, () => undefined, class InputStub {}, FormStub);

    let prevented = false;
    listeners.get("htmx:beforeRequest")?.({
      detail: { elt: new FormStub() },
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
    expect(noticeClears).toBe(1);

    hasSubscriber = true;
    listeners.get("htmx:beforeRequest")?.({
      detail: { elt: new FormStub() },
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(noticeClears).toBe(1);
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
      appScript,
    )(documentStub, windowStub, (callback: () => void) => callback(), InputStub);

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

// The few-shot gallery + injection harness HITL surface (epic 3.5). The route is
// deterministic and provider-free: it previews repo-owned exemplars and the exact
// prompt section the item-renderer generator receives.
describe("GET /demo/few-shot-gallery (few-shot gallery, epic 3.5)", () => {
  test("renders the repo-only examples through the live presentation path", async () => {
    const app = createApp();
    const res = await app.request("/demo/few-shot-gallery");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(html).toContain("Text-forward note card");
    expect(html).toContain("Media-forward grid tile");
    expect(html).toContain("Compact metadata row");
    expect(html.match(/class="capability-item"/g)?.length).toBe(6);
    expect(html).toContain('class="capability-records capability-records--feed"');
    expect(html).toContain('class="capability-records capability-records--grid"');
    expect(html).toContain("Workshop wall before launch");
    expect(html).toContain("Token discipline for generated interfaces");
    expect(html).toContain("data-detail-template=");
    expect(html).toContain('<dialog id="aluna-detail-modal"');
    expect(html).toContain('src="/static/detail-modal.js"');
    expect(html).toContain('src="/static/item-detail.js"');
  });

  test("previews the injected prompt section with vary-dont-copy framing and layout context", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/demo/few-shot-gallery"));

    expect(html).toContain("Injected prompt preview");
    expect(html).toContain("Few-shot gallery. Vary, don&#39;t copy");
    expect(html).toContain("Chosen collection layout for this capability: &quot;feed&quot;");
    expect(html).toContain("Chosen collection layout for this capability: &quot;grid&quot;");
    expect(html).toContain("style=&quot;grid-template-columns");
    expect(html).toContain("var(--border-thin) solid var(--color-border)");
  });
});

// The dev-only guard over the surviving `/demo/*` inspection routes (epic 4.8/07). A
// production bundle must not answer them, and that must be provable here rather than
// resting on someone remembering to run `bun run build` — hence the guard reads the
// environment per `createApp()` call instead of freezing at import.
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
    // The product surface is untouched by the guard.
    expect((await app.request("/")).status).toBe(200);
  });

  test("the retired build surfaces are unregistered in every environment", async () => {
    // The evolution tracer's content-area control and its routes retired together
    // (4.8/04), and the legacy spec-build demo followed (4.8/08), so `/prompt` is the
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
