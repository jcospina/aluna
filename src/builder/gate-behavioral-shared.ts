import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { selectCapabilityRows } from "../capability-data/index.ts";
import type { BehavioralErrorCase, SpecField } from "../registry/index.ts";
import { behavioralErrorMarkersSchema } from "../registry/index.ts";
import type { BehavioralScalar } from "./gate-behavioral-input.ts";
import { fieldValueMatches } from "./gate-internal.ts";
import type { HandlerUnitName } from "./units.ts";

export const nonEmptyStringSchema = z.string().min(1);
const behavioralScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export const behavioralFieldValueSchema = z.strictObject({
  field: nonEmptyStringSchema,
  value: behavioralScalarSchema,
});
export const behavioralInputValueSchema = z.strictObject({
  field: nonEmptyStringSchema,
  value: z.string(),
});
export const behavioralRowSchema = z.strictObject({
  values: z.array(behavioralFieldValueSchema),
});
export const behavioralExpectedErrorBaseSchema = z.strictObject({
  action: z.enum(["create", "read", "update", "delete", "search"]),
  trigger: nonEmptyStringSchema,
  code: nonEmptyStringSchema,
  fields: z.array(nonEmptyStringSchema),
  expected_markers: behavioralErrorMarkersSchema,
});
export type BehavioralExpectedErrorBase = z.infer<typeof behavioralExpectedErrorBaseSchema>;

export function ageSetupRows(
  database: Database,
  tableName: string,
  setupIds: readonly string[],
): void {
  const quoted = `"${tableName.replaceAll('"', '""')}"`;
  const update = database.query(`UPDATE ${quoted} SET "created_at" = ? WHERE "id" = ?`);
  const lastIndex = setupIds.length - 1;
  for (const [index, id] of setupIds.entries()) {
    const secondsFromOldest = lastIndex - index;
    update.run(`2000-01-01 00:00:${String(secondsFromOldest).padStart(2, "0")}`, id);
  }
}

export function assertKnownFields(
  testName: string,
  label: string,
  names: readonly string[],
  fields: ReadonlySet<string>,
): void {
  for (const name of names) {
    if (!fields.has(name)) {
      throw new Error(
        `Behavioral test "${testName}" ${label} references unknown spec field "${name}".`,
      );
    }
  }
}

export function assertFragmentIncludes(
  action: HandlerUnitName,
  fragment: string,
  expected: readonly string[],
): void {
  for (const text of expected) {
    if (!fragment.includes(text)) {
      throw new Error(`expected ${action} fragment to include ${JSON.stringify(text)}.`);
    }
  }
}

export function assertFragmentIncludesInOrder(fragment: string, expected: readonly string[]): void {
  let cursor = 0;
  for (const text of expected) {
    const index = fragment.indexOf(text, cursor);
    if (index === -1) {
      throw new Error(`expected read fragment to include ${JSON.stringify(text)} in order.`);
    }
    cursor = index + text.length;
  }
}

export function sameBehavioralError(
  specCase: BehavioralErrorCase,
  expected: BehavioralExpectedErrorBase,
): boolean {
  return (
    specCase.action === expected.action &&
    specCase.trigger === expected.trigger &&
    specCase.code === expected.code &&
    sameStringSet(specCase.fields, expected.fields) &&
    JSON.stringify(specCase.expected_markers) === JSON.stringify(expected.expected_markers)
  );
}

export function assertValidationErrorMarkers(
  fragment: string,
  expected: BehavioralExpectedErrorBase,
): void {
  const marker = expected.expected_markers;
  const elements = parseHtmlStartTagAttributes(fragment).filter(
    (attributes) => attributes[marker.role_attribute] === marker.role,
  );
  if (elements.length === 0) {
    throw new Error(
      `expected fragment to include an error element with ${marker.role_attribute}="${marker.role}".`,
    );
  }

  const actualSummary = elements.map((attributes) => ({
    code: attributes[marker.code_attribute],
    fields: attributes[marker.fields_attribute],
  }));
  const match = elements.find((attributes) => {
    const fields = splitErrorFields(attributes[marker.fields_attribute], marker.fields_separator);
    return (
      attributes[marker.code_attribute] === expected.code && sameStringSet(fields, expected.fields)
    );
  });
  if (!match) {
    throw new Error(
      `expected error markers code=${JSON.stringify(expected.code)} fields=${JSON.stringify(expected.fields)}, received ${JSON.stringify(actualSummary)}.`,
    );
  }
}

export function rowMatches(
  fields: readonly SpecField[],
  row: ReturnType<typeof selectCapabilityRows>[number],
  expected: Readonly<Record<string, BehavioralScalar>>,
): boolean {
  return Object.entries(expected).every(([field, value]) => {
    const type = fields.find((candidate) => candidate.name === field)?.type;
    return type ? fieldValueMatches(type, row[field], value) : row[field] === value;
  });
}

function parseHtmlStartTagAttributes(fragment: string): Array<Record<string, string>> {
  const elements: Array<Record<string, string>> = [];
  const tagPattern = /<[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?>/g;
  for (const [tag] of fragment.matchAll(tagPattern)) elements.push(parseAttributes(tag));
  return elements;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /\s([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1];
    if (name) attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function splitErrorFields(value: string | undefined, separator: string): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
