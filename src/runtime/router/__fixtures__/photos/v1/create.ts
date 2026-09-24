// Hand-written fixture handler — the photos fixture's `create`, a capability with one photo field.
//
// It hands the photo back exactly as the router gave it, the projection `{ url, name, kind, mime,
// size }` or nothing, and the platform writes the file the save named. Untyped on purpose, like
// generated artifacts.

export default async function create({ input, mutation, present }) {
  return present(mutation.create({ caption: input.values.caption, photo: input.values.photo }));
}
