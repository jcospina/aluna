import type { Context } from "hono";

/** An htmx request swaps part of a page that stays open, so it is never a page load. */
export function isInPageRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}
