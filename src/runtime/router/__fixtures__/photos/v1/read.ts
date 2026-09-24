// Hand-written fixture handler — the photos fixture's `read`. Every record through the read-only
// query port, newest first, each carrying its photo as the projection or `null`.

export default async function read({ query, present }) {
  return query
    .records({
      sql: 'SELECT "id" AS "target_id" FROM "cap_photos" ORDER BY "created_at" DESC, "id" DESC',
    })
    .map(({ record }) => present(record))
    .join("");
}
