import { isAbsolute, relative, sep } from "node:path";

/**
 * Whether `target` sits under `root`. `relative()` rather than a `startsWith` on the joined
 * prefix: the string form is easy to get subtly wrong, and this is the check standing between a
 * generated path and a write outside the artifact tree.
 *
 * `allowRoot` is the one thing the two callers genuinely disagreed on. A snapshot may name its
 * own root; a deletion may not, because deleting the root would take every capability with it.
 */
export function isPathContained(
  root: string,
  target: string,
  options: { readonly allowRoot?: boolean } = {},
): boolean {
  const candidate = relative(root, target);
  if (candidate.length === 0) return options.allowRoot === true;
  return candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate);
}
