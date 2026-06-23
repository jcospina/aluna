// Hand-written fixture handler — Module 2, Epic 2.3.
//
// A deliberately failing handler. It throws to prove the router turns *any* handler
// failure into a warm, product-voice fragment — never a stack trace or internals
// (acceptance criterion). The thrown message is intentionally internals-flavored;
// the test asserts none of it reaches the response body.

export default async function read() {
  throw new Error("Simulated crash: internal stack details that must never surface to the user.");
}
