// Hand-written fixture handler — the boom tracer's `update`. Like its siblings it throws
// to prove the router turns any handler failure into a warm product-voice fragment.

export default async function update() {
  throw new Error("Simulated crash: internal stack details that must never surface to the user.");
}
