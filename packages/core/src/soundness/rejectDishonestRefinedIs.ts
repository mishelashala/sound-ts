/**
 * 1.0 honest type predicates: Mode B `is` bodies must look like a check.
 *
 * We do not prove correctness. We reject vacuous shapes that would mint a
 * companion treating arbitrary input as the brand.
 */

import * as ts from "typescript";
import type { RefinedBrandDecl } from "../parse.js";
import type { DialectProjectSymbols } from "../symbols/types.js";

function parseIsBody(
  decl: RefinedBrandDecl,
): { sf: ts.SourceFile; body: ts.Block } {
  const snippet =
    `function __soundTsIs(${decl.isParamName}: ${decl.isParamType}) {\n` +
    `${decl.isBody}\n` +
    `}\n`;
  const sf = ts.createSourceFile(
    `${decl.name}.is.ts`,
    snippet,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isFunctionDeclaration(stmt) || !stmt.body) {
    throw new SyntaxError(
      `brand type ${decl.name}: could not parse Mode B is() body`,
    );
  }
  return { sf, body: stmt.body };
}

function referencesIdent(node: ts.Node, name: string): boolean {
  let found = false;
  const go = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, go);
  };
  go(node);
  return found;
}

/** True when the body never returns a non-`true` expression (vacuous success). */
function onlyReturnsTrue(body: ts.Block): boolean {
  const returns: Array<ts.Expression | undefined> = [];
  const go = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && n !== body.parent) {
      return; // nested function — ignore its returns
    }
    if (ts.isReturnStatement(n)) {
      returns.push(n.expression);
      return;
    }
    ts.forEachChild(n, go);
  };
  go(body);

  if (returns.length === 0) {
    // No return → implicit undefined; treat as vacuous
    return true;
  }
  return returns.every(
    (expr) => expr !== undefined && expr.kind === ts.SyntaxKind.TrueKeyword,
  );
}

/**
 * Throw when a refined brand's `is` body is empty, ignores its parameter,
 * or only returns literal `true`.
 */
export function assertHonestRefinedPredicates(
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  for (const sym of symbols.symbols) {
    if (sym.kind !== "brand") continue;
    if (filename !== undefined && sym.filename !== filename) continue;
    if (sym.decl.kind !== "refined") continue;
    const decl = sym.decl;

    const { sf, body } = parseIsBody(decl);
    const bodyText = decl.isBody.trim();
    if (bodyText.length === 0) {
      throw new SyntaxError(
        `brand type ${decl.name}: Mode B is() body is empty; ` +
          `provide a real check of '${decl.isParamName}' (predicates are not proof)` +
          (filename ? ` (${filename})` : ""),
      );
    }

    if (!referencesIdent(body, decl.isParamName)) {
      const at = body.getStart(sf);
      throw new SyntaxError(
        `brand type ${decl.name}: Mode B is() body does not use parameter ` +
          `'${decl.isParamName}' (offset ${at}); vacuous predicates are not proof`,
      );
    }

    if (onlyReturnsTrue(body)) {
      const at = body.getStart(sf);
      throw new SyntaxError(
        `brand type ${decl.name}: Mode B is() always returns true ` +
          `(offset ${at}); vacuous predicates are not proof — check ` +
          `'${decl.isParamName}' before refining to ${decl.name}`,
      );
    }
  }
}
