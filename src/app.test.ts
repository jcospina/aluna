// Tests for the platform's one route file — the cold-start shell and the
// deterministic, provider-free demo surfaces (detail interaction, few-shot gallery,
// mutation coordinator). The provider-driven build/stream slices live in the sibling
// app.*.test.ts files; shared setup, fixtures, and fake providers live in
// app.test-support.ts. app.request() drives app.fetch without binding a port.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSse, responseText, throwingProvider, wait } from "./app.test-support.ts";
import { createApp } from "./app.ts";
import { createMutationCoordinator } from "./mutation-coordinator/index.ts";

describe("GET / (shell)", () => {
  test("uses the prompt bar for the build-job flow and removes the old greeting button", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('id="spec-build-form"');
    expect(html).toContain('hx-post="/prompt"');
    expect(html).toContain('hx-target="#spec-build-output"');
    expect(html).toContain('hx-swap="innerHTML"');
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

describe("removed transitional installer", () => {
  test("the five-Action reference install route is gone", async () => {
    const response = await createApp().request("/demo/five-action-reference/install", {
      method: "POST",
    });

    expect(response.status).toBe(404);
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

describe("GET /demo/list-container (create cancel living demo)", () => {
  test("loads the real browser glue and exposes repeatable rows for cancel cleanup", async () => {
    const app = createApp();
    const body = await responseText(await app.request("/demo/list-container"));

    expect(body).toContain('<script defer src="/static/app.js"></script>');
    expect(body).toContain('<script defer src="/static/vendor/alpine.min.js"></script>');
    expect(body.indexOf("/static/app.js")).toBeLessThan(
      body.indexOf("/static/vendor/alpine.min.js"),
    );
    expect(body).toContain('data-list-field-label="Favorite quotes"');
    expect(body).toContain('data-list-input-id="cap-reading-quotes"');
    expect(body).toContain("data-list-field-add>Add another</button>");
    expect(body).toContain("data-create-cancel");
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

// The item click-to-open → read-only detail modal HITL surface (epic 3.3/02). Runs the whole
// real path (wrapper + modal + controllers) on a hand-written list, since the live read path
// does not emit wrapper items until 3.4 — so a human signs off the interaction here.
describe("GET /demo/detail-interaction (click-to-open detail, epic 3.3/02)", () => {
  test("renders live wrapped items + their detail templates + the shared modal + controllers", async () => {
    const app = createApp();
    const res = await app.request("/demo/detail-interaction");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");

    // Live wrapper output: accessible item triggers carrying the click-to-open hooks. The
    // adapter keys each template to the record id, so the first record's is detail-reading-<id>.
    expect(html).toContain('class="capability-item"');
    expect(html).toContain('data-detail-template="detail-reading-left-hand"');
    expect(html).toContain("data-detail-title=");
    // Each record's inert detail template, the one shared modal, and both real controllers.
    expect(html).toContain('<template id="detail-reading-left-hand">');
    expect(html).toContain('<dialog id="aluna-detail-modal"');
    expect(html).toContain('src="/static/detail-modal.js"');
    expect(html).toContain('src="/static/item-detail.js"');

    // The detail body honors detail.shows [title, rating, note, author]: it drops the
    // schema's "finished" field, so no detail surface shows a "Finished" label — proof the
    // modal follows the intent, not spec order. (The card still shows a Finished/Reading
    // status as plain text, which is not a <dt> label.)
    expect(html).not.toContain(">Finished</dt>");
  });

  test("escapes a hostile record so nothing executes in the list or the detail template", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/demo/detail-interaction"));

    // The raw element forms never appear (they are entity-escaped to inert text); the
    // `onerror=alert(2)` chars survive only inside the escaped `&lt;img …&gt;`, so we
    // assert on the element openings, which are what would execute.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
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

describe("GET /demo/mutation-coordinator (Module 4.2 admission preview)", () => {
  test("shows live active-lease and FIFO-queue regions with second-tab instructions", async () => {
    const app = createApp();
    const response = await app.request("/demo/mutation-coordinator");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("One owner on the write path");
    expect(html).toContain('id="active-lease"');
    expect(html).toContain('id="queue-list"');
    expect(html).toContain("/demo/mutation-coordinator/state");
    expect(html).toContain("/demo/mutation-coordinator/slow-build");
    expect(html).toContain("Second-tab check");
    expect(html).toContain("build a capability");
  });

  test("the deliberately slow build is queued and leased by the shared coordinator", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const recordLease = mutationCoordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();
    const app = createApp({
      mutationCoordinator,
      mutationPreviewHoldMs: 20,
    });

    const slowBuildResponse = app.request("/demo/mutation-coordinator/slow-build", {
      method: "POST",
    });
    await wait(0);
    expect(mutationCoordinator.snapshot().queuedTickets).toMatchObject([{ kind: "build" }]);

    expect(recordLease && mutationCoordinator.release(recordLease)).toBe(true);
    await wait(0);
    expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("build");
    expect((await slowBuildResponse).status).toBe(200);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("the legacy spec-build demo cannot bypass the shared coordinator", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const recordLease = mutationCoordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();
    const app = createApp({
      mutationCoordinator,
      getProvider: throwingProvider("preview stop"),
    });

    const response = await app.request("/demo/spec-build?prompt=track%20notes");
    const payload = readSse(response);
    await wait(0);
    expect(mutationCoordinator.snapshot().queuedTickets).toMatchObject([{ kind: "build" }]);

    expect(recordLease && mutationCoordinator.release(recordLease)).toBe(true);
    expect(await payload).toContain("event: done");
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });
});
