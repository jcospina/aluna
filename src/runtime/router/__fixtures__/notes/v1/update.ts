// Hand-written fixture handler — the five-Action notes tracer's `update`.
//
// Applies a partial patch: only the submitted fields change, so unsubmitted fields are
// preserved. Honors the ADR-0004 contract literally — no imports, no raw HTTP, only the
// platform-built context ({ input, mutation, present }). Untyped on purpose, like generated
// artifacts.

export default async function update({ input, mutation, present }) {
  const patch = {};
  if ("text" in input.values) patch.text = input.values.text;
  if (input.submittedFields.has("pinned")) {
    patch.pinned = input.values.pinned === "true" || input.values.pinned === "on";
  }
  return present(mutation.update(patch));
}
