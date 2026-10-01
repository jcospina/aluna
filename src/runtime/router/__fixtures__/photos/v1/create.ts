// Hand-written fixture handler — the photos fixture's `create`, a capability with a photo field and,
// in the list suites, an album of several files.
//
// It hands each file back exactly as the router gave it, the projection `{ url, name, kind, mime,
// size }`, a list of them, or nothing, and the platform writes the files the save named. Untyped on
// purpose, like generated artifacts.

export default async function create({ input, mutation, present }) {
  const values = {};
  for (const field of input.submittedFields) values[field] = input.values[field];
  return present(mutation.create(values));
}
