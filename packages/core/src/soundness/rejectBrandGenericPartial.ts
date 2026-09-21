/**
 * 1.0 generics / variance — conservative subset.
 *
 * Reject `Partial<Brand>` and `Required<Brand>` when Brand is a dialect
 * companion. Those mapped types optionalize / remap the phantom brand arm and
 * reopen structural entry. Broader variance is deferred (see SOUNDNESS_1_0.md).
 */

import * as ts from "typescript";
import type { DialectProjectSymbols } from "../symbols/types.js";
import { createSoundnessAst, formatLoc, walkAst } from "./ast.js";

const BLOCKED_UTILITIES = new Set(["Partial", "Required"]);

function firstTypeArgName(ref: ts.TypeReferenceNode): string | undefined {
  const arg = ref.typeArguments?.[0];
  if (!arg) return undefined;
  if (ts.isTypeReferenceNode(arg) && ts.isIdentifier(arg.typeName)) {
    return arg.typeName.text;
  }
  return undefined;
}

/**
 * Throw when `Partial` / `Required` is applied to a dialect companion name.
 */
export function assertBrandGenericSubset(
  source: string,
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  if (symbols.byName.size === 0) return;

  const { sf } = createSoundnessAst(source, filename);
  walkAst(sf, (node) => {
    if (!ts.isTypeReferenceNode(node)) return;
    if (!ts.isIdentifier(node.typeName)) return;
    const utility = node.typeName.text;
    if (!BLOCKED_UTILITIES.has(utility)) return;

    const brand = firstTypeArgName(node);
    if (brand === undefined) return;
    if (!symbols.byName.has(brand)) return;

    const at = node.getStart(sf);
    const { prefix } = formatLoc(filename, source, at);
    throw new SyntaxError(
      `${prefix}${utility}<${brand}> is not allowed in .sts (offset ${at}); ` +
        `mapped utilities weaken the phantom brand on dialect companions — ` +
        `keep brands intact (Readonly<${brand}> / ReadonlyArray<${brand}> are ok)`,
    );
  });
}
