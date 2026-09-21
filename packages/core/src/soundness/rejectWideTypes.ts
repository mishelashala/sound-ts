/**
 * Reject wide TypeScript types that act like a weaker `any`:
 * `Object`, `Function`, and the empty object type `{}`.
 *
 * Does **not** rewrite them to `unknown` — expand fails instead.
 * Lowercase `object`, real shapes (`{ id: string }`), function type literals
 * (`(n: number) => void`), and empty object *values* (`const empty = {}`)
 * stay legal. `any` is left to a separate check.
 */

import { maskCommentsAndStrings } from "../parse.js";

function locPrefix(
  filename: string | undefined,
  source: string,
  index: number,
): string {
  if (filename === undefined) return "";
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
  return `${filename}:${line}:${col}: `;
}

function skipWsBack(scan: string, i: number): number {
  while (i >= 0 && /[\s\n\r\t]/.test(scan[i]!)) i--;
  return i;
}

/** True when `end` is the last index of an isolated word `word` in `scan`. */
function endsWithWord(scan: string, end: number, word: string): boolean {
  const start = end - word.length + 1;
  if (start < 0) return false;
  if (scan.slice(start, end + 1) !== word) return false;
  if (start > 0 && /[A-Za-z0-9_$]/.test(scan[start - 1]!)) return false;
  return true;
}

/**
 * `=` before a candidate: type alias / type-param default → type position;
 * assignment / default value → value position.
 */
function isEqualsTypeContext(scan: string, eqIdx: number): boolean {
  let i = skipWsBack(scan, eqIdx - 1);
  if (i < 0) return false;

  // Skip a trailing identifier (alias name or type-param name).
  if (!/[A-Za-z0-9_$]/.test(scan[i]!)) return false;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(scan[i]!)) i--;
  i = skipWsBack(scan, i);

  // Type parameter default: `<T = {}>` or `<A, B = Object>`
  if (i >= 0 && (scan[i] === "<" || scan[i] === ",")) return true;

  // Optional generics on a type alias: `type Foo<T> = {}`
  if (i >= 0 && scan[i] === ">") {
    let depth = 1;
    i--;
    while (i >= 0 && depth > 0) {
      const c = scan[i]!;
      if (c === ">") depth++;
      else if (c === "<") depth--;
      i--;
    }
    i = skipWsBack(scan, i);
    if (i < 0) return false;
    if (!/[A-Za-z0-9_$]/.test(scan[i]!)) return false;
    while (i >= 0 && /[A-Za-z0-9_$]/.test(scan[i]!)) i--;
    i = skipWsBack(scan, i);
  }

  // `type Name = …` / `export type Name = …`
  if (i >= 0 && endsWithWord(scan, i, "type")) return true;

  return false;
}

/**
 * Whether `index` starts a type (not value) occurrence.
 * Heuristic over a comment/string-masked scan — good enough for dialect expand.
 */
function isTypePosition(scan: string, index: number): boolean {
  let i = skipWsBack(scan, index - 1);
  if (i < 0) return false;

  const c = scan[i]!;
  if (c === ":" || c === "|" || c === "&" || c === "<" || c === ",") {
    return true;
  }
  if (c === "=") {
    return isEqualsTypeContext(scan, i);
  }

  if (endsWithWord(scan, i, "as")) return true;
  if (endsWithWord(scan, i, "extends")) return true;
  if (endsWithWord(scan, i, "implements")) return true;
  if (endsWithWord(scan, i, "satisfies")) return true;
  if (endsWithWord(scan, i, "keyof")) return true;
  if (endsWithWord(scan, i, "infer")) return true;
  // Type predicate: `x is Object`
  if (endsWithWord(scan, i, "is")) return true;

  return false;
}

function throwWide(
  kind: "Object" | "Function" | "{}",
  filename: string | undefined,
  source: string,
  offset: number,
): never {
  const where = locPrefix(filename, source, offset);
  throw new SyntaxError(
    `${where}type '${kind}' is too wide for .sts ` +
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
  const scan = maskCommentsAndStrings(source);

  // Capital Object / Function identifiers in type position only.
  const identRe = /\b(Object|Function)\b/g;
  let m: RegExpExecArray | null;
  while ((m = identRe.exec(scan)) !== null) {
    const name = m[1] as "Object" | "Function";
    if (isTypePosition(scan, m.index)) {
      throwWide(name, filename, source, m.index);
    }
  }

  // Bare empty object type `{}` — not `{ id: string }` and not value `= {}`.
  const emptyRe = /\{\s*\}/g;
  while ((m = emptyRe.exec(scan)) !== null) {
    if (isTypePosition(scan, m.index)) {
      throwWide("{}", filename, source, m.index);
    }
  }
}
