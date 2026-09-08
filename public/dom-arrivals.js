// @ts-check

/**
 * Watching for controls that land in the tree without a landing announced.
 *
 * A cloned record view, a swapped region and an htmx fragment all put controls in the document
 * with no event of their own, so this is how the pickers and the long-text counters get mounted
 * at all. Both used to carry a verbatim copy.
 */

/**
 * Every element one batch of mutations put in the tree. Text and comment nodes are not asked
 * about: a control is an element.
 *
 * @param {readonly MutationRecord[]} records
 * @returns {Element[]}
 */
function addedElements(records) {
  /** @type {Element[]} */
  const added = [];
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) added.push(node);
    }
  }
  return added;
}

/**
 * @param {Document} root
 * @param {(nodes: readonly Element[]) => void} arrived
 */
export function watchArrivals(root, arrived) {
  const Observer = root.defaultView?.MutationObserver;
  if (!Observer) return;
  new Observer((records) => {
    const added = addedElements(records);
    if (added.length > 0) arrived(added);
  }).observe(root, { childList: true, subtree: true });
}
