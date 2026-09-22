/**
 * Offset-preserving mask of comments, string/template literals, and regex literals.
 * Used by the dialect scanner (discovery) and by text-based soundness bans.
 */

/**
 * Keywords after which `/` starts a regex literal (an expression is allowed).
 * Other identifiers, including `true` / `false` / `null` / `this`, end an
 * expression, so the next `/` is division.
 */
const BEFORE_EXPR = new Set([
  "await",
  "case",
  "default",
  "delete",
  "else",
  "extends",
  "in",
  "infer",
  "instanceof",
  "keyof",
  "new",
  "of",
  "readonly",
  "return",
  "satisfies",
  "throw",
  "typeof",
  "unique",
  "void",
  "yield",
]);

/**
 * Mask line comments, block comments, strings, template literals, and regex
 * literals with spaces (same length) so a subsequent scan cannot match inside
 * them while offsets still point into the original source.
 *
 * Template literals are masked as a single span (including any `${…}`); we do
 * not re-enter expression mode inside `${}`.
 *
 * `/` is a regex only when an expression is allowed (after `=`, `(`, `[`,
 * `return`, and other before-expr tokens). After a value it is division, so
 * `total / width` stays visible. A `/` after `}` is treated as a regex when
 * the literal closes on that line; division written `} / a / b` on one line
 * can be blanked.
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  let slashIsRegex: boolean = true;

  while (i < source.length) {
    const c = source[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }

    if (c === "/" && source[i + 1] === "/") {
      blank(out, i, i + 2);
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        out[i] = " ";
        i++;
      }
      continue;
    }

    if (c === "/" && source[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      blank(out, start, i);
      continue;
    }

    if (c === '"' || c === "'") {
      const end = scanString(source, i);
      blank(out, i, end);
      i = end;
      slashIsRegex = false;
      continue;
    }

    if (c === "`") {
      const end = scanTemplate(source, i);
      blank(out, i, end);
      i = end;
      slashIsRegex = false;
      continue;
    }

    // Prefix `++`/`--` still expects an expression; postfix does not.
    // Leaving the flag unchanged covers both.
    if ((c === "+" || c === "-") && source[i + 1] === c) {
      i += 2;
      continue;
    }

    if (c === "/") {
      if (slashIsRegex) {
        const end = scanRegexLiteral(source, i);
        if (end !== -1) {
          blank(out, i, end);
          i = end;
          slashIsRegex = false;
          continue;
        }
      }
      i += source[i + 1] === "=" ? 2 : 1;
      slashIsRegex = true;
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(source[i + 1] ?? ""))) {
      i = scanNumber(source, i);
      slashIsRegex = false;
      continue;
    }

    if (c === "." && source[i + 1] === "." && source[i + 2] === ".") {
      i += 3;
      slashIsRegex = true;
      continue;
    }

    if (c === ".") {
      i++;
      slashIsRegex = false;
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      i++;
      while (i < source.length && isIdentPart(source[i]!)) i++;
      slashIsRegex = BEFORE_EXPR.has(source.slice(start, i));
      continue;
    }

    const op = matchOperator(source, i);
    if (op) {
      i += op.len;
      slashIsRegex = op.beforeExpr;
      continue;
    }

    i++;
  }

  return out.join("");
}

function blank(out: string[], start: number, end: number): void {
  for (let k = start; k < end; k++) {
    const ch = out[k];
    if (ch !== "\n" && ch !== "\r") out[k] = " ";
  }
}

function scanString(source: string, i: number): number {
  const quote = source[i]!;
  i++;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += i + 1 < source.length ? 2 : 1;
      continue;
    }
    i++;
    if (ch === quote) break;
    if (ch === "\n" || ch === "\r") break;
  }
  return i;
}

function scanTemplate(source: string, i: number): number {
  i++;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += i + 1 < source.length ? 2 : 1;
      continue;
    }
    i++;
    if (ch === "`") break;
  }
  return i;
}

/**
 * Scan a regex literal starting at `start` (`/`). Returns the exclusive end,
 * or -1 when the slash does not close on this line (treat it as division).
 */
function scanRegexLiteral(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\n" || ch === "\r") return -1;
    if (ch === "\\") {
      if (i + 1 >= source.length || source[i + 1] === "\n" || source[i + 1] === "\r") {
        return -1;
      }
      i += 2;
      continue;
    }
    if (ch === "[" && !inClass) {
      inClass = true;
      i++;
      continue;
    }
    if (ch === "]" && inClass) {
      inClass = false;
      i++;
      continue;
    }
    if (ch === "/" && !inClass) {
      i++;
      while (i < source.length && isIdentPart(source[i]!)) i++;
      return i;
    }
    i++;
  }
  return -1;
}

function scanNumber(source: string, i: number): number {
  const next = source[i + 1];
  if (
    source[i] === "0" &&
    next !== undefined &&
    (next === "x" || next === "X" || next === "b" || next === "B" || next === "o" || next === "O")
  ) {
    i += 2;
    while (i < source.length && isHexOrSep(source[i]!)) i++;
    return i;
  }
  while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
  if (source[i] === "." && isDigit(source[i + 1] ?? "")) {
    i++;
    while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
  }
  if (source[i] === "e" || source[i] === "E") {
    let j = i + 1;
    if (source[j] === "+" || source[j] === "-") j++;
    if (isDigit(source[j] ?? "")) {
      i = j + 1;
      while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
    }
  }
  if (source[i] === "n") i++;
  return i;
}

/** Longest-match operators. `beforeExpr` is whether `/` after this token is a regex. */
const OPERATORS: ReadonlyArray<readonly [string, boolean]> = [
  [">>>=", true],
  [">>=", true],
  ["<<=", true],
  [">>>", true],
  ["&&=", true],
  ["||=", true],
  ["??=", true],
  ["===", true],
  ["!==", true],
  ["**=", true],
  ["==", true],
  ["!=", true],
  ["<=", true],
  [">=", true],
  ["&&", true],
  ["||", true],
  ["??", true],
  ["?.", false],
  ["=>", true],
  ["<<", true],
  [">>", true],
  ["**", true],
  ["+=", true],
  ["-=", true],
  ["*=", true],
  ["%=", true],
  ["&=", true],
  ["|=", true],
  ["^=", true],
  ["(", true],
  [")", false],
  ["[", true],
  ["]", false],
  ["{", true],
  ["}", true],
  [",", true],
  [";", true],
  ["?", true],
  [":", true],
  ["~", true],
  ["!", true],
  ["=", true],
  ["<", true],
  [">", true],
  ["+", true],
  ["-", true],
  ["*", true],
  ["%", true],
  ["&", true],
  ["|", true],
  ["^", true],
];

function matchOperator(
  source: string,
  i: number,
): { len: number; beforeExpr: boolean } | undefined {
  for (const [op, beforeExpr] of OPERATORS) {
    if (source.startsWith(op, i)) return { len: op.length, beforeExpr };
  }
  return undefined;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexOrSep(ch: string): boolean {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F") || ch === "_";
}

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
}

function isIdentPart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return isIdentStart(ch) || (c >= 48 && c <= 57);
}
