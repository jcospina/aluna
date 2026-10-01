// Hand-written fixture handler — the photos fixture's `update`. It patches what the edit submitted,
// handing each file back exactly as the router gave it: the projection of what the save will store,
// a list of them, or `null` for a field emptied or left empty.

export default async function update({ input, mutation, present }) {
  const patch = {};
  for (const field of input.submittedFields) patch[field] = input.values[field];
  return present(mutation.update(patch));
}
