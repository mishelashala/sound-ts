/**
 * Reject bare structural object aliases / interfaces in `.sts`.
 *
 * Domain objects must be authored as `validate type` or `brand type` so they
 * expand to a phantom brand + companions. Silently wrapping a bare `type`
 * alias in a phantom brand is out of scope — fail expand instead.
 *
 * Note (outbound widen): a `validate type User` value remains assignable to
 * the naked `{ id: string }` structure under stock `tsc` (excess-property
 * checking only applies to fresh object literals). That direction is a stock
 * TypeScript hole and is not closed by this check.
 */

import { maskCommentsAndStrings } from "../parse.js";

function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

/** True when `type` at `typeIdx` is the `type` in `brand type` / `validate type`. */
function isDialectTypeKeyword(scan: string, typeIdx: number): boolean {
  let i = typeIdx;
  while (i > 0 && /[\s\n\r\t]/.test(scan[i - 1]!)) i--;
  const before = scan.slice(Math.max(0, i - 8), i);
  if (/(?:^|[^A-Za-z0-9_$])brand$/.test(before)) return true;
  if (/(?:^|[^A-Za-z0-9_$])validate$/.test(before)) return true;
  return false;
}

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
  const scan = maskCommentsAndStrings(source);

  // Interfaces are always structural object shapes.
  const ifaceRe = /\binterface\s+([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = ifaceRe.exec(scan)) !== null) {
    const name = m[1]!;
    throw new SyntaxError(
      `structural interface '${name}' is not allowed in .sts ` +
        `(${formatWhere(filename, m.index)}); ` +
        `use 'validate type' or 'brand type' instead`,
    );
  }

  // Object type aliases: `type Name = { … }` (optional export / generics).
  // Skip `brand type` / `validate type` headers.
  const typeRe =
    /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^;={}]*>)?\s*=/g;
  while ((m = typeRe.exec(scan)) !== null) {
    const typeKw = m[0]!.search(/\btype\b/);
    const typeIdx = m.index + (typeKw >= 0 ? typeKw : 0);
    if (isDialectTypeKeyword(scan, typeIdx)) continue;

    const name = m[1]!;
    let afterEq = skipWs(scan, m.index + m[0]!.length);
    if (scan[afterEq] !== "{") continue;

    throw new SyntaxError(
      `structural object alias '${name}' is not allowed in .sts ` +
        `(${formatWhere(filename, m.index)}); ` +
        `use 'validate type' or 'brand type' instead`,
    );
  }
}
