// A form's named properties, as the browser gives them: HTMLFormElement is
// `[LegacyOverrideBuiltIns]`, so a control named `reset` or `dataset` is what `form.reset` and
// `form.dataset` answer, ahead of the element's own. Field names are the person's to choose, so a
// script that reads a property off a form holding their fields reads whatever they named.

/** The elements a form lists as its controls, which are the ones its named properties answer. */
export const LISTED_ELEMENTS = new Set([
  "button",
  "fieldset",
  "input",
  "object",
  "output",
  "select",
  "textarea",
]);

interface FormNode {
  readonly tag: string;
  getAttribute(name: string): string | null;
  descendants(): Iterable<FormNode>;
}

/** The controls answering to `key` by name or id: one element, or a list when several do. */
function namedControls<T extends FormNode>(form: T, key: string): T | T[] | undefined {
  const hits: T[] = [];
  for (const node of form.descendants()) {
    if (!LISTED_ELEMENTS.has(node.tag)) continue;
    if (node.getAttribute("name") === key || node.getAttribute("id") === key) hits.push(node as T);
  }
  return hits.length > 1 ? hits : hits[0];
}

/** `form.elements`: the listed controls, with `namedItem` over them as the collection has it. */
export function formElements<T extends FormNode>(form: T) {
  const listed = [...form.descendants()].filter((node) => LISTED_ELEMENTS.has(node.tag)) as T[];
  return Object.assign(listed, {
    namedItem: (name: string) =>
      listed.find(
        (node) => node.getAttribute("name") === name || node.getAttribute("id") === name,
      ) ?? null,
  });
}

/**
 * `form` with its controls' names in front of its own properties. `own` is what the double reads
 * off itself to work at all; a browser has no such names, so none of them is a DOM property a
 * shipped script could be reading. Assigning over a named property throws, as strict code does.
 */
export function withNamedAccess<T extends FormNode>(form: T, own: ReadonlySet<string>): T {
  const shadowing = (key: string | symbol) =>
    typeof key === "string" && !own.has(key) ? namedControls(form, key) : undefined;
  return new Proxy(form, {
    get(target, key, receiver) {
      return shadowing(key) ?? Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (shadowing(key) !== undefined) {
        throw new TypeError(`Cannot assign to read only property '${String(key)}' of form`);
      }
      return Reflect.set(target, key, value, receiver);
    },
  });
}
