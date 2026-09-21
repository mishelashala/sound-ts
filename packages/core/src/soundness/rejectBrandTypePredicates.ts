/**
 * 1.0 FFI / unsafe boundary: dialect brands enter only via cast<> / .from.
 *
 * Reject author-written type predicates and assertion predicates that refine
 * to a known dialect companion name. Mode B `is` lives in DialectProgram and
 * is not present as a TypePredicateNode in the blanked SourceFile.
 */

import * as ts from "typescript";
import type { DialectProjectSymbols } from "../symbols/types.js";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

function predicateTargetName(pred: ts.TypePredicateNode): string | undefined {
  if (!pred.type) return undefined;
  if (ts.isTypeReferenceNode(pred.type) && ts.isIdentifier(pred.type.typeName)) {
    return pred.type.typeName.text;
  }
  return undefined;
}

/**
 * Throw if `source` contains `x is Brand` / `asserts x is Brand` for a
 * dialect companion in `symbols`.
 */
export function assertNoBrandTypePredicates(
  source: string,
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  if (symbols.byName.size === 0) return;

  const { sf } = createSoundnessAst(source, filename);
  walkAst(sf, (node) => {
    if (!ts.isTypePredicateNode(node)) return;
    const target = predicateTargetName(node);
    if (target === undefined) return;
    if (!symbols.byName.has(target)) return;

    const at = node.getStart(sf);
    const { prefix } = formatLoc(filename, source, at);
    const kind = node.assertsModifier ? "assertion predicate" : "type predicate";
    throw new SyntaxError(
      `${prefix}${kind} refining dialect companion '${target}' is not allowed ` +
        `in .sts (offset ${at}); untrusted values enter brands only through ` +
        `cast<> or ${target}.from(…) — user predicates are not proof`,
    );
  });
}
