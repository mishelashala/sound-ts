/**
 * Reject postfix non-null assertions (`value!`) and definite-assignment
 * assertions (`prop!: Type`) in `.sts` source via TypeScript AST.
 *
 * Does not delete or rewrite `!`. Boolean not (`!cond`) and `!=` / `!==`
 * are PrefixUnaryExpression / BinaryExpression — not NonNullExpression.
 */

import * as ts from "typescript";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

/**
 * Throw if `source` uses postfix `!` or definite-assignment `!`.
 * Does not strip the `!` and continue.
 */
export function assertNoNonNullAssertions(
  source: string,
  filename?: string,
): void {
  const { sf, source: orig } = createSoundnessAst(source, filename);

  const throwAt = (index: number): never => {
    const { where } = formatLoc(filename, orig, index);
    throw new SyntaxError(
      `non-null / definite-assignment '!' is not allowed in .sts (${where}); ` +
        `narrow with a check instead (do not use '!' to assert away null | undefined)`,
    );
  };

  walkAst(sf, (node) => {
    if (ts.isNonNullExpression(node)) {
      // Point at the `!` token when present
      const bang = node
        .getChildren(sf)
        .find((c) => c.kind === ts.SyntaxKind.ExclamationToken);
      throwAt(bang?.getStart(sf) ?? node.end - 1);
    }

    if (ts.isPropertyDeclaration(node) && node.exclamationToken) {
      throwAt(node.exclamationToken.getStart(sf));
    }
    if (ts.isVariableDeclaration(node) && node.exclamationToken) {
      throwAt(node.exclamationToken.getStart(sf));
    }
  });
}
