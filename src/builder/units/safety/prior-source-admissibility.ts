// Prior-source admissibility: prior source is optional regeneration context, not an entitlement.
// Before an affected unit receives its old source in a prompt, deterministic checks must prove
// that source references nothing outside the candidate unit's current generation contract; a
// failed proof regenerates the unit without it. Both halves run against the candidate spec and
// its frozen dependency catalog, never the committed ones the source was written for.
//
// The hidden-name boundary refuses an inactive field name or undeclared capability table anywhere
// in the source, a dead string included: it smuggles the name into the prompt as a live read
// would. An active field the Action's list does not project is deliberately allowed — `behavior`
// reaches every prompt and read/search authorize SQL over the target table.

import ts from "typescript";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../../registry/index.ts";
import { capabilityQueryScopeTableNames } from "../../../runtime/data/index.ts";
import type { GeneratedUnitName } from "../../evolution/diff/diff-engine.ts";
import type { HandlerUnitName, UnitDescriptor } from "../generation/units.ts";
import { evaluateStaticString, expressionBindings } from "./static-string-analysis.ts";
import { checkHandlerSourceContract, checkItemRendererSourceContract } from "./unit-checks.ts";

/** The verdict on one unit's prior source: admitted, or withheld with the proof failure. */
export type PriorSourceAdmissibility =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string };

/**
 * One unit's recorded admissibility decision — the audit line in the evolution work plan.
 * A copied unit has none, because copy never enters model context at all.
 */
export interface PriorSourceDecision {
  readonly unit: GeneratedUnitName;
  readonly admitted: boolean;
  /** Why the source was withheld. Absent when it was admitted. */
  readonly reason?: string;
}

export interface PriorSourceAdmissibilityInput {
  /** The **candidate** spec — the contract the regenerated unit will be written against. */
  readonly spec: CapabilitySpec;
  readonly unit: UnitDescriptor;
  /** The committed unit's source, as read verbatim off the committed snapshot. */
  readonly source: string;
  /** The candidate's frozen dependency-generation catalog rows (Handlers only). */
  readonly dependencyCatalog?: readonly CapabilityRow[];
}

/**
 * Prove that one unit's prior source fits the candidate unit's current generation contract.
 * Deterministic: no model call, no execution, same verdict for the same inputs.
 */
export function checkPriorSourceAdmissibility(
  input: PriorSourceAdmissibilityInput,
): PriorSourceAdmissibility {
  const { spec, unit, source } = input;
  const catalog = input.dependencyCatalog ?? [];
  const contractMessage =
    unit.kind === "handler"
      ? checkHandlerSourceContract(
          spec,
          unit.name,
          source,
          catalog.map((row) => ({
            spec: capabilitySpecFromRow(row),
            incarnation_id: row.incarnation_id,
          })),
        )
      : checkItemRendererSourceContract(spec, source);
  if (contractMessage) {
    return withheld(`it no longer satisfies the unit contract — ${contractMessage}`);
  }

  return hiddenContextVerdict(spec, unit, source, catalog);
}

function hiddenContextVerdict(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  source: string,
  catalog: readonly CapabilityRow[],
): PriorSourceAdmissibility {
  const analysis = analyzeSourceNames(source);
  if (!analysis) {
    return withheld("its source cannot be parsed well enough to prove its current context");
  }

  const fields = namesPresent(analysis.meanings, inactiveFieldNames(spec, unit, catalog));
  if (fields.length > 0) {
    return withheld(
      `it names ${fields.length === 1 ? "a field" : "fields"} the candidate has made inactive: ${fields.join(", ")}`,
    );
  }

  const tables = undeclaredCapabilityTables(spec, unit, analysis.meanings, catalog);
  if (tables.length > 0) {
    return withheld(
      `it names capability ${tables.length === 1 ? "table" : "tables"} outside this unit's declared scope: ${tables.join(", ")}`,
    );
  }
  if (analysis.hasUnresolvedComputedName) {
    return withheld(
      "it computes a property name that cannot be proven inside the candidate unit contract",
    );
  }
  if (analysis.hasUnstableBindings) {
    return withheld(
      "its string bindings are mutable or shadowed, so their names cannot be proven inside the candidate unit contract",
    );
  }
  return { admitted: true };
}

/**
 * The admitted prior source, or `undefined`. The one call a prompt-building path should
 * make: it is impossible to hold the returned value and still be holding inadmissible bytes.
 */
export function admissiblePriorSource(input: PriorSourceAdmissibilityInput): string | undefined {
  return checkPriorSourceAdmissibility(input).admitted ? input.source : undefined;
}

function withheld(reason: string): PriorSourceAdmissibility {
  return { admitted: false, reason };
}

/**
 * Every field name whose data the candidate unit may not see: its own inactive fields plus each
 * declared dependency's. A dependency's active fields are in the projection, so inside contract.
 */
function inactiveFieldNames(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  dependencyCatalog: readonly CapabilityRow[],
): ReadonlySet<string> {
  const inactive = new Set(hiddenFieldNamesOf(spec));
  if (unit.kind !== "handler") return inactive;

  for (const dependency of declaredDependencySpecs(spec, unit.name, dependencyCatalog)) {
    for (const name of hiddenFieldNamesOf(dependency)) inactive.add(name);
  }
  return inactive;
}

function hiddenFieldNamesOf(spec: CapabilitySpec): readonly string[] {
  const active = new Set(activeSpecFields(spec.schema.fields).map((field) => field.name));
  return spec.schema.fields.map((field) => field.name).filter((name) => !active.has(name));
}

/**
 * Capability tables this source names outside the unit's declared query scope. The Handler check
 * covers executable SQL; this sweeps raw bytes, so a dropped table in a comment is caught too.
 */
function undeclaredCapabilityTables(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  sourceMeanings: readonly string[],
  dependencyCatalog: readonly CapabilityRow[],
): readonly string[] {
  const dependencies =
    unit.kind === "handler" ? declaredDependencySpecs(spec, unit.name, dependencyCatalog) : [];
  const allowed = new Set(
    capabilityQueryScopeTableNames({ target: spec, dependencies }).map((table) =>
      table.toLowerCase(),
    ),
  );
  const named = new Set(
    sourceMeanings.flatMap((meaning) =>
      [...meaning.matchAll(/\bcap_[a-z0-9_]+\b/gi)].map((match) => match[0].toLowerCase()),
    ),
  );
  return [...named].filter((table) => !allowed.has(table)).sort();
}

function declaredDependencySpecs(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  dependencyCatalog: readonly CapabilityRow[],
): readonly CapabilitySpec[] {
  const declared =
    action in spec.read_dependencies
      ? spec.read_dependencies[action as keyof typeof spec.read_dependencies]
      : [];
  return declared.flatMap((dependency) => {
    const row = dependencyCatalog.find(
      (candidate) =>
        candidate.id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    return row ? [capabilitySpecFromRow(row)] : [];
  });
}

/**
 * Which of the given names this source mentions, in raw bytes or in the meanings TypeScript
 * gives them. Whole-token matching (`_` and `$` count) keeps `text_element` distinct from `text`.
 */
function namesPresent(
  sourceMeanings: readonly string[],
  names: ReadonlySet<string>,
): readonly string[] {
  const found = [...names].filter((name) =>
    sourceMeanings.some((meaning) =>
      new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRegExp(name)}(?![\\p{L}\\p{N}_$])`, "u").test(
        meaning,
      ),
    ),
  );
  return found.sort();
}

interface SourceNameAnalysis {
  readonly meanings: readonly string[];
  readonly hasUnresolvedComputedName: boolean;
  readonly hasUnstableBindings: boolean;
}

function analyzeSourceNames(source: string): SourceNameAnalysis | undefined {
  const parsed = ts.createSourceFile("prior-source.ts", source, ts.ScriptTarget.Latest, true);
  const diagnostics = (
    parsed as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics.length > 0) return undefined;

  const meanings = new Set([source, decodeSourceEscapes(source)]);
  const bindings = expressionBindings(parsed);
  const hasUnstableBindings = sourceHasUnstableBindings(parsed);
  let hasUnresolvedComputedName = false;
  const visit = (node: ts.Node): void => {
    addNodeMeanings(node, bindings, meanings);
    hasUnresolvedComputedName ||= isUnresolvedComputedName(node, bindings);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { meanings: [...meanings], hasUnresolvedComputedName, hasUnstableBindings };
}

function addNodeMeanings(
  node: ts.Node,
  bindings: ReadonlyMap<string, ts.Expression>,
  meanings: Set<string>,
): void {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) meanings.add(node.text);
  if (!ts.isExpression(node)) return;
  const value = evaluateStaticString(node, bindings);
  if (value !== undefined) meanings.add(value);
}

function isUnresolvedComputedName(
  node: ts.Node,
  bindings: ReadonlyMap<string, ts.Expression>,
): boolean {
  const expression = ts.isElementAccessExpression(node)
    ? node.argumentExpression
    : ts.isComputedPropertyName(node)
      ? node.expression
      : reflectivePropertyKey(node);
  if (!expression || ts.isNumericLiteral(expression)) return false;
  return evaluateStaticString(expression, bindings) === undefined;
}

function reflectivePropertyKey(node: ts.Node): ts.Expression | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const receiver = node.expression.expression;
  if (!ts.isIdentifier(receiver)) return undefined;
  const method = node.expression.name.text;
  const reflectiveMethods =
    receiver.text === "Reflect"
      ? new Set(["defineProperty", "deleteProperty", "get", "has", "set"])
      : receiver.text === "Object"
        ? new Set(["defineProperty", "getOwnPropertyDescriptor", "hasOwn"])
        : new Set<string>();
  return reflectiveMethods.has(method) ? node.arguments[1] : undefined;
}

/**
 * For prior-source admission the global binding map is sound only for uniquely named immutable
 * bindings: a shadow, `let`, or assignment withholds old source and generation uses the contract.
 */
function sourceHasUnstableBindings(source: ts.SourceFile): boolean {
  const names = new Set<string>();
  let unstable = hasDuplicateLexicalDeclarationText(source.text);
  const declare = (name: ts.BindingName): void => {
    bindingIdentifiers(name).forEach((identifier) => {
      if (names.has(identifier)) unstable = true;
      names.add(identifier);
    });
  };
  const visit = (node: ts.Node): void => {
    const binding = bindingDeclaredBy(node);
    if (binding) declare(binding);
    if (hasUnstableBindingSemantics(node)) unstable = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return unstable;
}

function hasDuplicateLexicalDeclarationText(source: string): boolean {
  const names = [
    ...source.matchAll(/\b(?:const|let|var)\s+([\p{ID_Start}_$][\p{ID_Continue}_$]*)/gu),
  ].map((match) => match[1]);
  return names.some((name, index) => name !== undefined && names.indexOf(name) !== index);
}

function bindingDeclaredBy(node: ts.Node): ts.BindingName | undefined {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) return node.name;
  return ts.isCatchClause(node) ? node.variableDeclaration?.name : undefined;
}

function hasUnstableBindingSemantics(node: ts.Node): boolean {
  if (ts.isVariableDeclaration(node)) {
    const declarationList = node.parent;
    return (
      ts.isVariableDeclarationList(declarationList) &&
      (declarationList.flags & ts.NodeFlags.Const) === 0
    );
  }
  if (ts.isBinaryExpression(node)) {
    return (
      isAssignmentOperator(node.operatorToken.kind) &&
      (ts.isIdentifier(node.left) ||
        ts.isArrayLiteralExpression(node.left) ||
        ts.isObjectLiteralExpression(node.left))
    );
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  return ts.isPostfixUnaryExpression(node);
}

function bindingIdentifiers(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name),
  );
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function decodeSourceEscapes(source: string): string {
  return source
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\x([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
