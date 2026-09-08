// Hand-written fixture handler.3 tracer bullet.
//
// The `read` half of the notes fixture: it pulls live rows through the physically
// read-only query port and renders every row through the injected presentation adapter.
// Like its sibling it honors the ADR-0004 contract literally — no module imports,
// no raw HTTP or mutation authority — and receives only the platform-built context. (Untyped on purpose:
// generated artifacts live outside the platform's type-check.)

export default async function read({ query, present }) {
  const notes = query.records({
    sql: 'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC',
  });
  if (notes.length === 0) {
    // Return nothing so the region stays `:empty` and the platform empty state shows. A handler's
    // own empty-state markup would defeat it and linger below the first record create prepends.
    return "";
  }

  return notes.map(({ record }) => present(record)).join("");
}
