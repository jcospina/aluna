// Hand-written fixture handler — the five-Action notes tracer's `search`.
//
// Deterministic normalized-substring matching over the active `text` field, AND across
// query terms. Empty/whitespace queries fall through to every row in read order. No
// imports, no raw HTTP, no mutation authority — only the platform-built context.

export default async function search({ input, query, present }) {
  const raw = input.values.q;
  const q = typeof raw === "string" ? raw : "";
  const terms = q.trim().split(/\s+/u).filter(Boolean);
  return query
    .records({
      sql: 'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT "target"."id" AS "target_id" FROM "cap_notes" AS "target" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE NOT ((coalesce(instr(platform_search_normalize("target"."text"), platform_search_normalize("search_term"."term")), 0) > 0))) ORDER BY "target"."created_at" DESC, "target"."id" DESC',
      parameters: [JSON.stringify(terms)],
    })
    .map(({ record }) => present(record))
    .join("");
}
