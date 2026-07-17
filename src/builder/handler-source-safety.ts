import ts from "typescript";

import { capabilityQueryScopeTableNames } from "../capability-data/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import type { HandlerUnitName } from "./units.ts";

export interface HandlerDependencyCatalogEntry {
  readonly spec: CapabilitySpec;
  readonly incarnation_id: string;
}

/** Check the source-only safety boundary shared by unit repair and whole-snapshot Gate. */
export function checkHandlerSourceSafety(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  source: ts.SourceFile,
  dependencyCatalog: readonly HandlerDependencyCatalogEntry[],
): string | undefined {
  const isolationMessage = checkHandlerSourceIsolation(source);
  if (isolationMessage) return isolationMessage;
  const connectionMessage = checkConnectionAccess(source);
  if (connectionMessage) return connectionMessage;
  if (containsRawHttp(source)) {
    return "Generated handlers must not touch raw HTTP.";
  }
  if (containsRawMutationSql(source)) {
    return "Generated handlers must not contain raw mutation SQL.";
  }
  return checkDeclaredQueryCatalog(spec, action, source, dependencyCatalog);
}

function checkConnectionAccess(source: ts.SourceFile): string | undefined {
  const bindings = expressionBindings(source);
  const toolboxRoots = handlerSourceRoots(source).toolbox;
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    found = connectionAccessName(node, bindings, toolboxRoots);
    if (found) return;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found
    ? `Generated handlers must not access a database connection directly (found "${found}"); use only the injected mutation and query ports.`
    : undefined;
}

const CONNECTION_NAMES = new Set(["connection", "database", "db", "sqlite"]);

function connectionAccessName(
  node: ts.Node,
  bindings: ReadonlyMap<string, ts.Expression>,
  toolboxRoots: ReadonlySet<string>,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return forbiddenPropertyAccessName(node, bindings, toolboxRoots);
  }
  if (ts.isVariableDeclaration(node)) {
    return forbiddenToolboxBinding(node.name, node.initializer, bindings, toolboxRoots);
  }
  if (ts.isParameter(node)) {
    return forbiddenToolboxBinding(node.name, undefined, bindings, toolboxRoots);
  }
  if (!ts.isElementAccessExpression(node) || !node.argumentExpression) return undefined;
  if (!isToolboxDerived(node.expression, bindings, toolboxRoots)) return undefined;
  const name = evaluateStaticString(node.argumentExpression, bindings, new Set());
  if (name === undefined) return "dynamic property";
  return CONNECTION_NAMES.has(name) ? name : undefined;
}

function forbiddenPropertyAccessName(
  node: ts.PropertyAccessExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
  toolboxRoots: ReadonlySet<string>,
): string | undefined {
  return CONNECTION_NAMES.has(node.name.text) &&
    isToolboxDerived(node.expression, bindings, toolboxRoots)
    ? node.name.text
    : undefined;
}

function forbiddenToolboxBinding(
  name: ts.BindingName,
  initializer: ts.Expression | undefined,
  bindings: ReadonlyMap<string, ts.Expression>,
  toolboxRoots: ReadonlySet<string>,
): string | undefined {
  if (ts.isIdentifier(name)) {
    return initializer &&
      CONNECTION_NAMES.has(name.text) &&
      isToolboxDerived(initializer, bindings, toolboxRoots)
      ? name.text
      : undefined;
  }
  if (!ts.isObjectBindingPattern(name)) return undefined;
  const forbidden = name.elements.find((element) => {
    const bindingName = element.propertyName ?? element.name;
    return ts.isIdentifier(bindingName) && CONNECTION_NAMES.has(bindingName.text);
  });
  if (!forbidden || (initializer && !isToolboxDerived(initializer, bindings, toolboxRoots))) {
    return undefined;
  }
  const bindingName = forbidden.propertyName ?? forbidden.name;
  return ts.isIdentifier(bindingName) ? bindingName.text : undefined;
}

function isToolboxDerived(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  toolboxRoots: ReadonlySet<string>,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapExpression(node);
  if (ts.isIdentifier(unwrapped)) {
    if (toolboxRoots.has(unwrapped.text)) return true;
    if (seen.has(unwrapped.text)) return false;
    const initializer = bindings.get(unwrapped.text);
    return initializer
      ? isToolboxDerived(initializer, bindings, toolboxRoots, new Set([...seen, unwrapped.text]))
      : false;
  }
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return isToolboxDerived(unwrapped.expression, bindings, toolboxRoots, seen);
  }
  return false;
}

function checkDeclaredQueryCatalog(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  source: ts.SourceFile,
  dependencyCatalog: readonly HandlerDependencyCatalogEntry[],
): string | undefined {
  const declared =
    action in spec.read_dependencies
      ? spec.read_dependencies[action as keyof typeof spec.read_dependencies]
      : [];
  const dependencies: CapabilitySpec[] = [];

  for (const dependency of declared) {
    const matches = dependencyCatalog.filter(
      (candidate) =>
        candidate.spec.id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    if (matches.length !== 1) {
      return `Generated handler "${action}" cannot validate its declared query catalog: expected exactly one dependency ${dependency.capability_id}/${dependency.incarnation_id}, found ${matches.length}.`;
    }
    const dependencyEntry = matches[0];
    if (dependencyEntry) dependencies.push(dependencyEntry.spec);
  }

  const allowedTables = new Set(
    capabilityQueryScopeTableNames({ target: spec, dependencies }).map((table) =>
      table.toLowerCase(),
    ),
  );
  const referenced = capabilityTableReferences(source);
  if (referenced.dynamic) {
    return `Generated handler "${action}" builds query SQL dynamically; SQL passed to query.all/query.records must be statically inspectable and use only target or declared-dependency tables.`;
  }
  const forbidden = [...referenced.tables].filter((table) => !allowedTables.has(table)).sort();
  if (forbidden.length === 0) return undefined;
  return `Generated handler "${action}" queries undeclared capability table${forbidden.length === 1 ? "" : "s"}: ${forbidden.join(", ")}. Allowed for this Action: ${[...allowedTables].sort().join(", ")}.`;
}

interface CapabilityTableScan {
  readonly tables: ReadonlySet<string>;
  readonly dynamic: boolean;
}

function capabilityTableReferences(source: ts.SourceFile): CapabilityTableScan {
  const tables = new Set<string>();
  const bindings = expressionBindings(source);
  let dynamic = false;
  for (const expression of querySqlExpressions(source)) {
    const evaluated = expression
      ? evaluateStaticString(expression, bindings, new Set())
      : undefined;
    if (evaluated === undefined) dynamic = true;
    else addCapabilityTables(tables, evaluated);
  }
  return { tables, dynamic };
}

function querySqlExpressions(source: ts.SourceFile): readonly (ts.Expression | undefined)[] {
  const expressions: Array<ts.Expression | undefined> = [];
  const bindings = expressionBindings(source);
  const roots = handlerSourceRoots(source);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isQueryCall(node.expression, bindings, roots)) {
      expressions.push(sqlExpressionFromCall(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return expressions;
}

function isQueryCall(
  expression: ts.LeftHandSideExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
  roots: HandlerSourceRoots,
): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      (expression.name.text === "all" || expression.name.text === "records") &&
      isQueryReceiver(expression.expression, bindings, roots)
    );
  }
  if (!ts.isElementAccessExpression(expression) || !expression.argumentExpression) return false;
  const method = evaluateStaticString(expression.argumentExpression, bindings, new Set());
  return (
    (method === "all" || method === "records") &&
    isQueryReceiver(expression.expression, bindings, roots)
  );
}

function isQueryReceiver(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  roots: HandlerSourceRoots,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    if (roots.query.has(unwrapped.text)) return true;
    if (seen.has(unwrapped.text)) return false;
    const initializer = bindings.get(unwrapped.text);
    return initializer
      ? isQueryReceiver(initializer, bindings, roots, new Set([...seen, unwrapped.text]))
      : false;
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return (
      unwrapped.name.text === "query" &&
      isContextReceiver(unwrapped.expression, bindings, roots.context, seen)
    );
  }
  return false;
}

function isContextReceiver(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  contextRoots: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return false;
  if (contextRoots.has(unwrapped.text)) return true;
  if (seen.has(unwrapped.text)) return false;
  const initializer = bindings.get(unwrapped.text);
  return initializer
    ? isContextReceiver(initializer, bindings, contextRoots, new Set([...seen, unwrapped.text]))
    : false;
}

interface HandlerSourceRoots {
  readonly toolbox: ReadonlySet<string>;
  readonly query: ReadonlySet<string>;
  readonly context: ReadonlySet<string>;
}

function handlerSourceRoots(source: ts.SourceFile): HandlerSourceRoots {
  const toolbox = new Set<string>(["context", "mutation", "query"]);
  const query = new Set<string>(["query"]);
  const context = new Set<string>(["context"]);
  const parameter = defaultHandlerParameter(source);
  if (parameter && ts.isIdentifier(parameter)) {
    toolbox.add(parameter.text);
    context.add(parameter.text);
  } else if (parameter && ts.isObjectBindingPattern(parameter)) {
    addDestructuredToolboxRoots(parameter, toolbox, query);
  }
  return { toolbox, query, context };
}

function defaultHandlerParameter(source: ts.SourceFile): ts.BindingName | undefined {
  const declaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      ),
  );
  return declaration?.parameters[0]?.name;
}

function addDestructuredToolboxRoots(
  parameter: ts.ObjectBindingPattern,
  toolbox: Set<string>,
  query: Set<string>,
): void {
  for (const element of parameter.elements) {
    const sourceName = element.propertyName ?? element.name;
    if (!ts.isIdentifier(sourceName) || !ts.isIdentifier(element.name)) continue;
    if (sourceName.text === "query") {
      query.add(element.name.text);
      toolbox.add(element.name.text);
    } else if (sourceName.text === "mutation") {
      toolbox.add(element.name.text);
    }
  }
}

function sqlExpressionFromCall(call: ts.CallExpression): ts.Expression | undefined {
  const [input] = call.arguments;
  if (!input || !ts.isObjectLiteralExpression(input)) return undefined;
  const sql = input.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText() === "sql",
  );
  if (sql && ts.isPropertyAssignment(sql)) return sql.initializer;
  if (sql && ts.isShorthandPropertyAssignment(sql)) return sql.name;
  return undefined;
}

function expressionBindings(source: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

function evaluateStaticString(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  const unwrapped = unwrapExpression(node);
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (ts.isIdentifier(unwrapped)) return evaluateStaticIdentifier(unwrapped, bindings, seen);
  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return evaluateStaticConcatenation(unwrapped, bindings, seen);
  }
  if (ts.isTemplateExpression(unwrapped)) return evaluateStaticTemplate(unwrapped, bindings, seen);
  return undefined;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function evaluateStaticIdentifier(
  node: ts.Identifier,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  if (seen.has(node.text)) return undefined;
  const initializer = bindings.get(node.text);
  if (!initializer) return undefined;
  return evaluateStaticString(initializer, bindings, new Set([...seen, node.text]));
}

function evaluateStaticConcatenation(
  node: ts.BinaryExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  const left = evaluateStaticString(node.left, bindings, seen);
  const right = evaluateStaticString(node.right, bindings, seen);
  return left === undefined || right === undefined ? undefined : left + right;
}

function evaluateStaticTemplate(
  node: ts.TemplateExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  let value = node.head.text;
  for (const span of node.templateSpans) {
    const expression = evaluateStaticString(span.expression, bindings, seen);
    if (expression === undefined) return undefined;
    value += expression + span.literal.text;
  }
  return value;
}

function addCapabilityTables(tables: Set<string>, value: string): void {
  for (const match of value.matchAll(/\bcap_[a-z0-9_]+\b/gi)) {
    const table = match[0];
    if (table) tables.add(table.toLowerCase());
  }
}

const RAW_MUTATION_SQL_PATTERN =
  /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?\s+[^\s]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE(?:\s+(?:TEMP|TEMPORARY|UNIQUE|VIRTUAL))*\s+(?:TABLE|INDEX|TRIGGER|VIEW)|ALTER\s+(?:TABLE|INDEX|TRIGGER|VIEW)|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)|TRUNCATE|VACUUM|ATTACH|DETACH|REINDEX|PRAGMA)\b/i;

function containsRawMutationSql(source: ts.SourceFile): boolean {
  const bindings = expressionBindings(source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isExpression(node)) {
      const value = evaluateStaticString(node, bindings, new Set());
      if (value && RAW_MUTATION_SQL_PATTERN.test(value)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function containsRawHttp(source: ts.SourceFile): boolean {
  const rawHttpNames = new Set(["fetch", "Request", "Response", "Headers", "XMLHttpRequest"]);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isIdentifier(node) &&
        rawHttpNames.has(node.text) &&
        isRuntimeIdentifierReference(node)) ||
      (ts.isStringLiteralLike(node) && /https?:\/\//.test(node.text))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function checkHandlerSourceIsolation(source: ts.SourceFile): string | undefined {
  let bypass = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
      (ts.isIdentifier(node) &&
        ["Bun", "Deno", "Function", "eval", "globalThis", "process", "require"].includes(
          node.text,
        ) &&
        isRuntimeIdentifierReference(node))
    ) {
      bypass = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (bypass) {
    return "Generated handlers must use only the injected toolbox; imports, ambient runtime access, dynamic code loading, and evaluation are not allowed.";
  }
  return undefined;
}

function isRuntimeIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}
