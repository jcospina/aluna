// The smallest desk a window's geometry and form actually touch, shared by the two suites that
// stand one up. Plain objects rather than a DOM: what is under test is arithmetic and marks.

/** A window's box, as the geometry passes one around. */
type Box = { x: number; y: number; w: number; h: number };

/** The box as it is written down: maximised is a flag, and the box to give back rides along. */
export type Stored = Box & { max?: boolean; restore?: Box };

/** The clamps read a `DOMRect`; width and height are all of one they touch. */
export const desk = (width: number, height: number) => ({ width, height }) as never;

/** An element, as much of one as the geometry and the form actually touch. */
export function fakeEl() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const bound: string[] = [];
  const children: unknown[] = [];
  const props = new Map<string, string>();
  return {
    classes,
    attrs,
    bound,
    children,
    props,
    classList: {
      add: (n: string) => classes.add(n),
      remove: (n: string) => classes.delete(n),
      contains: (n: string) => classes.has(n),
      toggle: (n: string, on: boolean) => (on ? classes.add(n) : classes.delete(n)),
    },
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    getAttribute: (n: string) => attrs.get(n) ?? null,
    toggleAttribute: (n: string, on: boolean) => (on ? attrs.set(n, "") : attrs.delete(n)),
    append: (c: unknown) => children.push(c),
    addEventListener: (t: string) => bound.push(t),
    style: { setProperty: (n: string, v: string) => props.set(n, v) },
    querySelector: () => null,
  };
}

/**
 * A window as `desk-stack.js` sees it: a slot and a focus mark, and the frame told about the
 * second. Shared because all three windows join the one stack, and three doubles for one typedef
 * is three chances to prove a rule against a window the product does not have.
 */
export function stackMember() {
  const marks = { focused: false, z: "" };
  return {
    marks,
    el: {
      classList: {
        toggle(name: string, on: boolean) {
          if (name === "is-focused") marks.focused = on;
        },
      },
      style: {
        setProperty(_: string, value: string) {
          marks.z = value;
        },
      },
    },
    win: { setFocused: () => {} },
  };
}
