// The window half of the DOM double's document: the viewport, computed styles, and the two observers
// a mounted control asks for. Kept apart from the tree in `choice-picker.test-support.ts`, which it
// reads through the few lists below, and generic over its node so it imports nothing back. Not a
// test file.

type Listener = (event: Record<string, unknown>) => void;

/** What the window reads and writes on the document it belongs to. */
export interface WindowedDoc<Node> {
  readonly watches: { target: Node; options: { childList?: boolean; subtree?: boolean } }[];
  readonly observers: ((records: { addedNodes: Node[] }[]) => void)[];
  readonly resizes: { target: Node; run: () => void }[];
  addEventListener(type: string, run: Listener): void;
}

/**
 * @param reset the prototype's own `reset`, which a control named `reset` cannot shadow and so is
 *   the one the platform calls
 */
export function windowOf<Node extends { computed: Record<string, string> }>(
  doc: WindowedDoc<Node>,
  reset: () => void,
) {
  return {
    innerWidth: 1200,
    innerHeight: 900,
    /**
     * Delivered on a microtask, as the browser delivers it. `observe` keeps its arguments: a
     * watch that is not `childList` hears nothing.
     */
    MutationObserver: class {
      constructor(private readonly run: (records: { addedNodes: Node[] }[]) => void) {}
      observe(target: Node, options: { childList?: boolean; subtree?: boolean } = {}): void {
        doc.watches.push({ target, options });
        if (options.childList === true && options.subtree === true) doc.observers.push(this.run);
      }
    },
    /**
     * A box watch. The browser fires on `observe` and again on every box change, including the
     * change from no box at all, which a control inside an unopened panel has.
     */
    ResizeObserver: class {
      constructor(private readonly run: () => void) {}
      observe(target: Node): void {
        doc.resizes.push({ target, run: this.run });
        this.run();
      }
      /** The half a watcher that is never released would never call. */
      disconnect(): void {
        for (let index = doc.resizes.length - 1; index >= 0; index -= 1) {
          if (doc.resizes[index]?.run === this.run) doc.resizes.splice(index, 1);
        }
      }
    },
    getComputedStyle: (node: Node) => ({ filter: "none", ...node.computed }),
    HTMLFormElement: { prototype: { reset } },
    addEventListener: (type: string, run: Listener) => {
      doc.addEventListener(type, run);
    },
  };
}
