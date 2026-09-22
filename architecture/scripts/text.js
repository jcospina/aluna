// The two shared bits of wording: the six generated units the Diff matrix names, and the
// comma-and-`and` joiner every bench uses to read a set out as a phrase.

export const UNITS = ["create", "read", "update", "delete", "search", "item"];
/** @type {Record<string, string>} */
const UNIT_LABEL = { item: "the item renderer" };

/** @param {string} unit */
export const label = (unit) => UNIT_LABEL[unit] ?? unit;

/** @param {readonly string[]} values */
export const list = (values) => {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
};
