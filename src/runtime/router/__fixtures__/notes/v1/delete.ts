// Hand-written fixture handler — the five-Action notes tracer's `delete`.
//
// Removes the bound record through the scoped delete mutation and returns a warm
// product-voice fragment. No imports, no raw HTTP; only the platform-built context.

export default async function remove({ mutation }) {
  mutation.delete();
  return '<p class="notice">That note is gone.</p>';
}
