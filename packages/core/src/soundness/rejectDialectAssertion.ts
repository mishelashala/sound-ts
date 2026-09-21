/**
 * Plain `.ts` / `.tsx` in an `sts` batch cannot assert into a brand or
 * validate companion (#72).
 *
 * `.sts` already rejects every `as` / `any` / `!`. A mirrored `.ts` file is
 * still copied, so `value as Brand` would otherwise stay a stock `tsc`
 * assertion. This gate fails closed: SyntaxError, no rewrite into `cast`.
 *
 * Allowed: `as const`, assertions to non-companions (`as string`, `as number`,
 * `as any` with no companion target), `Brand.from`, and `cast<Brand>`.
 * A file that never names a companion is unchanged.
 * The companion may be declared in another file in the same batch
 * (`lookupSymbol` / `DialectProjectSymbols.byName`).
 */

import * as ts from "typescript";
import { lookupSymbol } from "../symbols/resolve.js";
import type { DialectProjectSymbols } from "../symbols/types.js";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

function dialectRefName(
  type: ts.TypeNode | undefined,
  symbols: DialectProjectSymbols,
  filename: string | undefined,
): string | undefined {
  if (!type) return undefined;
  let current = type;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (!ts.isTypeReferenceNode(current)) return undefined;
  if (!ts.isIdentifier(current.typeName)) return undefined;
  const name = current.typeName.text;
  if (name === "const") return undefined;
  const sym =
    filename !== undefined
      ? lookupSymbol(symbols, filename, name)
      : symbols.byName.get(name);
  if (!sym) return undefined;
  return name;
}

function isConstAssertion(node: ts.AsExpression): boolean {
  return (
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === "const" &&
    node.type.typeArguments === undefined
  );
}

/** Names whose explicit annotation is exactly a companion (`x: Brand`). */
function collectAnnotatedLocals(
  sf: ts.SourceFile,
  symbols: DialectProjectSymbols,
  filename: string | undefined,
): Map<string, string> {
  const names = new Map<string, string>();
  const note = (name: ts.Node, type: ts.TypeNode | undefined): void => {
    if (!ts.isIdentifier(name)) return;
    const ref = dialectRefName(type, symbols, filename);
    if (ref) names.set(name.text, ref);
  };
  walkAst(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      note(node.name, node.type);
    }
  });
  return names;
}

function returnTypeName(
  ret: ts.ReturnStatement,
  symbols: DialectProjectSymbols,
  filename: string | undefined,
): string | undefined {
  let current: ts.Node | undefined = ret.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessor(current)
    ) {
      return dialectRefName(current.type, symbols, filename);
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Companion expected by the position `expr` is written into
 * (`const x: Brand = expr`, `return expr` from `: Brand`, `x = expr`
 * where `x: Brand`).
 */
function contextualDialectName(
  expr: ts.Expression,
  symbols: DialectProjectSymbols,
  filename: string | undefined,
  annotated: ReadonlyMap<string, string>,
): string | undefined {
  let current: ts.Node = expr;
  while (true) {
    const parent = current.parent;
    if (!parent) return undefined;

    if (ts.isParenthesizedExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }

    if (
      ts.isConditionalExpression(parent) &&
      (parent.whenTrue === current || parent.whenFalse === current)
    ) {
      current = parent;
      continue;
    }

    if (
      (ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isPropertyDeclaration(parent)) &&
      parent.initializer === current
    ) {
      return dialectRefName(parent.type, symbols, filename);
    }

    if (ts.isReturnStatement(parent) && parent.expression === current) {
      return returnTypeName(parent, symbols, filename);
    }

    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      parent.body === current
    ) {
      return dialectRefName(parent.type, symbols, filename);
    }

    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === current &&
      ts.isIdentifier(parent.left)
    ) {
      return annotated.get(parent.left.text);
    }

    return undefined;
  }
}

function rejectAssertion(
  filename: string | undefined,
  source: string,
  at: number,
  kind: string,
  name: string,
): never {
  const { prefix } = formatLoc(filename, source, at);
  throw new SyntaxError(
    `${prefix}${kind} dialect companion '${name}' is not allowed ` +
      `(offset ${at}); untrusted values enter through cast<> or ${name}.from(…) — ` +
      `assertions are not rewritten into cast`,
  );
}

function asKeywordOffset(node: ts.AsExpression, sf: ts.SourceFile): number {
  const asTok = node
    .getChildren(sf)
    .find((c) => c.kind === ts.SyntaxKind.AsKeyword);
  return asTok?.getStart(sf) ?? node.type.getStart(sf);
}

/**
 * Throw if `source` asserts, `any`-asserts, or non-null-asserts into a
 * `brand type` / `validate type` companion known to `symbols`.
 * Does not rewrite the assertion into `cast`.
 */
export function assertNoDialectAssertions(
  source: string,
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  if (symbols.byName.size === 0) return;

  const { sf } = createSoundnessAst(source, filename);
  const annotated = collectAnnotatedLocals(sf, symbols, filename);

  const banTypedAssertion = (
    node: ts.AsExpression | ts.TypeAssertion,
  ): void => {
    if (ts.isAsExpression(node) && isConstAssertion(node)) return;

    const target = dialectRefName(node.type, symbols, filename);
    if (target) {
      const at = ts.isAsExpression(node)
        ? asKeywordOffset(node, sf)
        : node.getStart(sf);
      rejectAssertion(filename, source, at, "type assertion to", target);
    }

    if (node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const into = contextualDialectName(node, symbols, filename, annotated);
      if (into) {
        const at = ts.isAsExpression(node)
          ? asKeywordOffset(node, sf)
          : node.getStart(sf);
        rejectAssertion(filename, source, at, "any assertion into", into);
      }
    }
  };

  walkAst(sf, (node) => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      banTypedAssertion(node);
      return;
    }

    if (ts.isNonNullExpression(node)) {
      const into = contextualDialectName(node, symbols, filename, annotated);
      if (!into) return;
      const bang = node
        .getChildren(sf)
        .find((c) => c.kind === ts.SyntaxKind.ExclamationToken);
      rejectAssertion(
        filename,
        source,
        bang?.getStart(sf) ?? node.end - 1,
        "non-null assertion into",
        into,
      );
    }

    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      const bang = node.exclamationToken;
      if (!bang) return;
      const target = dialectRefName(node.type, symbols, filename);
      if (!target) return;
      rejectAssertion(
        filename,
        source,
        bang.getStart(sf),
        "non-null assertion to",
        target,
      );
    }
  });
}
