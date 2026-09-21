/**
 * Reject postfix non-null assertions (`value!`) and definite-assignment
 * assertions (`prop!: Type`) in `.sts` source.
 *
 * Does not delete or rewrite `!`. Boolean not (`!cond`) and `!=` / `!==`
 * stay legal. Type assertions (`as`) are issue #36 — out of scope here.
 */

import { maskCommentsAndStrings } from "../parse.js";

/** Keywords that introduce an expression; `!` after them is boolean not. */
const PREFIX_NOT_KEYWORDS = new Set([
  "return",
  "throw",
  "typeof",
  "void",
  "delete",
  "await",
  "yield",
  "new",
  "case",
  "else",
  "do",
  "in",
  "of",
  "instanceof",
  "with",
]);

function skipWsBack(scan: string, i: number): number {
  while (i >= 0 && /[\s\n\r\t]/.test(scan[i]!)) i--;
  return i;
}

function readIdentBack(scan: string, endIncl: number): string | null {
  if (endIncl < 0 || !/[A-Za-z0-9_$]/.test(scan[endIncl]!)) return null;
  let start = endIncl;
  while (start > 0 && /[A-Za-z0-9_$]/.test(scan[start - 1]!)) start--;
  if (!/[A-Za-z_$]/.test(scan[start]!)) return null;
  return scan.slice(start, endIncl + 1);
}

/**
 * True when `!` at `i` is a postfix non-null or definite-assignment assertion.
 * False for `!=` / `!==`, prefix boolean not, and masked comment/string noise.
 */
function isNonNullOrDefiniteAssignment(scan: string, i: number): boolean {
  if (scan[i] !== "!") return false;
  // != / !==
  if (scan[i + 1] === "=") return false;

  const prev = skipWsBack(scan, i - 1);
  if (prev < 0) return false;

  const ch = scan[prev]!;

  // Closing tokens always end a primary / member expression.
  if (ch === ")" || ch === "]" || ch === "}") return true;

  // Identifier or number: `value!`, `foo.bar!`, `prop!: T`, `42!`
  if (/[A-Za-z0-9_$]/.test(ch)) {
    const ident = readIdentBack(scan, prev);
    if (ident !== null && PREFIX_NOT_KEYWORDS.has(ident)) return false;
    return true;
  }

  return false;
}

function formatWhere(
  filename: string | undefined,
  source: string,
  index: number,
): string {
  if (filename === undefined) return `offset ${index}`;
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return `${filename}:${line}:${col}`;
}

/**
 * Throw if `source` uses postfix `!` or definite-assignment `!`.
 * Does not strip the `!` and continue.
 */
export function assertNoNonNullAssertions(
  source: string,
  filename?: string,
): void {
  const scan = maskCommentsAndStrings(source);
  for (let i = 0; i < scan.length; i++) {
    if (!isNonNullOrDefiniteAssignment(scan, i)) continue;
    const where = formatWhere(filename, source, i);
    throw new SyntaxError(
      `non-null / definite-assignment '!' is not allowed in .sts (${where}); ` +
        `narrow with a check instead (do not use '!' to assert away null | undefined)`,
    );
  }
}
