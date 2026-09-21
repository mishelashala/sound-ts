/**
 * Reject wide TypeScript types that act like a weaker `any`:
 * `Object`, `Function`, and the empty object type `{}`.
 *
 * Visits type-position AST nodes only — value `Object.keys`, empty object
 * literals (`{}` as ObjectLiteralExpression), lowercase `object`, real shapes,
 * and function type literals stay legal. Does not rewrite to `unknown`.
 */

import * as ts from "typescript";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

function throwWide(
  kind: "Object" | "Function" | "{}",
  filename: string | undefined,
  source: string,
  offset: number,
): never {
  const { prefix } = formatLoc(filename, source, offset);
  throw new SyntaxError(
    `${prefix}type '${kind}' is too wide for .sts ` +
      `(same hole as a weaker any). Use a specific type, lowercase object, ` +
      `a real object shape, or a function type literal — not rewritten to unknown.`,
  );
}

/**
 * Fail expand when `Object`, `Function`, or empty object type `{}` appear
 * in a type position. Empty object *literals* are left alone.
 */
export function assertNoWideTypes(
  source: string,
  filename?: string,
): void {
  const { sf, source: orig } = createSoundnessAst(source, filename);

  walkAst(sf, (node) => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (name === "Object" || name === "Function") {
        throwWide(name, filename, orig, node.getStart(sf));
      }
      return;
    }

    // Bare empty object type `{}` — TypeLiteral with no members.
    // `{ id: string }` has members; value `= {}` is ObjectLiteralExpression.
    if (ts.isTypeLiteralNode(node) && node.members.length === 0) {
      throwWide("{}", filename, orig, node.getStart(sf));
    }
  });
}
