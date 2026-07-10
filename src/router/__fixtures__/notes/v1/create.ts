// Hand-written fixture handler — Module 2, Epic 2.3 tracer bullet.
//
// A capability `create` action written by hand to the ADR-0004 contract, BEFORE
// any AI exists, to pin the whole runtime contract: registry -> router -> injected
// toolbox -> data table -> HTML fragment back. It honors the contract literally —
// no module imports, no raw HTTP, no table names. It receives only the platform-
// built context ({ input, data, present }), persists through the scoped data tool,
// and renders the inserted record through the capability's one item renderer.
// (Untyped on purpose: generated artifacts live
// outside the platform's type-check, exactly as the real builder's output will.)

export default async function create({ input, data, present }) {
  // Form values arrive as strings; the handler — which knows the spec — coerces
  // them. `text` is required; `pinned` is an optional boolean from a checkbox.
  const values = { text: input.text };
  if (input.pinned !== undefined) {
    values.pinned = input.pinned === "true" || input.pinned === "on";
  }

  const note = data.insert(values);
  return present(note);
}
