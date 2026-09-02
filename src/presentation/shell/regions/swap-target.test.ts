import { describe, expect, test } from "bun:test";

import {
  findSwapListeners,
  GUARDED_SWAP_EVENTS,
  guardSwapTargets,
  MissingSwapTargetError,
  requireSwapTargets,
  type SwapTargetResolver,
  startSwapTargetGuard,
} from "#shell/swap-target.js";
import { renderBuildSubscriber } from "../../../server/http/fragments.ts";

/**
 * A node small enough to run the rule in Bun. The guard needs three DOM facts and no more
 * — is this target still in the document, what does a node carry on it, and which nodes
 * under a connection are swap listeners — so this implements exactly those plus the tree
 * operations a test performs on them.
 */
class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  /** Only the document root sets this; everything else inherits by being under it. */
  rooted = false;

  constructor(readonly attributes: Record<string, string> = {}) {}

  get isConnected(): boolean {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.rooted) return true;
    }
    return false;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  append(...nodes: Node[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  private *descendants(): Generator<Node> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector: string): Node[] {
    if (selector !== "[sse-swap], [data-sse-swap]") throw new Error(`Unsupported: ${selector}`);
    return [...this.descendants()].filter(
      (node) =>
        node.getAttribute("sse-swap") !== null || node.getAttribute("data-sse-swap") !== null,
    );
  }
}

/**
 * htmx's `getTarget` reduced to the two answers it gives here: whatever `hx-target` names
 * — inherited from the nearest ancestor that carries it, which is htmx's rule and the one
 * a plain `getAttribute` would miss — or the listener itself. The shipped guard borrows
 * the real function rather than this; the double exists so the rule around it can run.
 */
function resolveLikeHtmx(root: Node): SwapTargetResolver {
  return (candidate) => {
    for (let node: Node | null = candidate as Node; node; node = node.parent) {
      const selector = node.getAttribute("hx-target");
      if (selector === null) continue;
      const id = selector.slice(1);
      return [
        root,
        ...root.querySelectorAll("[sse-swap], [data-sse-swap]"),
        ...allUnder(root),
      ].find((candidate) => candidate.getAttribute("id") === id && candidate.isConnected);
    }
    return candidate;
  };
}

function allUnder(root: Node): Node[] {
  return root.children.flatMap((child) => [child, ...allUnder(child)]);
}

/** The shipped subscriber's shape: a connection with one listener per named event. */
function buildStream(): { document: Node; connection: Node; listeners: Record<string, Node> } {
  const document = new Node();
  document.rooted = true;
  const contentArea = new Node({ id: "spec-build-output" });
  const connection = new Node({ "sse-connect": "/build/job-1/stream" });
  const listeners: Record<string, Node> = {
    narration: new Node({ "sse-swap": "narration" }),
    fragment: new Node({ "sse-swap": "fragment" }),
    commit: new Node({ "sse-swap": "commit" }),
    "commit-preview": new Node({ "sse-swap": "commit-preview" }),
  };
  connection.append(...Object.values(listeners));
  contentArea.append(connection);
  document.append(contentArea);
  return { document, connection, listeners };
}

/**
 * What an `EventSource` does with a listener that throws: it **reports** the exception
 * rather than propagating it to whoever dispatched. The raise is loud — it reaches the
 * page's own error handler — but it aborts nothing, so a double that let the throw escape
 * `deliver` would be asserting a guarantee the browser never makes.
 */
class Source {
  readonly handlers = new Map<string, (() => void)[]>();
  readonly reported: unknown[] = [];

  addEventListener(type: string, listener: () => void): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(listener);
    this.handlers.set(type, existing);
  }

  deliver(type: string): void {
    for (const handler of this.handlers.get(type) ?? []) {
      try {
        handler();
      } catch (error) {
        this.reported.push(error);
      }
    }
  }
}

describe("the guarded swap events are ADR-0002's two", () => {
  test("commit and fragment, and the shipped subscriber carries a listener for each", () => {
    expect([...GUARDED_SWAP_EVENTS]).toEqual(["commit", "fragment"]);

    // The server side of the same contract: a subscriber that stopped naming one of these
    // would leave the guard watching for an event that can never arrive.
    const subscriber = renderBuildSubscriber("job-1");
    for (const event of GUARDED_SWAP_EVENTS) {
      expect(subscriber).toContain(`sse-swap="${event}"`);
    }
  });
});

describe("finding the named target", () => {
  test("a swap on screen finds its target — the listener itself when it names none", () => {
    const { document, connection, listeners } = buildStream();
    const resolve = resolveLikeHtmx(document);

    for (const event of GUARDED_SWAP_EVENTS) {
      expect(requireSwapTargets(connection, event, resolve)).toEqual([listeners[event] as Node]);
    }
  });

  test("hx-target is honoured where htmx reads it — including from an ancestor", () => {
    const document = new Node();
    document.rooted = true;
    const view = new Node({ id: "window-content" });
    // The window's own content, addressed by the stable id ADR-0002 keeps. The connection
    // carries `hx-target`; the listener under it inherits it, the way htmx resolves.
    const connection = new Node({
      "sse-connect": "/build/job-1/stream",
      "hx-target": "#window-content",
    });
    connection.append(new Node({ "sse-swap": "commit" }));
    document.append(view, connection);
    const resolve = resolveLikeHtmx(document);

    expect(requireSwapTargets(connection, "commit", resolve)).toEqual([view]);

    // The window is put away while the build is still streaming.
    view.remove();
    expect(() => requireSwapTargets(connection, "commit", resolve)).toThrow(MissingSwapTargetError);
  });

  test("a listener answers only for the exact name, never a name it is a prefix of", () => {
    const { connection, listeners } = buildStream();

    expect(findSwapListeners(connection, "commit")).toEqual([listeners.commit as Node]);
    expect(findSwapListeners(connection, "commit-preview")).toEqual([
      listeners["commit-preview"] as Node,
    ]);
  });

  test("a comma-separated sse-swap list answers for every name in it", () => {
    const document = new Node();
    document.rooted = true;
    const connection = new Node({ "sse-connect": "/build/job-1/stream" });
    const listener = new Node({ "sse-swap": "commit, fragment" });
    connection.append(listener);
    document.append(connection);
    const resolve = resolveLikeHtmx(document);

    expect(requireSwapTargets(connection, "commit", resolve)).toEqual([listener]);
    expect(requireSwapTargets(connection, "fragment", resolve)).toEqual([listener]);
  });

  test("the connection element is a listener too, and so is every one under it", () => {
    // htmx registers a connection that carries `sse-swap` itself — the likely shape once
    // page assembly collapses to one anchor — and it registers every descendant. A guard
    // that checked one of them would leave the others silent.
    const document = new Node();
    document.rooted = true;
    const connection = new Node({ "sse-connect": "/build/job-1/stream", "sse-swap": "commit" });
    const nested = new Node({ "sse-swap": "commit" });
    connection.append(nested);
    document.append(connection);

    expect(findSwapListeners(connection, "commit")).toEqual([connection, nested]);

    nested.remove();
    expect(() => requireSwapTargets(connection, "commit", () => nested)).toThrow(
      MissingSwapTargetError,
    );
  });
});

describe("a swap arriving mid-teardown raises", () => {
  test("the listener node has left the document", () => {
    const { document, connection, listeners } = buildStream();
    const resolve = resolveLikeHtmx(document);
    // The region goes away with the build still streaming — exactly the moment htmx's
    // extension unregisters the listener and says nothing.
    connection.parent?.remove();

    for (const event of GUARDED_SWAP_EVENTS) {
      expect(() => requireSwapTargets(connection, event, resolve)).toThrow(MissingSwapTargetError);
      expect(() => requireSwapTargets(connection, event, resolve)).toThrow(/left the document/i);
    }
    expect(listeners.commit?.isConnected).toBe(false);
  });

  test("the connection carries no listener for the event at all", () => {
    const { document, connection, listeners } = buildStream();
    listeners.commit?.remove();

    expect(() => requireSwapTargets(connection, "commit", resolveLikeHtmx(document))).toThrow(
      /no listener/i,
    );
  });
});

describe("the guard on a live connection", () => {
  test("a delivered commit or fragment with its target present completes quietly", () => {
    const { document, connection } = buildStream();
    const source = new Source();
    guardSwapTargets(connection, source, resolveLikeHtmx(document));

    for (const event of GUARDED_SWAP_EVENTS) source.deliver(event);
    expect(source.reported).toEqual([]);
  });

  test("neither path can complete silently once the region has gone", () => {
    const { document, connection } = buildStream();
    const source = new Source();
    guardSwapTargets(connection, source, resolveLikeHtmx(document));
    connection.parent?.remove();

    expect([...source.handlers.keys()]).toEqual([...GUARDED_SWAP_EVENTS]);
    for (const event of GUARDED_SWAP_EVENTS) source.deliver(event);
    expect(source.reported).toHaveLength(GUARDED_SWAP_EVENTS.length);
    for (const error of source.reported) expect(error).toBeInstanceOf(MissingSwapTargetError);
  });
});

/**
 * The wiring, which is the half with real coupling to htmx: the event name, where the
 * connection comes from, and where the source comes from. An htmx upgrade that moved
 * `source` to another key on the detail would otherwise disable the whole guard under a
 * green suite.
 */
describe("starting the guard on the shell", () => {
  class DocumentDouble {
    readonly listeners = new Map<string, ((event: unknown) => void)[]>();

    addEventListener(type: string, listener: (event: unknown) => void): void {
      const existing = this.listeners.get(type) ?? [];
      existing.push(listener);
      this.listeners.set(type, existing);
    }

    open(connection: Node, source: Source): void {
      for (const listener of this.listeners.get("htmx:sseOpen") ?? []) {
        listener({ target: connection, detail: { source } });
      }
    }
  }

  function started(): { root: DocumentDouble; connection: Node } {
    const stream = buildStream();
    const root = new DocumentDouble();
    // The resolver is injected here for the same reason the shipped one is borrowed from
    // htmx: this file is about the wiring, not about reproducing htmx's target rules.
    startSwapTargetGuard(root as unknown as Parameters<typeof startSwapTargetGuard>[0], () =>
      resolveLikeHtmx(stream.document),
    );
    return { root, connection: stream.connection };
  }

  test("htmx:sseOpen is what the guard listens for", () => {
    const { root } = started();

    expect([...root.listeners.keys()]).toEqual(["htmx:sseOpen"]);
  });

  test("an opened connection is guarded on the source the event carries", () => {
    const { root, connection } = started();
    const source = new Source();
    root.open(connection, source);

    expect([...source.handlers.keys()]).toEqual([...GUARDED_SWAP_EVENTS]);
  });

  test("a repeated open on the same source does not double-register", () => {
    const { root, connection } = started();
    const source = new Source();
    root.open(connection, source);
    root.open(connection, source);

    expect(source.handlers.get("commit")).toHaveLength(1);
  });

  test("a reconnect's fresh source is guarded in its own right", () => {
    const { root, connection } = started();
    const reconnected = new Source();
    root.open(connection, new Source());
    root.open(connection, reconnected);

    expect([...reconnected.handlers.keys()]).toEqual([...GUARDED_SWAP_EVENTS]);
  });

  test("an open carrying no usable source guards nothing rather than throwing", () => {
    const { root, connection } = started();

    expect(() => root.open(connection, undefined as unknown as Source)).not.toThrow();
  });

  test("the guard it installs is the real one — a torn-down region still raises", () => {
    const { root, connection } = started();
    const source = new Source();
    root.open(connection, source);
    connection.parent?.remove();

    source.deliver("commit");
    expect(source.reported[0]).toBeInstanceOf(MissingSwapTargetError);
  });
});
