import { describe, expect, test } from "bun:test";
import {
  abortTransportUnder,
  CONTENT_REGION_SELECTOR,
  createRegionReleaseRegistry,
  RELEASE_REGION_EVENT,
  registerRegionRelease,
  startRegionScopes,
} from "#shell/core/region-scope.js";
import { recoverSeveredCapabilityDeletion } from "#shell/desk/logos/capability-deletion.js";
import { createRecordsRegionRequestCoordinator } from "#shell/records/records-region-requests.js";
import { renderCapabilityDeletionConfirmation } from "../../../lifecycle/deletion/index.ts";
import { notesRow } from "../../../runtime/router/dispatch/router.test-support.ts";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import {
  El as ShellEl,
  desk as shellDesk,
  Template,
} from "../../../server/shell-glue/app.shell-double.test-support.ts";
import { readSource } from "../../safety/source.test-support.ts";
import type { El as DeskEl } from "../window/standing-desk.test-support.ts";
import { viewportDesk } from "../window/viewport-desk.test-support.ts";
import { document, Node } from "./region-scope.test-support.ts";

describe("a content region releases what its content started", () => {
  test("replacing the content releases every fetch, controller and read token it acquired", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    const search = new Node("search form");
    body.append(region);
    region.append(list, search);

    const released: string[] = [];
    registry.register(list, "records read", () => released.push("records read"));
    registry.register(search, "search controller", () => released.push("search controller"));
    expect(registry.size).toBe(2);

    // The region stays; only what it was showing goes.
    region.replaceChildren(new Node("record"));
    registry.sweep();

    expect(released.sort()).toEqual(["records read", "search controller"]);
    expect(registry.size).toBe(0);
  });

  test("removing the region releases the same set", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    const released: string[] = [];
    registry.register(list, "records read", () => released.push("records read"));
    registry.register(region, "region observer", () => released.push("region observer"));

    region.remove();
    registry.sweep();

    expect(released.sort()).toEqual(["records read", "region observer"]);
    expect(registry.size).toBe(0);
  });

  test("a list → record → back swap releases each view's work as that view goes", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    body.append(region);

    const released: string[] = [];
    const showList = () => {
      const list = new Node("list");
      region.replaceChildren(list);
      registry.register(list, "list read", () => released.push("list read"));
      registry.sweep();
      return list;
    };

    showList();
    expect(released).toEqual([]);

    // Into the record.
    const record = new Node("record");
    region.replaceChildren(record);
    registry.register(record, "record read", () => released.push("record read"));
    registry.sweep();
    expect(released).toEqual(["list read"]);

    // And back. The region never went away, and nothing has leaked across either swap.
    showList();
    expect(released).toEqual(["list read", "record read"]);
    expect(registry.size).toBe(1);

    region.remove();
    registry.sweep();
    expect(released).toEqual(["list read", "record read", "list read"]);
    expect(registry.size).toBe(0);
  });
});

describe("the release rule holds at its edges", () => {
  test("the pre-detach release and the observer's sweep cannot run one entry twice", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    let releases = 0;
    registry.register(list, "records read", () => {
      releases += 1;
    });

    // htmx announces the node while it is still connected — the only moment its request
    // can be aborted — and the observer reports the same removal afterwards.
    registry.releaseUnder(region);
    region.replaceChildren();
    registry.sweep();

    expect(releases).toBe(1);
  });

  test("work that finishes on its own terms leaves the scope without being released", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    let released = false;
    const deregister = registry.register(list, "records read", () => {
      released = true;
    });
    deregister();

    region.replaceChildren();
    registry.sweep();

    expect(released).toBe(false);
    expect(registry.size).toBe(0);
  });

  test("work registered before its content is on the page survives until it arrives", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);

    let released = false;
    registry.register(list, "records read", () => {
      released = true;
    });

    // Two sweeps happen before the content is inserted; neither may take it away.
    registry.sweep();
    registry.sweep();
    expect(released).toBe(false);

    region.append(list);
    registry.sweep();
    expect(released).toBe(false);

    list.remove();
    registry.sweep();
    expect(released).toBe(true);
  });

  test("the live scope names the region each piece of work belongs to", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const content = new Node("content", "content area");
    const records = new Node("records", "records");
    const search = new Node("search form");
    body.append(content);
    content.append(search, records);

    registry.register(records, "records read", () => undefined);
    registry.register(search, "search controller", () => undefined);

    expect(registry.report()).toEqual([
      { region: "records", label: "records read" },
      { region: "content area", label: "search controller" },
    ]);
  });
});

describe("a records region's request is the scope entry", () => {
  test("releasing the region aborts the in-flight claim, so no response lands on a detached node", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("records", "records");
    body.append(region);

    const core = createRecordsRegionRequestCoordinator();
    const claim = core.claim();
    const deregister = registry.register(region, "records read", claim.abort);

    expect(claim.isCurrent()).toBe(true);
    expect(claim.signal.aborted).toBe(false);

    region.remove();
    registry.sweep();

    // The abort is the release: the fetch stops, and the server sees the disconnect that
    // frees its read token.
    expect(claim.signal.aborted).toBe(true);
    expect(claim.isCurrent()).toBe(false);
    deregister();
  });
});

/** Stand `globals` up while `run` runs, and put back exactly what was there. */
async function withGlobals(globals: Record<string, unknown>, run: () => Promise<void>) {
  const host = globalThis as Record<string, unknown>;
  const before = Object.keys(globals).map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(host, name, { value, configurable: true, writable: true });
  }
  try {
    await run();
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else Reflect.deleteProperty(host, name);
    }
  }
}

// The shell's own replacements of the region go through the rule. The build ending's is run in
// `app.shell-glue.test.ts` ("an activation takes the window…", which reads the release event this
// module listens for); the severed deletion's is run here.
describe("the shell's own replacements release through the rule", () => {
  test("a severed deletion's answer releases the window's region before it replaces it", async () => {
    const stage = shellDesk();
    stage.subscriber.remove();
    const swapped = new Template();
    swapped.innerHTML = renderCapabilityDeletionConfirmation(notesRow(), []);
    const forms = (node: ShellEl): ShellEl[] => [
      ...(node.tag === "form" ? [node] : []),
      ...node.children.flatMap(forms),
    ];
    const [confirm] = forms(swapped.content) as [ShellEl];
    stage.region.append(confirm);

    const order: string[] = [];
    // Heard where `region-scope.js` listens, at the document: a release that does not climb is
    // one no scope ever hears.
    stage.root.addEventListener(RELEASE_REGION_EVENT, (event: Event) => {
      if (event.target === stage.region) order.push(event.type);
    });
    await withGlobals(
      {
        document: stage.root,
        HTMLElement: ShellEl,
        window: { htmx: { swap: () => order.push("swap") }, history: { replaceState: () => {} } },
        fetch: () => Promise.resolve(new Response("<p>answered</p>")),
      },
      async () => {
        recoverSeveredCapabilityDeletion(
          { detail: { elt: confirm } } as never,
          stage.root as never,
        );
        for (let waited = 0; !order.includes("swap") && waited < 40; waited += 1) {
          await Bun.sleep(25);
        }
      },
    );
    expect(order).toEqual([RELEASE_REGION_EVENT, "swap"]);
  });

  test("putting a window away releases its region's work, heard where the scopes listen", async () => {
    const screen = await viewportDesk();
    try {
      startRegionScopes(screen.desk.root as never);
      const region = screen.module.openWindow(
        "Notes",
        screen.desk.doc as never,
      ) as unknown as DeskEl;
      const reading = screen.desk.doc.createElement("section");
      region.append(reading);
      const released: string[] = [];
      registerRegionRelease(reading as never, "records read", () => released.push("records read"));

      screen.module.putAway();

      expect(released).toEqual(["records read"]);
    } finally {
      screen.restore();
    }
  });

  test("the window marks the one region, and the shell starts the system", async () => {
    // The shell marks nothing: the region lives inside the window, which the client creates and
    // destroys, so putting the window away is the only way a region disappears.
    const shell = readSource("public/index.html");
    const scripts = moduleSources(await elementsOf(shell));
    expect(scripts).toContain("/static/core/region-scope.js");
    expect(scripts).toContain("/static/desk/window/desk-window.js");

    // The marker the module looks for is the one the window writes on the region it makes.
    const screen = await viewportDesk();
    try {
      const region = screen.module.openWindow("Notes", screen.desk.doc as never);
      expect((region as unknown as DeskEl).matches(CONTENT_REGION_SELECTOR)).toBe(true);
    } finally {
      screen.restore();
    }
  });
});

/*
 * The half the release rule's own suite could not reach: `abortTransportIn` sat behind an
 * `instanceof Element` guard, so a double excluded the branch from every test.
 */
describe("the transport half: what an htmx request in flight is asked", () => {
  function aborting() {
    const aborted: string[] = [];
    return {
      aborted,
      trigger: (node: Node, eventName: string) => aborted.push(`${node.name}:${eventName}`),
    };
  }

  test("every request under the released node is aborted, and nothing else is", () => {
    const region = new Node("content", "content area");
    const reading = new Node("canonical read");
    const idle = new Node("form");
    const searching = new Node("search");
    reading.requesting = true;
    searching.requesting = true;
    region.append(reading, idle);
    idle.append(searching);

    const { aborted, trigger } = aborting();
    expect(abortTransportUnder(region, trigger).map((node) => node.name)).toEqual([
      "canonical read",
      "search",
    ]);
    expect(aborted).toEqual(["canonical read:htmx:abort", "search:htmx:abort"]);
  });

  // The canonical read is the region's own content, so when the region carries the request there
  // is no descendant to find and a downward-only walk let the most ordinary abort through.
  test("the released node's own request is aborted first", () => {
    const region = new Node("content", "content area");
    const child = new Node("child");
    region.requesting = true;
    child.requesting = true;
    region.append(child);

    const { aborted, trigger } = aborting();

    expect(abortTransportUnder(region, trigger).map((node) => node.name)).toEqual([
      "content",
      "child",
    ]);
    expect(aborted[0]).toBe("content:htmx:abort");
  });

  test("a region with nothing in flight asks nothing", () => {
    const region = new Node("content", "content area");
    region.append(new Node("list"));
    const { aborted, trigger } = aborting();

    expect(abortTransportUnder(region, trigger)).toEqual([]);
    expect(aborted).toEqual([]);
  });
});
