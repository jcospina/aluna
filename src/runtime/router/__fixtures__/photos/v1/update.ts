// Hand-written fixture handler — the photos fixture's `update`. It patches what the edit submitted,
// handing the photo back exactly as the router gave it: the projection of what the save will
// store, or `null` for a field emptied or left empty.

export default async function update({ input, mutation, present }) {
  const patch = {};
  for (const field of ["caption", "photo"]) {
    if (input.submittedFields.has(field)) patch[field] = input.values[field];
  }
  return present(mutation.update(patch));
}
