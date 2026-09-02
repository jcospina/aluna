// The isolation boundary every generated unit shares: no imports, no ambient runtime, no
// dynamic code loading or evaluation.
//
// It used to live inside the handler check alone, which left the item renderer — the other
// unit the platform executes, and the one the design-lint rung runs *in-process during the
// Gate* — with no ambient ban at all. A renderer reading `process.env` and calling `fetch`
// through `globalThis` passed unit generation, the design-lint rung and the structural
// rung, and its `fetch` calls really fired. So the rule is stated once here and both unit
// kinds are held to it.
//
// **What this is and is not.** A static deny-list over identifiers cannot be a sandbox:
// `({}).constructor.constructor` reaches the Function constructor while naming nothing
// banned, and `Reflect.get`, `[].flat.constructor` and friends are equivalent. The
// property-name ban below closes the *reachable spellings* of that family rather than the
// family itself, which is worth doing and is not worth mistaking for containment. The
// containment is `src/platform/secrets.ts`: the credentials are not in `process.env` by the time any
// generated code runs. ADR-0004's "no process sandbox" is unchanged.

import ts from "typescript";

/**
 * Ambient runtime roots. Naming any of them as a *value* is the escape this bans; the
 * property-name check below covers the spellings that reach them without naming one.
 */
const BANNED_RUNTIME_IDENTIFIERS: ReadonlySet<string> = new Set([
  "Bun",
  "Deno",
  "Function",
  "Proxy",
  "Reflect",
  "WebAssembly",
  "eval",
  "globalThis",
  "process",
  "require",
]);

/**
 * Property names whose only use is to climb out of the value you already hold.
 * `({}).constructor.constructor` is the Function constructor; `__proto__`/`prototype` are
 * the same climb one rung lower. No generated unit has a legitimate use for any of them.
 */
const BANNED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "prototype",
]);

const ISOLATION_REFUSAL =
  "imports, ambient runtime access, dynamic code loading, and evaluation are not allowed.";

/**
 * Name the isolation rule a generated unit broke, or `undefined` when it holds.
 *
 * @param subject the clause naming the unit and what it may use, ending without punctuation
 */
export function checkSourceIsolation(subject: string, source: ts.SourceFile): string | undefined {
  return breaksIsolation(source) ? `${subject}; ${ISOLATION_REFUSAL}` : undefined;
}

function breaksIsolation(source: ts.SourceFile): boolean {
  let bypass = false;
  const visit = (node: ts.Node): void => {
    if (bypass) return;
    if (isIsolationBreak(node)) {
      bypass = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bypass;
}

function isIsolationBreak(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return true;
  // `import(...)` and `import.meta` — the two module-system reaches that are expressions
  // rather than declarations, so the two checks above never see them.
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    return true;
  if (ts.isMetaProperty(node)) return true;
  if (ts.isIdentifier(node)) {
    return BANNED_RUNTIME_IDENTIFIERS.has(node.text) && isRuntimeIdentifierReference(node);
  }
  return isBannedPropertyReach(node);
}

/**
 * A banned property reached by either spelling: `x.constructor` and `x["constructor"]`
 * name the same thing, and a check that saw only the first would be closed in name only.
 */
function isBannedPropertyReach(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.name) && BANNED_PROPERTY_NAMES.has(node.name.text);
  }
  if (!ts.isElementAccessExpression(node)) return false;
  const argument = node.argumentExpression;
  return ts.isStringLiteralLike(argument) && BANNED_PROPERTY_NAMES.has(argument.text);
}

/**
 * Whether an identifier is a *reference to the ambient binding* rather than a name being
 * declared or a property key. `{ process: 1 }` and `const eval = 2` name nothing ambient.
 */
export function isRuntimeIdentifierReference(node: ts.Identifier): boolean {
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
