// Hand-written fixture handler — Module 2, Epic 2.3 tracer bullet.
//
// A capability `create` action written by hand to the ADR-0004 contract, BEFORE
// any AI exists, to pin the whole runtime contract: registry -> router -> injected
// toolbox -> data table -> HTML fragment back. It honors the contract literally —
// no module imports, no raw HTTP, no mutation SQL. It receives only the platform-
// built context ({ input, mutation, query, present }), persists through scoped mutation,
// and renders the inserted record through the capability's one item renderer.
// (Untyped on purpose: generated artifacts live
// outside the platform's type-check, exactly as the real builder's output will.)

export default async function create({ input, mutation, present }) {
  // Form values arrive as strings; the handler — which knows the spec — coerces
  // them. `text` is required; `pinned` is an optional boolean from a checkbox.
  const text = input.values.text;
  const pinned = input.values.pinned;
  const values = {
    text,
    pinned: input.submittedFields.has("pinned") && (pinned === "true" || pinned === "on"),
  };

  const note = mutation.create(values);
  return present(note);
}
