// The drawn photo control, `design/scripts/file-field.js`, mounted for real in the DOM double, so
// a product suite drives the markup it draws rather than a stand-in for it.

import { afterAll } from "bun:test";

import { mountFileFields, type Transfer } from "#design/file-field.js";
import type { Doc } from "./choice-picker.test-support.ts";

/** The selector for an element carrying the attribute hook `name`. */
export const hooked = (name: string) => `[${name}]`;

/** A transfer whose upload never settles: the field stays in flight until something stops it. */
export const travelling: Transfer = () => ({ done: new Promise(() => {}), abort: () => {} });

/** A transfer that refuses every pick with `error`, as the upload route refuses one. */
export const refusing =
  (error: Error): Transfer =>
  () => ({ done: Promise.reject(error), abort: () => {} });

/**
 * Mount every file field in `doc` over `transfer`. The control reads the page's `document`, so a
 * suite that mounts one has it for its own length and not after.
 */
export function drawnFileFields(): (doc: Doc, transfer: Transfer) => void {
  afterAll(() => Reflect.deleteProperty(globalThis, "document"));
  return (doc, transfer) => {
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    mountFileFields(doc as never, transfer);
  };
}
