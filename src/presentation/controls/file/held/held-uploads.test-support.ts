// The upload request the product transfer opens, as a double a case answers by hand, and the
// page's removal observer, told by a case what the browser would tell it. Not a test file itself,
// so bun never runs it.

import { afterEach, beforeEach } from "bun:test";

/** One upload request: the route's admission is `admit`, and `aborted` says the page stopped it. */
export class UploadDouble {
  aborted = false;
  status = 0;
  responseText = "";
  private readonly listeners = new Map<string, (() => void)[]>();
  readonly upload = { addEventListener: () => {} };

  addEventListener(type: string, run: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]);
  }
  open(): void {}
  setRequestHeader(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true;
    this.fire("abort");
  }
  /** The route admits the file under `key`. */
  admit(key: string, name: string): void {
    this.status = 201;
    this.responseText = JSON.stringify({ key, url: `/files/${key}`, name, size: 10 });
    this.fire("load");
  }
  private fire(type: string): void {
    for (const run of this.listeners.get(type) ?? []) run();
  }
}

/**
 * Stand a removal observer up for every case of a suite, and hand back what tells it a node left
 * the document, the one thing the page's region scopes hear a removal by.
 */
export function installRemovalObserver(): (node: unknown) => void {
  let observers: ((records: { removedNodes: unknown[] }[]) => void)[] = [];
  const had = Reflect.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  beforeEach(() => {
    observers = [];
    class ObserverDouble {
      constructor(tell: (records: { removedNodes: unknown[] }[]) => void) {
        observers.push(tell);
      }
      observe() {}
    }
    Object.defineProperty(globalThis, "MutationObserver", {
      value: ObserverDouble,
      configurable: true,
    });
  });
  afterEach(() => {
    if (had) Object.defineProperty(globalThis, "MutationObserver", had);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
  });
  return (node) => {
    for (const tell of observers) tell([{ removedNodes: [node] }]);
  };
}
