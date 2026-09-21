/**
 * Reject bare structural object aliases / interfaces in `.sts` via AST.
 *
 * Domain objects must be authored as `validate type` or `brand type` so they
 * expand to a phantom brand + companions. Silently wrapping a bare `type`
 * alias in a phantom brand is out of scope — fail expand instead.
 *
 * Dialect decls are skipped using offsets recorded while blanking
 * `brand` / `validate` before `createSourceFile` (see `ast.ts`).
 *
 * Note (outbound widen): a `validate type User` value remains assignable to
 * the naked `{ id: string }` structure under stock `tsc` (excess-property
 * checking only applies to fresh object literals). That direction is a stock
 * TypeScript hole and is not closed by this check.
 */

import * as ts from "typescript";
import {
  createSoundnessAst,
  isDialectTypeAlias,
  walkAst,
} from "./ast.js";

function formatWhere(filename: string | undefined, offset: number): string {
  const loc = filename ? `${filename}:` : "offset ";
  return `${loc}${offset}`;
}

/**
 * Throw if source contains a bare `type Name = { … }` object alias or an
 * `interface` declaration. Non-object aliases (`type X = string`, unions of
 * brands, etc.) are allowed.
 */
export function assertNoStructuralAliases(
  source: string,
  filename?: string,
): void {
  const { sf, dialectTypeOffsets } = createSoundnessAst(source, filename);

  walkAst(sf, (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      throw new SyntaxError(
        `structural interface '${name}' is not allowed in .sts ` +
          `(${formatWhere(filename, node.getStart(sf))}); ` +
          `use 'validate type' or 'brand type' instead`,
      );
    }

    if (!ts.isTypeAliasDeclaration(node)) return;
    if (isDialectTypeAlias(node, sf, dialectTypeOffsets)) return;

    // Same accept matrix as the old scan: only when the aliased type is a
    // bare object TypeLiteral (`type Name = { … }`), not `Readonly<{…}>` etc.
    if (!ts.isTypeLiteralNode(node.type)) return;

    const name = node.name.text;
    throw new SyntaxError(
      `structural object alias '${name}' is not allowed in .sts ` +
        `(${formatWhere(filename, node.getStart(sf))}); ` +
        `use 'validate type' or 'brand type' instead`,
    );
  });
}
