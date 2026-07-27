// Shared, conservative static-string analysis for generated TypeScript.
//
// Handler safety uses it to inspect SQL and toolbox property names. Prior-source
// admissibility uses the same evaluator so escaped identifiers and strings assembled
// through constants, concatenation, or templates cannot hide stale contract names.

import ts from "typescript";

export function expressionBindings(source: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
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

export function evaluateStaticString(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string> = new Set(),
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
  if (ts.isCallExpression(unwrapped)) return evaluateStaticStringCall(unwrapped, bindings, seen);
  return undefined;
}

function evaluateStaticIdentifier(
  node: ts.Identifier,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  if (seen.has(node.text)) return undefined;
  const initializer = bindings.get(node.text);
  return initializer
    ? evaluateStaticString(initializer, bindings, new Set([...seen, node.text]))
    : undefined;
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

function evaluateStaticStringCall(
  node: ts.CallExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const target = node.expression.expression;
  if (node.expression.name.text === "join") {
    return evaluateStaticJoin(node, target, bindings, seen);
  }
  if (node.expression.name.text === "concat") {
    return evaluateStaticConcat(node, target, bindings, seen);
  }
  return undefined;
}

function evaluateStaticJoin(
  node: ts.CallExpression,
  target: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  const values = evaluateStaticStringArray(target, bindings, seen);
  const separatorArgument = node.arguments[0];
  const separator = separatorArgument
    ? evaluateStaticString(separatorArgument, bindings, seen)
    : ",";
  return values && separator !== undefined ? values.join(separator) : undefined;
}

function evaluateStaticConcat(
  node: ts.CallExpression,
  target: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): string | undefined {
  const base = evaluateStaticString(target, bindings, seen);
  const suffixes = node.arguments.map((argument) => evaluateStaticString(argument, bindings, seen));
  return base !== undefined && suffixes.every((value) => value !== undefined)
    ? base + suffixes.join("")
    : undefined;
}

function evaluateStaticStringArray(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string>,
): readonly string[] | undefined {
  const unwrapped = unwrapExpression(node);
  if (ts.isIdentifier(unwrapped)) {
    if (seen.has(unwrapped.text)) return undefined;
    const initializer = bindings.get(unwrapped.text);
    return initializer
      ? evaluateStaticStringArray(initializer, bindings, new Set([...seen, unwrapped.text]))
      : undefined;
  }
  if (!ts.isArrayLiteralExpression(unwrapped)) return undefined;
  const values = unwrapped.elements.map((element) =>
    ts.isSpreadElement(element) ? undefined : evaluateStaticString(element, bindings, seen),
  );
  return values.every((value) => value !== undefined) ? (values as string[]) : undefined;
}

export function unwrapExpression(node: ts.Expression): ts.Expression {
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
