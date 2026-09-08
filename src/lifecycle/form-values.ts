/**
 * One value, or none. A repeated field is a submission these forms do not make, and taking the
 * first of several would let an injected duplicate decide which capability a write binds to. The
 * rule is a security property, so it is read from one place rather than re-derived per form.
 */
export function singleFormValue(
  form: { getAll(name: string): readonly unknown[] },
  name: string,
): string {
  const values = form.getAll(name);
  const only = values.length === 1 ? values[0] : undefined;
  return typeof only === "string" ? only : "";
}
