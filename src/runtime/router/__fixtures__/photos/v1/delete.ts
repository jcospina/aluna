// Hand-written fixture handler — the photos fixture's `delete`.

export default async function remove({ mutation }) {
  mutation.delete();
  return '<p class="notice">That photo is gone.</p>';
}
