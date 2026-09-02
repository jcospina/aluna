// The tree the release rule runs on, small enough to run in Bun.
//
// Shared rather than restated per suite: two doubles of the same thing drift, and a rule
// proved against a double that has quietly stopped resembling the DOM is proved against
// nothing.

/**
 * A node small enough to run the release rule in Bun. The rule needs three DOM facts and
 * no more — is this anchor still in the document, does that node hold it, and which
 * content region is it in — so this implements exactly those and the tree operations a
 * test performs on them.
 */
export class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  /** Only the document root sets this; everything else inherits by being under it. */
  rooted = false;

  constructor(
    readonly name: string,
    readonly region?: string,
  ) {}

  get isConnected(): boolean {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.rooted) return true;
    }
    return false;
  }

  contains(other: Node): boolean {
    for (let node: Node | null = other; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  closest(selector: string): Node | null {
    if (selector !== "[data-content-region]") throw new Error(`Unsupported: ${selector}`);
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.region !== undefined) return node;
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return name === "data-content-region" ? (this.region ?? null) : null;
  }

  /**
   * The two facts the transport abort reads off a node: whether this one is mid-request,
   * and which of its descendants are. `htmx-request` is the class htmx puts on an element
   * while its request is in flight, and the abort's rule is written against exactly these.
   */
  requesting = false;

  get classList(): { contains(name: string): boolean } {
    return { contains: (name: string) => name === "htmx-request" && this.requesting };
  }

  querySelectorAll(selector: string): Node[] {
    if (selector !== ".htmx-request") throw new Error(`Unsupported: ${selector}`);
    const found: Node[] = [];
    const walk = (node: Node) => {
      for (const child of node.children) {
        if (child.requesting) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  /** Appending moves, the way the DOM's does: a node has one parent. */
  append(...nodes: Node[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  /** What `innerHTML =` and `replaceChildren()` both are: this content, gone. */
  replaceChildren(...nodes: Node[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

/** A rooted tree, so `isConnected` has something to be true about. */
export function document(): Node {
  const root = new Node("body");
  root.rooted = true;
  return root;
}
