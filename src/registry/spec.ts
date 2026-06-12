// The capability spec shape (ARCH §2 "The generated
// artifacts", §6.3 "Capability Registry", ADR-0004).
//
// The spec is the structured object the AI authors and the platform derives
// everything else from — DDL, handlers, views, behavioral tests. It is the only
// artifact that cannot be reconstructed from something else (ARCH §2), so this
// shape is the single gate every generated spec must clear before anything
// downstream sees it. Validation is loud on purpose: a non-conforming spec
// throws here rather than flowing onward malformed (the spec-gen stage maps
// that throw onto the build's failure path).
//
// The pantry is deliberately tiny:
//
//   - Field types: `string | number | boolean | datetime`, each with `required`.
//     No list types, no `file`/`file[]`, no relations (never — no
//     foreign keys). Every object is strict, so any extra key — `auto`,
//     `references`, `added_in_version` — fails validation instead of slipping by.
//   - `ui_intent` speaks the two views (`list`, `create`); `tools` speaks the
//     two actions (`create`, `read`); `behavior` is free text the behavioral
//     tier generates tests from.
//   - The platform trio — `id`, `created_at`, `extra` — is platform-owned, never
//     a spec field. A spec naming one of them is rejected. This deviates from
//     ARCH §6.3's example (`created_at` with `auto`) deliberately:
//     making the trio platform-owned removes the `auto` concept entirely.

import { z } from "zod";

// Columns every capability data table gets from the platform, never from the
// spec: `id` (PK), `created_at` (uniform — pre-pays the
// NL→SQL catalog), `extra` (the JSON escape-hatch column, present from birth).
// Exported for the spec→DDL mapper, which emits them on every table.
export const PLATFORM_COLUMNS = ["id", "created_at", "extra"] as const;

// Capability ids and field names both end up inside SQL identifiers — the data
// table is `cap_<id>` and each field becomes a column — so both are
// confined to a shape that needs no quoting and can never smuggle SQL.
const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SQL_NAME_MESSAGE = "must be lowercase letters/digits/underscores, starting with a letter";

// Free-text values the platform displays or feeds to the model — blank strings
// are never meaningful, so they fail rather than propagate.
const nonBlankText = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "must not be blank");

// The complete field type enum. Anything else — `string[]`, `file`, a
// relation — is not a parse error to recover from but a spec the platform must
// refuse (list types and files are reserved for later).
export const fieldTypeSchema = z.enum(["string", "number", "boolean", "datetime"]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

// One user field: name, type, required — nothing else validates. Strictness is
// what rejects ARCH §6.3's `auto` example key, a deliberate deviation.
export const specFieldSchema = z.strictObject({
  name: z
    .string()
    .regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE)
    .refine(
      (name) => !(PLATFORM_COLUMNS as readonly string[]).includes(name),
      `is platform-owned (${PLATFORM_COLUMNS.join(", ")}) and cannot be a spec field`,
    ),
  type: fieldTypeSchema,
  required: z.boolean(),
});
export type SpecField = z.infer<typeof specFieldSchema>;

// The two views. The generated `list` view loads live data through `read`;
// `create` posts through `create` (ADR-0004: views are data-free).
export const specViewSchema = z.enum(["list", "create"]);
export type SpecView = z.infer<typeof specViewSchema>;

// The two actions, the values the router validates `/capability/:id/:action`
// against. `update`/`delete`/`search` arrive later.
export const capabilityToolSchema = z.enum(["create", "read"]);
export type CapabilityTool = z.infer<typeof capabilityToolSchema>;

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// The spec proper — everything the AI authors (ARCH §2: schema + ui_intent +
// behavior, plus the identity and resolver context the registry row carries,
// §6.3). `version` and `artifacts_path` are deliberately absent: the platform
// assigns those at commit, the AI never does.
const specShape = {
  // Engineering identity — becomes the `cap_<id>` table name and the artifacts
  // directory; never user-facing (CONTEXT.md "Engineering language").
  id: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  // User-facing name, shown in the capability toolbar.
  label: nonBlankText,
  schema: z.strictObject({
    fields: z
      .array(specFieldSchema)
      .min(1)
      .refine(
        (fields) => allUnique(fields.map((field) => field.name)),
        "field names must be unique",
      ),
  }),
  ui_intent: z.strictObject({
    views: z.array(specViewSchema).min(1).refine(allUnique, "views must be unique"),
  }),
  // Free text. The behavioral tier generates tests from this — from stated
  // intent, never from handler code (ARCH §2).
  behavior: nonBlankText,
  tools: z.array(capabilityToolSchema).min(1).refine(allUnique, "tools must be unique"),
  // What the intent resolver reads to understand this capability (ARCH §6.3).
  prompt_context: nonBlankText,
};

export const capabilitySpecSchema = z.strictObject(specShape);
export type CapabilitySpec = z.infer<typeof capabilitySpecSchema>;

// One registry row (ARCH §6.3): the spec plus the two platform-assigned values —
// `version` (bumped per regeneration; keys the derived-artifact caches) and
// `artifacts_path` (the version directory holding handlers and views). The row
// stays lean — spec + version + pointer — because the intent resolver scans
// every row on every classification; nothing bulky lives here.
export const capabilityRowSchema = z.strictObject({
  ...specShape,
  version: z.number().int().min(1),
  artifacts_path: nonBlankText,
});
export type CapabilityRow = z.infer<typeof capabilityRowSchema>;
