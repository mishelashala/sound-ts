/**
 * Reject TypeScript type assertions in `.sts` sources via AST.
 *
 * Brand entry stays `cast<>` / `.from`. `as const` is allowed (literal
 * narrowing, not a brand punch-through). Import/export binding renames are
 * ExportSpecifier / ImportSpecifier, not AsExpression.
 */

import * as ts from "typescript";
import { createSoundnessAst, walkAst } from "./ast.js";

/**
 * Throw if `source` contains `expr as Type` or `<Type>expr`.
 * Does not rewrite assertions into `cast<>`.
 * Ordinary `.ts` / `.tsx` files are left to stock `tsc`.
 */
export function assertNoTypeAssertions(
  source: string,
  filename?: string,
): void {
  if (filename !== undefined && !filename.endsWith(".sts")) {
    return;
  }

  const { sf } = createSoundnessAst(source, filename);
  walkAst(sf, (node) => {
    if (ts.isAsExpression(node)) {
      // `as const` is a TypeReference named `const` in the TS AST (not ConstKeyword).
      if (
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === "const" &&
        node.type.typeArguments === undefined
      ) {
        return;
      }
      const asTok = node
        .getChildren(sf)
        .find((c) => c.kind === ts.SyntaxKind.AsKeyword);
      const at = asTok?.getStart(sf) ?? node.getStart(sf);
      throw new SyntaxError(
        `type assertion with 'as' is not allowed in .sts (offset ${at}); use cast<> or Name.from(…)`,
      );
    }

    if (ts.isTypeAssertionExpression(node)) {
      const start = node.getStart(sf);
      throw new SyntaxError(
        `angle-bracket type assertion is not allowed in .sts (offset ${start}); use cast<> or Name.from(…)`,
      );
    }
  });
}
