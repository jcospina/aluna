/**
 * Quote a SQL identifier (table or column name) for interpolation. An embedded `"` is doubled,
 * per SQLite's quoting rules, so a crafted name closes no identifier and starts no clause.
 *
 * Spec validation already holds every generated name to `SQL_NAME_PATTERN`, so a quote cannot
 * reach here today. That is a second line, not this one: the escape is what makes interpolation
 * safe on its own terms, and it is the only version of this function the platform has.
 */
export function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
