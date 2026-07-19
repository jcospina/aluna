// Hand-written fixture handler — the boom tracer's `search`. Throws to prove the router
// turns any handler failure into a warm product-voice fragment.

export default async function search() {
  throw new Error("Simulated crash: internal stack details that must never surface to the user.");
}
