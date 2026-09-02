// Frozen adversarial search data and assertions for the always-on Gate smoke.
// These cases are platform-owned: Handler repair reruns this exact fixture and can
// never regenerate or weaken its expected match sets.

// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the schema-adaptive fixture remains one frozen contract.

import type { Database } from "bun:sqlite";
import {
  activeSpecFields,
  type CapabilitySpec,
  choiceFieldOptions,
  isChoiceFieldType,
  isListFieldType,
  type SpecField,
  selectableChoiceValues,
} from "../../../../registry/index.ts";
import {
  type CapabilityActionRecord,
  type CapabilityDataRow,
  encodeCapabilityFieldForStorage,
} from "../../../../runtime/data/index.ts";
import type { CapabilityInput, CapabilityReadHandler } from "../../../../runtime/router/index.ts";
import type { ScratchCatalogCapability } from "../../gate.ts";
import { buildGateQueryPort, sqlIdentifier } from "../../gate-internal.ts";
import { SmokeActionFailure } from "./gate-smoke-repair.ts";

export interface RecordingPresentation {
  readonly present: (record: CapabilityActionRecord) => string;
  readonly clear: () => void;
  readonly rows: () => readonly CapabilityDataRow[];
  readonly fragments: () => readonly string[];
}

export interface SearchBaselineInput {
  readonly spec: CapabilitySpec;
  readonly tableName: string;
  readonly readwrite: Database;
  readonly readonly: Database;
  readonly scratchCatalog?: readonly ScratchCatalogCapability[];
  readonly read: CapabilityReadHandler;
  readonly search: CapabilityReadHandler;
  readonly recorder: RecordingPresentation;
  readonly updatedField: SpecField;
  readonly updatedId: string;
}

interface SearchFixtureCase {
  readonly label: string;
  readonly q: string;
  readonly expectedIds: readonly string[];
  readonly ordering?: "ranking-neutral-tie";
}

interface SearchFixture {
  readonly cases: readonly SearchFixtureCase[];
}

interface FixtureRow {
  readonly id: string;
  readonly createdAt: string;
  readonly extra: string;
  readonly values: Record<string, unknown>;
}

interface FixtureState {
  readonly spec: CapabilitySpec;
  readonly rows: FixtureRow[];
  readonly cases: SearchFixtureCase[];
  readonly row: (id: string, createdAt?: string) => FixtureRow;
}

type TextLocation = { readonly field: SpecField; readonly kind: "scalar" | "list" };

/** Seed the complete applicable fixture and assert every runtime search contract. */
export async function runAdversarialSearchBaseline(input: SearchBaselineInput): Promise<number> {
  const fixture = seedAdversarialSearchFixture(input);
  const readRows = await invokeRecordHandler(
    "read",
    input.read,
    emptyInput(),
    input.recorder,
    buildGateQueryPort(input.spec, "read", input.scratchCatalog, input.readonly),
  );
  try {
    assertIdsEqual(
      "read default order",
      readRows.map((row) => row.id),
      rawDefaultOrder(input.tableName, input.readwrite),
    );
  } catch (error) {
    throw new SmokeActionFailure(
      "read",
      error instanceof Error ? error.message : String(error),
      error,
    );
  }

  for (const searchCase of fixture.cases) {
    const observed = await invokeRecordHandler(
      "search",
      input.search,
      searchInput(searchCase.q),
      input.recorder,
      buildGateQueryPort(input.spec, "search", input.scratchCatalog, input.readonly),
    );
    const observedIds = observed.map((row) => row.id);
    if (searchCase.ordering === "ranking-neutral-tie") {
      assertIdsEqual(searchCase.label, observedIds, searchCase.expectedIds);
    } else {
      assertSameIdSet(searchCase.label, observedIds, searchCase.expectedIds);
    }
    assertRowsComplete(input.spec, observed);
  }

  for (const q of [undefined, "", "\u00A0\u1680\u2003\u202F\u205F\u3000\t\n"] as const) {
    const observed = await invokeRecordHandler(
      "search",
      input.search,
      searchInput(q),
      input.recorder,
      buildGateQueryPort(input.spec, "search", input.scratchCatalog, input.readonly),
    );
    assertIdsEqual(
      `search ${q === undefined ? "missing" : JSON.stringify(q)} equals read`,
      observed.map((row) => row.id),
      readRows.map((row) => row.id),
    );
  }
  return fixture.cases.length + 3;
}

function seedAdversarialSearchFixture(input: SearchBaselineInput): SearchFixture {
  const state = createFixtureState(input.spec);
  const scalar = activeSpecFields(input.spec.schema.fields).filter(
    (field) => field.type === "string",
  );
  const lists = activeSpecFields(input.spec.schema.fields).filter(
    (field) => field.type === "string[]",
  );
  const locations = textLocations(scalar, lists);

  if (locations.length > 0) {
    const first = locations[0];
    if (!first) throw new Error("search fixture lost its first text location");
    const second =
      locations.find((candidate) => candidate.field.name !== first.field.name) ?? first;
    addUpdatedCase(state, input.updatedField, input.updatedId);
    addInclusionCases(state, scalar, lists);
    addCrossFieldCase(state, first, second);
    addLiteralCases(state, first);
    addLatinCases(state, first);
    addNonLatinMarkCases(state, first);
    addDuplicateCase(state, first, second);
  }

  addExclusionCases(state);
  addBehaviorNeutralOrderRows(state, locations[0]);
  for (const row of state.rows) insertFixtureRow(input.spec, input.tableName, row, input.readwrite);
  return { cases: state.cases };
}

function createFixtureState(spec: CapabilitySpec): FixtureState {
  let sequence = 0;
  return {
    spec,
    rows: [],
    cases: [],
    row(id, createdAt) {
      const current = sequence;
      sequence += 1;
      return {
        id,
        createdAt:
          createdAt ??
          `203${Math.min(current, 9)}-01-01T00:00:${String(current).padStart(2, "0")}.000Z`,
        extra: '{"fixture":"neutral"}',
        values: Object.fromEntries(
          spec.schema.fields.map((field, index) => [
            field.name,
            fixtureFieldValue(field, index + current + 1),
          ]),
        ),
      };
    },
  };
}

function textLocations(scalar: readonly SpecField[], lists: readonly SpecField[]): TextLocation[] {
  return [
    ...scalar.map((field) => ({ field, kind: "scalar" as const })),
    ...lists.map((field) => ({ field, kind: "list" as const })),
  ];
}

function addUpdatedCase(state: FixtureState, field: SpecField, updatedId: string): void {
  if (field.type !== "string" && field.type !== "string[]") return;
  state.cases.push({
    label: "updated record remains searchable in the CRUD cycle",
    q: "gate\u2003update",
    expectedIds: [updatedId],
  });
}

function addInclusionCases(
  state: FixtureState,
  scalar: readonly SpecField[],
  lists: readonly SpecField[],
): void {
  scalar.forEach((scalarField, index) => {
    const needle = `scalar${index}needle`;
    const row = state.row(`search_scalar_inclusion_${index}`);
    setText(row, { field: scalarField, kind: "scalar" }, `SCALÁR${index}NEEDLE`);
    state.rows.push(row);
    state.cases.push({
      label: `active scalar inclusion: ${scalarField.name}`,
      q: needle,
      expectedIds: [row.id],
    });
  });

  lists.forEach((listField, index) => {
    const firstNeedle = `list${index}firstneedle`;
    const secondNeedle = `list${index}secondneedle`;
    const row = state.row(`search_list_inclusion_${index}`);
    setText(row, { field: listField, kind: "list" }, [
      `LÍST${index}FIRSTNEEDLE`,
      `LIST${index}SECO\u0301NDNEEDLE`,
    ]);
    state.rows.push(row);
    state.cases.push(
      {
        label: `active list first-element inclusion: ${listField.name}`,
        q: firstNeedle,
        expectedIds: [row.id],
      },
      {
        label: `active list later-element inclusion: ${listField.name}`,
        q: secondNeedle,
        expectedIds: [row.id],
      },
    );
  });
}

function addCrossFieldCase(state: FixtureState, first: TextLocation, second: TextLocation): void {
  const cross = state.row("search_cross_field_and");
  const alphaOnly = state.row("search_cross_alpha_only");
  const betaOnly = state.row("search_cross_beta_only");
  if (first.field.name === second.field.name) {
    setText(
      cross,
      first,
      first.kind === "list" ? ["crossalpha", "crossbeta"] : "crossalpha crossbeta",
    );
  } else {
    setText(cross, first, "crossalpha");
    setText(cross, second, "crossbeta");
  }
  setText(alphaOnly, first, "crossalpha");
  setText(betaOnly, second, "crossbeta");
  state.rows.push(cross, alphaOnly, betaOnly);
  state.cases.push({
    label: "AND semantics across fields with repeated Unicode whitespace",
    q: "crossalpha\u00A0\u1680\u2003\u2009\u202F\u205F\u3000crossbeta",
    expectedIds: [cross.id],
  });
}

function addLiteralCases(state: FixtureState, location: TextLocation): void {
  const row = state.row("search_literal_metacharacters");
  setText(row, location, "percent% underscore_ apostrophe'o double\"quote");
  state.rows.push(row);
  for (const q of ["percent%", "underscore_", "apostrophe'o", 'double"quote']) {
    state.cases.push({ label: `literal ${q}`, q, expectedIds: [row.id] });
  }
}

function addLatinCases(state: FixtureState, location: TextLocation): void {
  const composed = state.row("search_latin_composed");
  const decomposed = state.row("search_latin_decomposed");
  setText(composed, location, "CAFÉ ÅNGSTRÖM");
  setText(decomposed, location, "Cafe\u0301 A\u030Angstro\u0308m");
  state.rows.push(composed, decomposed);
  state.cases.push(
    {
      label: "Latin accent and case folding",
      q: "cafe",
      expectedIds: [composed.id, decomposed.id],
    },
    {
      label: "composed and decomposed Latin equivalence",
      q: "ÅNGSTRÖM",
      expectedIds: [composed.id, decomposed.id],
    },
  );
}

function addNonLatinMarkCases(state: FixtureState, location: TextLocation): void {
  const plain = state.row("search_non_latin_plain");
  const marked = state.row("search_non_latin_marked");
  setText(plain, location, "は क กา");
  setText(marked, location, "ば कि ก่า");
  state.rows.push(plain, marked);
  state.cases.push(
    { label: "Japanese voicing mark is preserved", q: "ば", expectedIds: [marked.id] },
    { label: "Indic vowel mark is preserved", q: "कि", expectedIds: [marked.id] },
    { label: "Thai tone mark is preserved", q: "ก่า", expectedIds: [marked.id] },
  );
}

function addDuplicateCase(state: FixtureState, first: TextLocation, second: TextLocation): void {
  const row = state.row("search_duplicate_suppression");
  setText(
    row,
    first,
    first.kind === "list"
      ? ["duplicateneedle", "duplicateneedle"]
      : "duplicateneedle duplicateneedle",
  );
  if (second.field.name !== first.field.name) setText(row, second, "duplicateneedle");
  state.rows.push(row);
  state.cases.push({ label: "duplicate suppression", q: "duplicateneedle", expectedIds: [row.id] });
}

function addExclusionCases(state: FixtureState): void {
  const excluded = state.row("platformidonly", "2042-02-03T04:05:06.000Z");
  const inactiveText = state.spec.schema.fields.filter(
    (field) =>
      field.lifecycle === "inactive" && (field.type === "string" || field.type === "string[]"),
  );
  for (const field of inactiveText) {
    excluded.values[field.name] = field.type === "string[]" ? ["inactiveonly"] : "inactiveonly";
  }
  // "Non-text" here means "content a query can never match", which is what makes an
  // exclusion assertion honest. A choice is searchable text — it stores a string in a TEXT
  // column — so it is not one of these, and keeps the ordinary rotating fixture value.
  const nonText = activeSpecFields(state.spec.schema.fields).filter(
    (field) => !isSearchableTextType(field.type),
  );
  for (const field of nonText) excluded.values[field.name] = excludedNonTextValue(field);
  state.rows.push({ ...excluded, extra: '{"hidden":"extraonly"}' });
  state.cases.push(
    { label: "platform id exclusion", q: "platformidonly", expectedIds: [] },
    {
      label: "platform created_at exclusion",
      q: "2042-02-03T04:05:06.000Z",
      expectedIds: [],
    },
    { label: "extra exclusion", q: "extraonly", expectedIds: [] },
  );
  if (inactiveText.length > 0) {
    state.cases.push({ label: "inactive text exclusion", q: "inactiveonly", expectedIds: [] });
  }
  addNonTextExclusionCases(state, nonText);
}

/** One exclusion case per non-searchable type present, each keyed to its fixture value. */
const NON_TEXT_EXCLUSIONS = [
  { type: "number", label: "number exclusion", q: "8675309" },
  { type: "boolean", label: "boolean exclusion", q: "true" },
  { type: "date", label: "date exclusion", q: "2042-02-03" },
  { type: "datetime", label: "datetime exclusion", q: "2042-02-03T04:05:06.000Z" },
] as const;

function addNonTextExclusionCases(state: FixtureState, nonText: readonly SpecField[]): void {
  const matchable = declaredChoiceValues(state.spec);
  for (const exclusion of NON_TEXT_EXCLUSIONS) {
    const present = nonText.some((field) => field.type === exclusion.type);
    if (!present || matchable.has(exclusion.q)) continue;
    state.cases.push({ label: exclusion.label, q: exclusion.q, expectedIds: [] });
  }
}

/**
 * Every value an active choice field may hold. An exclusion case asserts an empty result
 * set for a fixed token, and a choice column is searchable, so a capability that happened
 * to declare an option equal to one of those tokens would make that assertion false about
 * a correct Handler. The fixture drops the case rather than freezing a wrong expectation
 * the repair loop is not allowed to weaken.
 */
function declaredChoiceValues(spec: CapabilitySpec): ReadonlySet<string> {
  const values = new Set<string>();
  for (const field of activeSpecFields(spec.schema.fields)) {
    if (!isChoiceFieldType(field.type)) continue;
    // Every declared value, disabled ones included: what this guards is a search token
    // colliding with something a stored row might hold, and a retired option is still
    // exactly that.
    for (const option of choiceFieldOptions(field)) values.add(option.value);
  }
  return values;
}

function addBehaviorNeutralOrderRows(
  state: FixtureState,
  location: TextLocation | undefined,
): void {
  if (!location) return;
  // These rows have identical active values and share a creation time. Authored
  // ranking therefore ties without interpreting free-text behavior; the platform's
  // deterministic id-desc fallback remains independently provable.
  const tiedC = state.row("search_order_c", "2038-08-08T08:08:08.000Z");
  setText(tiedC, location, "stabledefaultordering");
  const tiedA = state.row("search_order_a", "2038-08-08T08:08:08.000Z");
  const tiedB = state.row("search_order_b", "2038-08-08T08:08:08.000Z");
  Object.assign(tiedA.values, structuredClone(tiedC.values));
  Object.assign(tiedB.values, structuredClone(tiedC.values));
  state.rows.push(tiedC, tiedA, tiedB);
  state.cases.push({
    label: "deterministic ranking-neutral tie fallback",
    q: "stabledefaultordering",
    expectedIds: [tiedC.id, tiedB.id, tiedA.id],
    ordering: "ranking-neutral-tie",
  });
}

/**
 * One neutral fixture value per pantry type. The return type is deliberately concrete
 * rather than `unknown`: a `switch` with no `default` and a narrow return is what makes
 * the compiler refuse a new field type until it has a fixture value of its own.
 */
export function fixtureFieldValue(
  field: SpecField,
  seed: number,
): string | number | boolean | readonly string[] | null {
  switch (field.type) {
    case "string":
      return `neutral${seed}`;
    case "choice": {
      // A choice can only ever hold a value it declares, so the fixture rotates through
      // the options instead of manufacturing neutral text the way it can for a free
      // string — and only through the ones still on offer. Not because anything stops it:
      // these rows are inserted directly, and the storage encoder checks the *admitted*
      // set, which a retired option is still in. Because a corpus is meant to be one a
      // person could have produced, and nobody can produce a row on a retired option.
      const options = [...selectableChoiceValues(field)];
      return options[seed % options.length] ?? null;
    }
    case "string[]":
      return [`neutral${seed}a`, `neutral${seed}b`];
    case "number":
      return seed + 0.5;
    case "boolean":
      return false;
    case "date":
      return `2025-01-${String((seed % 27) + 1).padStart(2, "0")}`;
    case "datetime":
      return `2025-01-${String((seed % 27) + 1).padStart(2, "0")}T00:00:00.000Z`;
  }
}

/**
 * The value an excluded row carries: a distinctive one for the types whose content the
 * fixture controls, and the ordinary rotating value for the text-shaped ones. Total for
 * the same reason {@link fixtureFieldValue} is — a `default` here would silently swallow
 * a new field type instead of asking what it should hold.
 *
 * A choice is searchable text but its content is a closed declared set, so the fixture
 * cannot plant a distinctive non-matching value in it and takes the rotating one.
 */
function excludedNonTextValue(
  field: SpecField,
): string | number | boolean | readonly string[] | null {
  switch (field.type) {
    case "number":
      return 8675309;
    case "boolean":
      return true;
    case "date":
      return "2042-02-03";
    case "datetime":
      return "2042-02-03T04:05:06.000Z";
    case "string":
    case "choice":
    case "string[]":
      return fixtureFieldValue(field, 44);
  }
}

function setText(row: FixtureRow, location: TextLocation, value: string | readonly string[]): void {
  row.values[location.field.name] =
    location.kind === "list"
      ? Array.isArray(value)
        ? [...value]
        : [value]
      : Array.isArray(value)
        ? value.join(" ")
        : value;
}

/**
 * Searchable text, decided the way the Diff Engine and the behavioral total inputs decide
 * it. All of them must move together: a type this calls searchable but the fixture treats
 * as inert would make an exclusion assertion claim something untrue.
 */
function isSearchableTextType(type: SpecField["type"]): boolean {
  return type === "string" || isChoiceFieldType(type) || isListFieldType(type);
}

function insertFixtureRow(
  spec: CapabilitySpec,
  tableName: string,
  row: FixtureRow,
  database: Database,
): void {
  const columns = ["id", "created_at", "extra", ...spec.schema.fields.map((field) => field.name)];
  const values = [
    row.id,
    row.createdAt,
    row.extra,
    ...spec.schema.fields.map((field) =>
      encodeCapabilityFieldForStorage(field, row.values[field.name]),
    ),
  ];
  database
    .query(
      `INSERT INTO ${sqlIdentifier(tableName)} (${columns.map(sqlIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...values);
}

async function invokeRecordHandler(
  label: "read" | "search",
  handler: CapabilityReadHandler,
  input: CapabilityInput,
  recorder: RecordingPresentation,
  query: ReturnType<typeof buildGateQueryPort>,
): Promise<readonly CapabilityDataRow[]> {
  recorder.clear();
  try {
    const fragment = await handler({ input, query, present: recorder.present });
    if (typeof fragment !== "string") throw new Error(`${label} Handler did not return a string`);
    assertPresentedFragmentsReturned(label, fragment, recorder.fragments());
    const rows = recorder.rows();
    if (rows.length === 0 && fragment !== "") {
      throw new Error(`${label} Handler must return an empty string when no records are presented`);
    }
    return rows;
  } catch (error) {
    if (error instanceof SmokeActionFailure) throw error;
    throw new SmokeActionFailure(
      label,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

function assertPresentedFragmentsReturned(
  label: "read" | "search",
  fragment: string,
  presented: readonly string[],
): void {
  let cursor = 0;
  for (const item of presented) {
    const index = fragment.indexOf(item, cursor);
    if (index < 0) {
      throw new Error(`${label} Handler discarded or reordered a presented record fragment`);
    }
    cursor = index + item.length;
  }
}

function rawDefaultOrder(tableName: string, database: Database): string[] {
  const rows = database
    .query(`SELECT "id", "created_at" FROM ${sqlIdentifier(tableName)}`)
    .all() as Array<{ id: string; created_at: string }>;
  return rows
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
    )
    .map((row) => row.id);
}

function assertRowsComplete(spec: CapabilitySpec, rows: readonly CapabilityDataRow[]): void {
  const expectedKeys = [
    "created_at",
    "id",
    ...activeSpecFields(spec.schema.fields).map((field) => field.name),
  ].sort();
  for (const row of rows) {
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) {
      throw new Error(`record ${row.id} did not expose the complete Action-safe active projection`);
    }
  }
}

function assertIdsEqual(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertSameIdSet(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)
  ) {
    throw new Error(
      `${label} expected match set ${JSON.stringify(expectedSorted)}, received ${JSON.stringify(actualSorted)}`,
    );
  }
}

function emptyInput(): CapabilityInput {
  return { values: {}, submittedFields: new Set() };
}

function searchInput(q: string | undefined): CapabilityInput {
  return { values: q === undefined ? {} : { q }, submittedFields: new Set() };
}
