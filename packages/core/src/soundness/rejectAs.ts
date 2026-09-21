/**
 * Reject TypeScript type assertions in `.sts` sources.
 *
 * Brand entry stays `cast<>` / `.from`. `as const` is allowed (literal
 * narrowing, not a brand punch-through). Import/export binding renames are
 * not assertions.
 */

import { maskCommentsAndStrings } from "../parse.js";

const IDENT = /[A-Za-z_$][\w$]*/;

function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

/**
 * Blank `import` statements and `export { … }` / `export * as` binding forms
 * so `as` renames are not treated as type assertions. Leaves `export const`
 * (and similar) alone — those may still contain real assertions.
 */
function maskImportExportBindings(scan: string): string {
  const out = scan.split("");

  const blankRange = (start: number, end: number) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  };

  // Full `import …;` statements (renames live only here for imports).
  const importRe = /\bimport\b/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(scan)) !== null) {
    let i = m.index;
    while (i < scan.length && scan[i] !== ";") i++;
    if (i < scan.length) i++;
    blankRange(m.index, i);
  }

  // `export * as Name from "…"` / `export * from "…"`
  const exportStarRe = /\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\b/g;
  while ((m = exportStarRe.exec(scan)) !== null) {
    let i = m.index;
    while (i < scan.length && scan[i] !== ";") i++;
    if (i < scan.length) i++;
    blankRange(m.index, i);
  }

  // `export { a as b, … }` / `export { a as b } from "…"`
  const exportBraceRe = /\bexport\s*\{/g;
  while ((m = exportBraceRe.exec(scan)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < scan.length && depth > 0) {
      const c = scan[i]!;
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    i = skipWs(scan, i);
    if (/^from\b/.test(scan.slice(i))) {
      while (i < scan.length && scan[i] !== ";") i++;
      if (i < scan.length) i++;
    } else if (scan[i] === ";") {
      i++;
    }
    blankRange(m.index, i);
  }

  return out.join("");
}

function findAsAssertion(scan: string): number {
  const re = /\bas\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    const start = m.index;
    // Must be a keyword boundary on the left (already via \b).
    let pos = skipWs(scan, start + 2);
    if (/^const\b/.test(scan.slice(pos))) continue;

    // Expect a type-like token after `as` (ident, `{`, `(`, `[`, …).
    const rest = scan.slice(pos);
    const startsType =
      new RegExp(`^${IDENT.source}`).test(rest) ||
      rest.startsWith("{") ||
      rest.startsWith("(") ||
      rest.startsWith("[") ||
      rest.startsWith("'") ||
      rest.startsWith('"') ||
      rest.startsWith("`");
    if (!startsType) continue;
    return start;
  }
  return -1;
}

function findAngleBracketAssertion(scan: string, source: string): number {
  for (let i = 0; i < scan.length; i++) {
    if (scan[i] !== "<") continue;

    let prev = i - 1;
    while (prev >= 0 && /[\s\n\r\t]/.test(scan[prev]!)) prev--;
    // Generics / `cast<…>`: identifier immediately before `<`.
    if (prev >= 0 && isWordChar(scan[prev])) continue;

    let pos = skipWs(scan, i + 1);
    const name = scan.slice(pos).match(IDENT);
    if (!name) continue;
    pos = skipWs(scan, pos + name[0].length);

    // Optional simple type args are out of scope; assertion target is one ident.
    if (scan[pos] !== ">") continue;
    const afterGt = pos + 1;

    // Use original source: strings are masked in `scan`, but `<T>"lit"` is valid.
    const exprPos = skipWs(source, afterGt);
    const next = source[exprPos];
    if (next === undefined) continue;
    if (
      isWordChar(next) ||
      next === '"' ||
      next === "'" ||
      next === "`" ||
      next === "(" ||
      next === "[" ||
      next === "{" ||
      next === "+" ||
      next === "-" ||
      next === "!" ||
      next === "~" ||
      /[0-9]/.test(next)
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Throw if `source` contains `expr as Type` or `<Type>expr`.
 * Does not rewrite assertions into `cast<>`.
 * Ordinary `.ts` / `.tsx` files are left to stock `tsc`.
 */
export function assertNoTypeAssertions(
  source: string,
  filename?: string,
): void {
  if (
    filename !== undefined &&
    !filename.endsWith(".sts")
  ) {
    return;
  }
  const masked = maskImportExportBindings(maskCommentsAndStrings(source));
  const asAt = findAsAssertion(masked);
  if (asAt >= 0) {
    throw new SyntaxError(
      `type assertion with 'as' is not allowed in .sts (offset ${asAt}); use cast<> or Name.from(…)`,
    );
  }
  const angleAt = findAngleBracketAssertion(masked, source);
  if (angleAt >= 0) {
    throw new SyntaxError(
      `angle-bracket type assertion is not allowed in .sts (offset ${angleAt}); use cast<> or Name.from(…)`,
    );
  }
}
