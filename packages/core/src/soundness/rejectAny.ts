import { maskCommentsAndStrings } from "../parse.js";

/**
 * Reject `any` in type positions in `.sts` source.
 * Does not rewrite `any` → `unknown`. Value-named `any` is best-effort ignored.
 */

function locPrefix(filename: string | undefined, source: string, index: number): string {
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
  while (i >= 0 && /\s/.test(scan[i]!)) i--;
  return i;
}

function skipWsFwd(scan: string, i: number): number {
  while (i < scan.length && /\s/.test(scan[i]!)) i++;
  return i;
}

/** True when `any` at `start` is used as a type (not a value binding / key). */
function isTypePositionAny(scan: string, start: number): boolean {
  const end = start + 3;
  const after = skipWsFwd(scan, end);
  const afterCh = scan[after];

  // Property / label / definite-assignment name: `any:` or `any!:`
  if (afterCh === ":" || (afterCh === "!" && scan[skipWsFwd(scan, after + 1)] === ":")) {
    return false;
  }

  // any[] / any<>
  if (afterCh === "[" || afterCh === "<") return true;
  // any | T / any & T / end of generic arg
  if (afterCh === "|" || afterCh === "&" || afterCh === ">" || afterCh === ",") {
    return true;
  }

  const before = skipWsBack(scan, start - 1);
  if (before < 0) return false;
  const prev = scan[before]!;

  // : any  |  <any  |  |any  |  &any
  if (prev === ":" || prev === "<" || prev === "|" || prev === "&") {
    return true;
  }

  // Foo<string, any> — comma before; avoid import { foo, any }
  if (prev === ",") {
    if (afterCh === ">" || afterCh === "," || afterCh === "[" || afterCh === "|" || afterCh === "&") {
      return true;
    }
    // type-only trailing comma before `>` already handled; bare `}` → import/destructure
    return false;
  }

  // as any
  const aheadOfAny = scan.slice(Math.max(0, start - 12), start);
  if (/(?:^|[^\w$])as\s+$/.test(aheadOfAny)) return true;

  // is any / satisfies any / extends any / keyof any / infer any / readonly any
  if (
    /(?:^|[^\w$])(?:is|satisfies|extends|keyof|infer|readonly)\s+$/.test(aheadOfAny)
  ) {
    return true;
  }

  // type Alias = any  (not const x = any)
  if (prev === "=") {
    const head = scan.slice(0, start);
    if (
      /(?:^|[^\w$])(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*(?:<[^<>]*>)?\s*=\s*$/.test(
        head,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Throw if `source` uses `any` as a type. Leaves `unknown` alone.
 */
export function assertNoAny(source: string, filename?: string): void {
  const scan = maskCommentsAndStrings(source);
  const re = /\bany\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    const start = m.index;
    if (!isTypePositionAny(scan, start)) continue;
    const where = locPrefix(filename, source, start);
    throw new SyntaxError(
      `${where}\`any\` is not allowed in .sts type positions (use \`unknown\` for untrusted input, then cast<> / .from). ` +
        `any is not rewritten to unknown.`,
    );
  }
}
