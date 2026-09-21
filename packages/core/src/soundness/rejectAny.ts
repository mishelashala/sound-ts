/**
 * Reject `any` in type positions in `.sts` source via TypeScript AST.
 * Does not rewrite `any` → `unknown`. Value-named `any` is an Identifier, not AnyKeyword.
 */

import * as ts from "typescript";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

/**
 * Throw if `source` uses `any` as a type. Leaves `unknown` alone.
 */
export function assertNoAny(source: string, filename?: string): void {
  const { sf, source: orig } = createSoundnessAst(source, filename);
  walkAst(sf, (node) => {
    if (node.kind !== ts.SyntaxKind.AnyKeyword) return;
    const start = node.getStart(sf);
    const { prefix } = formatLoc(filename, orig, start);
    throw new SyntaxError(
      `${prefix}\`any\` is not allowed in .sts type positions (use \`unknown\` for untrusted input, then cast<> / .from). ` +
        `any is not rewritten to unknown.`,
    );
  });
}
