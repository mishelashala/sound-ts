/**
 * 1.0 mutation / aliasing: block AST-visible punches after brand construction.
 *
 * - Assignment / delete on companion members (`User.is`, `.from`, `.values`)
 * - Property writes on bindings with an explicit dialect companion annotation
 */

import * as ts from "typescript";
import type { DialectProjectSymbols } from "../symbols/types.js";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

const COMPANION_MEMBERS = new Set(["is", "from", "values"]);

function typeRefName(type: ts.TypeNode | undefined): string | undefined {
  if (!type) return undefined;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeName.text;
  }
  return undefined;
}

/** Collect identifier names whose declared type is a dialect companion. */
function collectBrandAnnotatedLocals(
  sf: ts.SourceFile,
  symbols: DialectProjectSymbols,
): Set<string> {
  const names = new Set<string>();

  const note = (name: string, type: ts.TypeNode | undefined): void => {
    const ref = typeRefName(type);
    if (ref && symbols.byName.has(ref)) names.add(name);
  };

  walkAst(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      note(node.name.text, node.type);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      note(node.name.text, node.type);
    }
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      note(node.name.text, node.type);
    }
  });

  return names;
}

function isCompanionMemberAccess(
  expr: ts.Expression,
  symbols: DialectProjectSymbols,
): { companion: string; member: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  if (!ts.isIdentifier(expr.expression)) return undefined;
  const companion = expr.expression.text;
  if (!symbols.byName.has(companion)) return undefined;
  const member = expr.name.text;
  if (!COMPANION_MEMBERS.has(member)) return undefined;
  return { companion, member };
}

function isBrandPropertyWrite(
  expr: ts.Expression,
  brandLocals: ReadonlySet<string>,
): { local: string; prop: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  if (!ts.isIdentifier(expr.expression)) return undefined;
  const local = expr.expression.text;
  if (!brandLocals.has(local)) return undefined;
  return { local, prop: expr.name.text };
}

/**
 * Throw on companion-member mutation or property writes through brand-typed
 * bindings visible on the AST.
 */
export function assertNoBrandMutation(
  source: string,
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  if (symbols.byName.size === 0) return;

  const { sf } = createSoundnessAst(source, filename);
  const brandLocals = collectBrandAnnotatedLocals(sf, symbols);

  const rejectWrite = (target: ts.Expression, via: string): void => {
    const at = target.getStart(sf);
    const { prefix } = formatLoc(filename, source, at);
    throw new SyntaxError(
      `${prefix}mutating ${via} is not allowed in .sts (offset ${at}); ` +
        `brands are sealed after cast<> / .from — do not punch invariants`,
    );
  };

  walkAst(sf, (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const companion = isCompanionMemberAccess(node.left, symbols);
      if (companion) {
        rejectWrite(
          node.left,
          `companion member '${companion.companion}.${companion.member}'`,
        );
      }
      const prop = isBrandPropertyWrite(node.left, brandLocals);
      if (prop) {
        rejectWrite(
          node.left,
          `property '${prop.local}.${prop.prop}' on dialect-typed binding`,
        );
      }
    }

    if (ts.isDeleteExpression(node)) {
      const companion = isCompanionMemberAccess(node.expression, symbols);
      if (companion) {
        rejectWrite(
          node.expression,
          `companion member '${companion.companion}.${companion.member}'`,
        );
      }
      const prop = isBrandPropertyWrite(node.expression, brandLocals);
      if (prop) {
        rejectWrite(
          node.expression,
          `property '${prop.local}.${prop.prop}' on dialect-typed binding`,
        );
      }
    }
  });
}
