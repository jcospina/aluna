import ts from "typescript";

import type { CapabilitySpec } from "../registry/index.ts";

/**
 * Statically enforce the item renderer's declared data boundary. Runtime
 * projection remains defense in depth, but undeclared reads must fail the Gate
 * so generated code cannot accidentally depend on a value it will never receive.
 */
export function checkItemRendererFieldAccess(
  spec: CapabilitySpec,
  content: string,
): string | undefined {
  const source = ts.createSourceFile("item.ts", content, ts.ScriptTarget.Latest, true);
  const renderer = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      ),
  );
  const parameter = renderer?.parameters[0]?.name;
  if (!renderer?.body || !parameter) return undefined;
  if (!ts.isIdentifier(parameter)) {
    return "The item renderer must receive a named record parameter so declared field access can be checked.";
  }

  const state: FieldAccessState = {
    aliases: new Set([parameter.text]),
    allowed: new Set(spec.ui_intent.item.shows),
    undeclared: new Set(),
    dynamicAccess: false,
  };

  const visit = (node: ts.Node): void => {
    inspectAliasDeclaration(node, state);
    inspectLiteralFieldAccess(node, state);
    inspectWholeRecordAccess(node, state);
    ts.forEachChild(node, visit);
  };

  visit(renderer.body);

  if (state.dynamicAccess) {
    return "The item renderer must access only literal fields declared by ui_intent.item.shows; dynamic or whole-record access is not allowed.";
  }
  if (state.undeclared.size > 0) {
    return `The item renderer reads fields not declared by ui_intent.item.shows: ${[...state.undeclared].sort().join(", ")}.`;
  }
  return undefined;
}

interface FieldAccessState {
  readonly aliases: Set<string>;
  readonly allowed: Set<string>;
  readonly undeclared: Set<string>;
  dynamicAccess: boolean;
}

function inspectAliasDeclaration(node: ts.Node, state: FieldAccessState): void {
  if (!ts.isVariableDeclaration(node) || !isRecordAlias(node.initializer, state)) return;
  if (ts.isIdentifier(node.name)) {
    state.aliases.add(node.name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(node.name)) {
    state.dynamicAccess = true;
    return;
  }
  for (const element of node.name.elements) {
    if (element.dotDotDotToken) state.dynamicAccess = true;
    else checkField(bindingPropertyName(element), state);
  }
}

function inspectLiteralFieldAccess(node: ts.Node, state: FieldAccessState): void {
  if (ts.isPropertyAccessExpression(node) && isRecordAlias(node.expression, state)) {
    checkField(node.name.text, state);
  }
  if (ts.isElementAccessExpression(node) && isRecordAlias(node.expression, state)) {
    checkField(literalText(node.argumentExpression), state);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    isRecordAlias(node.right, state)
  ) {
    checkField(literalText(node.left), state);
  }
}

function inspectWholeRecordAccess(node: ts.Node, state: FieldAccessState): void {
  const callUsesRecord =
    ts.isCallExpression(node) && node.arguments.some((argument) => isRecordAlias(argument, state));
  const spreadsRecord = ts.isSpreadElement(node) && isRecordAlias(node.expression, state);
  const returnsRecord = ts.isReturnStatement(node) && isRecordAlias(node.expression, state);
  if (callUsesRecord || spreadsRecord || returnsRecord) state.dynamicAccess = true;
}

function checkField(name: string | undefined, state: FieldAccessState): void {
  if (name === undefined) state.dynamicAccess = true;
  else if (!state.allowed.has(name)) state.undeclared.add(name);
}

function isRecordAlias(node: ts.Node | undefined, state: FieldAccessState): node is ts.Identifier {
  return node !== undefined && ts.isIdentifier(node) && state.aliases.has(node.text);
}

function bindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName) {
    return ts.isIdentifier(element.propertyName)
      ? element.propertyName.text
      : literalText(element.propertyName);
  }
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

function literalText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}
