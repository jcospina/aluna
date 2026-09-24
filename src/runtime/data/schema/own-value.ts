// A submission's own value for a field. A field may be named `constructor`, which every plain
// object inherits, so an indexed read of one that was left out answers with `Object`.

export function ownValue(values: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}
