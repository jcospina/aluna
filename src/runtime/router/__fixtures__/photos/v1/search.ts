// Hand-written fixture handler — the photos fixture's `search`. A photo is never searched, so it
// matches on the caption alone.

export default async function search({ input, query, present }) {
  const q = typeof input.values.q === "string" ? input.values.q.trim() : "";
  return query
    .records({
      sql: 'SELECT "id" AS "target_id" FROM "cap_photos" WHERE instr(platform_search_normalize("caption"), platform_search_normalize(?)) > 0 ORDER BY "created_at" DESC, "id" DESC',
      parameters: [q],
    })
    .map(({ record }) => present(record))
    .join("");
}
