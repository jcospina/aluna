// The ink system's surface, declared for the platform's TypeScript.
//
// `ink.js` is browser code type-checked in place by `tsconfig.browser.json`
// (`// @ts-check` + JSDoc). The server-side config compiles `src` alone and does not
// read JavaScript, so a test that exercises the runtime needs this — the same
// arrangement `public/*.d.ts` already uses for the shell's browser modules.

/** Every boundary the design system draws, as one selector list. */
export const INK_SELECTOR: string;

/** Draw one more thing. Additive, idempotent per selector, before `startInk`. */
export function drawAlso(selector: string): void;

/** Mount one element: two SVG layers, a seed, and a place in its container's watch. */
export function mountInk(el: HTMLElement): void;

/** Take the layers back off, and release the container if it was the last child. */
export function unmountInk(el: HTMLElement): void;

/** Mount `root` and everything under it that asks to be drawn. */
export function mountAllInk(root?: Document | Element): void;

/** Start the system: mount what is there, then watch for what arrives. */
export function startInk(root?: Element): void;

/** Redraw every drawn element without changing whose hand drew it. */
export function redrawInk(root?: Document | Element): void;

/** Re-ink every drawn element with a fresh hand. */
export function reseedInk(root?: Document | Element): void;
