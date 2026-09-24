// Hand-written fixture handler — the photos fixture's `update`. It patches the caption; what an
// edit may say about the photo is 7.1/05's.

export default async function update({ input, mutation, present }) {
  const patch = {};
  if ("caption" in input.values) patch.caption = input.values.caption;
  return present(mutation.update(patch));
}
