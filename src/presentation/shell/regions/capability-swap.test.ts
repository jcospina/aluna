import { describe, expect, test } from "bun:test";
import {
  createRegionReleaseRegistry,
  registerRegionRelease,
  releaseRegionContent,
} from "#shell/core/region-scope.js";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { WINDOW_CONTENT_REGION, windowForOpening } from "#shell/desk/window/desk-window.js";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import {
  capabilityRecordsRegionId,
  type RenderableCapability,
} from "../../fields/field-renderer.ts";
import { renderCollection } from "../../records/collection/list-container.ts";
import { recordDesk } from "../../records/record-view/record-view.test-support.ts";
import { code } from "../../safety/source.test-support.ts";
import { viewportDesk } from "../window/viewport-desk.test-support.ts";
import { document as desk, Node } from "./region-scope.test-support.ts";

// Opening a second capability (PLAN decision 15; ARCH §6.1 and §8; design D2). A swap may not
// touch the frame, must release the departing content, and gets no staleness machinery at all.

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  noun: "task",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

/* ── the frame ─────────────────────────────────────────────────────────────── */

/**
 * A window whose geometry and drawn hand cannot be written without saying so. Reading them back
 * proves nothing once the entry is the same object; refusing the assignment is what proves it.
 */
function frame(title: string) {
  const win = {
    title,
    setTitle(next: string) {
      win.title = next;
    },
  };
  const settled = { box: { x: 240, w: 700 }, seed: 4711, region: {} };
  const refuse = (name: string) => () => {
    throw new Error(`an opening wrote \`${name}\`, which is settled at mount`);
  };
  return {
    win,
    openedBy: null as unknown,
    get box() {
      return settled.box;
    },
    set box(_: typeof settled.box) {
      refuse("box")();
    },
    get seed() {
      return settled.seed;
    },
    set seed(_: number) {
      refuse("seed")();
    },
    get region() {
      return settled.region;
    },
    set region(_: object) {
      refuse("region")();
    },
  };
}

describe("opening a second capability swaps the contents, not the frame", () => {
  test("a window already standing is the window the next capability opens into", () => {
    let mounts = 0;
    const mount = () => {
      mounts += 1;
      return frame("Tasks");
    };
    const logo = { name: "the Tasks logo" };
    const journalLogo = { name: "the Journal logo" };

    const first = windowForOpening(null, mount, "Tasks", logo);
    const second = windowForOpening(first, mount, "Journal", journalLogo);

    // One frame, not two, and the same one: its position, size, region and drawn hand are the
    // ones it had, and the rule would have thrown on its way through if it reached for any.
    expect(mounts).toBe(1);
    expect(second).toBe(first);

    // What does change: the title, because the window now frames something else.
    expect(second.win.title).toBe("Journal");

    // And the way back is the last thing that filled the window, not the first: after A, B, C,
    // returning to A dropped a keyboard user three moves back with nothing to say why.
    expect(second.openedBy).toBe(journalLogo);

    // A press that names no opener leaves whatever the window already had.
    expect(windowForOpening(second, mount, "Journal", null).openedBy).toBe(journalLogo);
  });

  test("the desk opens the next capability into the window already standing", async () => {
    // The frame is built once, so its box and its drawn hand — the seed is rolled where the
    // frame is built — cannot be touched by an opening (design D10).
    const screen = await viewportDesk();
    try {
      screen.module.openWindow("Tasks", screen.desk.doc as never);
      const [frame] = screen.desk.windows();
      const bar = frame?.querySelector("header");
      screen.module.openWindow("Journal", screen.desk.doc as never);
      expect(screen.desk.windows()).toEqual([frame as never]);
      expect(frame?.querySelector("header")).toBe(bar as never);
      expect(bar?.querySelector("h2")?.textContent).toBe("Journal");
    } finally {
      screen.restore();
    }
  });
});

/* ── what a swap releases ──────────────────────────────────────────────────── */

describe("the outgoing capability's work is released on the swap", () => {
  // That the release rule releases is 5.3/01's own suite (`region-scope.test.ts`). What
  // is this issue's is where it is now reached from, and what it is not allowed to take.

  test("the region outlives the content, so the swap has a frame to land in", () => {
    const registry = createRegionReleaseRegistry();
    const body = desk();
    const region = new Node("the window's content", WINDOW_CONTENT_REGION);
    const tasks = new Node("the Tasks collection");
    const tasksRecords = new Node("the Tasks records", "records");
    const tasksSearch = new Node("the Tasks search form");
    body.append(region);
    region.append(tasks);
    tasks.append(tasksSearch, tasksRecords);

    const readToken = new AbortController();
    registry.register(tasksRecords, "records read", () => readToken.abort());
    registry.register(tasksSearch, "search controller", () => undefined);

    // htmx's innerHTML swap announces each node it detaches while that node is still
    // connected, and then puts the next capability in its place.
    registry.releaseUnder(tasks);
    tasks.remove();
    const journal = new Node("the Journal collection");
    region.append(journal);
    registry.sweep();

    expect(readToken.signal.aborted).toBe(true);
    expect(registry.size).toBe(0);
    expect(region.children).toEqual([journal]);
    expect(region.isConnected).toBe(true);
  });

  test("a search takes the region from the View's own read through the rule", async () => {
    // The post-mutation re-read does the same, run in `records-refresh.test.ts` ("releases the
    // read that was already filling it, and still renders its own").
    const page = await recordDesk(renderCollection({ capability: SAMPLE, loadThroughRead: true }), {
      modules: ["records/search-chrome.js"],
    });
    try {
      const records = page.doc.getElementById(capabilityRecordsRegionId(SAMPLE.id)) as El;
      const viewRead = new AbortController();
      registerRegionRelease(records as never, "records read", () => viewRead.abort());
      const input = page.doc.querySelector('input[type="search"]') as El;
      input.value = "milk";
      page.doc.fire("input", input);
      expect(viewRead.signal.aborted).toBe(true);
    } finally {
      releaseRegionContent(page.region as never);
      page.restore();
    }
  });

  test("promoting a build's ending releases what it displaces and keeps what it promotes", () => {
    const registry = createRegionReleaseRegistry();
    const body = desk();
    const region = new Node("the window's content", WINDOW_CONTENT_REGION);
    const displaced = new Node("the capability the build displaced");
    const subscriber = new Node("the run's subscriber");
    const restored = new Node("the restored collection");
    const restoredRecords = new Node("the restored records", "records");
    body.append(region);
    region.append(displaced, subscriber);
    subscriber.append(restored);
    restored.append(restoredRecords);

    const released: string[] = [];
    registry.register(displaced, "records read", () => released.push("displaced read"));
    // Where htmx's settle got there before the stream closed, the restored View's read is already
    // in flight, so releasing the region wholesale leaves the restored collection empty.
    registry.register(restoredRecords, "records read", () => released.push("restored read"));

    const promoted = [...subscriber.children];
    region.append(...promoted);
    for (const node of [...region.children]) {
      if (promoted.includes(node)) continue;
      registry.releaseUnder(node);
      node.remove();
    }
    registry.sweep();

    expect(released).toEqual(["displaced read"]);
    expect(region.children).toEqual([restored]);
    expect(registry.report()).toEqual([{ region: "records", label: "records read" }]);
  });
});

/* ── every open is a fresh read ────────────────────────────────────────────── */

describe("every open is a fresh read", () => {
  test("a committed collection is served with no records in it", () => {
    // The chrome is data-free and its region loads through the capability's own `read` Handler,
    // so opening one cannot show a cached collection even when the caller has records to hand.
    const collection = renderCollection({
      capability: SAMPLE,
      loadThroughRead: true,
      items: "<article>a record somebody already had</article>",
    });
    const records = parseHtml(collection, new Doc()).querySelector(
      `#${capabilityRecordsRegionId(SAMPLE.id)}`,
    );
    expect(records?.getAttribute("hx-get")).toBe(capabilityActionUrl(SAMPLE.id, "read"));
    expect(records?.getAttribute("hx-trigger")).toBe("load");
    expect(records?.children).toHaveLength(0);
    expect(collection).not.toContain("a record somebody already had");
  });
});

/* ── and no machinery behind it ────────────────────────────────────────────── */

describe("no invalidation bus, version stamp or refresh control exists anywhere", () => {
  test("no capability surface offers a refresh control", () => {
    const surfaces = [
      renderCollection({ capability: SAMPLE, loadThroughRead: true }),
      renderCollection({ capability: SAMPLE, items: "<article>a record</article>" }),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toMatch(/>\s*(Refresh|Reload|Sync)\b/);
      expect(surface).not.toMatch(/aria-label="[^"]*(refresh|reload)/i);
    }
  });
});

/* ── the helper the policy's negative assertions rest on ─────────────────── */

describe("stripping a file's prose", () => {
  test("takes whole comments and leaves a URL inside a string alone", () => {
    expect(code('const a = 1; // gone\n  // gone too\nconst b = "https://kept/";')).toBe(
      'const a = 1; // gone\n\nconst b = "https://kept/";',
    );
    expect(code("/** gone\n * gone\n */\nconst c = 2;")).toBe("\nconst c = 2;");
  });
});
