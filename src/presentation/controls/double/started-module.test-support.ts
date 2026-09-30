// A shell script started the way the page starts it: imported with a `document` standing, so it
// wires itself to that document. Each call is a fresh instance, and `document` is put back after.
// The shared instance is loaded first, with no `document`, so only the script itself starts: a
// module it imports would otherwise start itself on the double too.

let started = 0;

/** Import a fresh `public/<script>` with `document` set to `doc`, and hand back its exports. */
export async function startedOn<T = Record<string, unknown>>(
  script: string,
  doc: unknown,
): Promise<T> {
  await import(`../../../../public/${script}`);
  const before = Reflect.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true, writable: true });
  started += 1;
  try {
    return (await import(`../../../../public/${script}?started=${started}`)) as T;
  } finally {
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
  }
}
