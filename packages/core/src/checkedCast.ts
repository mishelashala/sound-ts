/**
 * Checked casts: `expr as! Target`
 *
 * Target may be a primitive (`string` | `number` | `boolean`) or a known
 * companion name from the project map (`brand type` / `validate type`).
 * Primitives emit an inline typeof check; companions delegate to `.from`.
 */

import { maskCommentsAndStrings } from "./parse.js";

const PRIMITIVES = new Set(["string", "number", "boolean"]);

export interface CheckedCastSite {
  /** Start of the full `expr as! Target` span */
  start: number;
  /** End of the span */
  end: number;
  /** Operand expression text */
  expr: string;
  /** Target type name (primitive or companion) */
  target: string;
}

export interface RewriteCheckedCastsOptions {
  /** Companion names known in the transform batch (brands + validate types) */
  companionNames: ReadonlySet<string>;
  /** Optional filename for diagnostics */
  filename?: string;
}

function skipWsBack(source: string, i: number): number {
  while (i > 0 && /[\s\n\r\t]/.test(source[i - 1]!)) i--;
  return i;
}

/**
 * Find the start index of a checked-cast operand ending at `asIndex`
 * (`asIndex` points at the `a` of `as`). Uses a masked scan string so
 * strings/comments do not confuse paren balancing.
 */
function findOperandStart(masked: string, asIndex: number): number {
  const end = skipWsBack(masked, asIndex);
  if (end === 0) {
    throw new SyntaxError("as!: expected expression before checked cast");
  }

  if (masked[end - 1] === ")") {
    let depth = 0;
    for (let j = end - 1; j >= 0; j--) {
      const c = masked[j]!;
      if (c === ")") depth++;
      else if (c === "(") {
        depth--;
        if (depth === 0) {
          const before = masked.slice(0, j);
          const callee = before.match(
            /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$/,
          );
          if (callee && callee.index !== undefined) {
            return callee.index;
          }
          return j;
        }
      }
    }
    throw new SyntaxError("as!: unbalanced '(' in checked cast operand");
  }

  const before = masked.slice(0, end);
  const m = before.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$/);
  if (!m || m.index === undefined) {
    throw new SyntaxError(
      "as!: checked cast operand must be an identifier, member access, call, or parenthesized expression",
    );
  }
  return m.index;
}

/**
 * Collect `as!` sites from source (comment/string safe).
 * Does not validate targets — that happens at rewrite time against the map.
 */
export function findCheckedCasts(source: string): CheckedCastSite[] {
  const masked = maskCommentsAndStrings(source);
  const sites: CheckedCastSite[] = [];
  const re = /\bas\s*!/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    const asStart = m.index;
    let i = skipWsBack(masked, asStart); // unused; operand ends before as
    void i;
    const afterBang = m.index + m[0].length;
    let pos = afterBang;
    while (pos < masked.length && /[\s\n\r\t]/.test(masked[pos]!)) pos++;
    const targetTok = source.slice(pos).match(/^[A-Za-z_$][\w$]*/);
    if (!targetTok) {
      throw new SyntaxError(
        `as!: expected type name after checked cast (offset ${asStart})`,
      );
    }
    const target = targetTok[0]!;
    const targetEnd = pos + target.length;
    const exprStart = findOperandStart(masked, asStart);
    const exprEnd = skipWsBack(masked, asStart);
    sites.push({
      start: exprStart,
      end: targetEnd,
      expr: source.slice(exprStart, exprEnd),
      target,
    });
    re.lastIndex = targetEnd;
  }

  return sites;
}

function emitPrimitiveCast(expr: string, target: string): string {
  return (
    `(((__v: unknown): ${target} => {` +
    ` if (typeof __v === "${target}") return __v;` +
    ` const preview = typeof __v === "string" ? JSON.stringify(__v) : \`typeof \${typeof __v}\`;` +
    ` throw new Error(\`Checked cast to ${target} failed: \${preview}\`);` +
    ` })(${expr}))`
  );
}

function emitCompanionCast(expr: string, target: string): string {
  return `${target}.from(${expr})`;
}

/**
 * Rewrite every `as!` in `source`. Throws if a target is neither a primitive
 * nor a known companion name in the batch.
 */
export function rewriteCheckedCasts(
  source: string,
  options: RewriteCheckedCastsOptions,
): { code: string; count: number } {
  const sites = findCheckedCasts(source);
  if (sites.length === 0) {
    return { code: source, count: 0 };
  }

  const where = options.filename ? ` (${options.filename})` : "";
  for (const site of sites) {
    if (PRIMITIVES.has(site.target)) continue;
    if (options.companionNames.has(site.target)) continue;
    throw new SyntaxError(
      `as! ${site.target}: '${site.target}' is not a primitive or known companion` +
        `${where} (checked casts may target string | number | boolean, or a ` +
        `brand type / validate type declared in the transform input)`,
    );
  }

  const ordered = [...sites].sort((a, b) => b.start - a.start);
  let out = source;
  for (const site of ordered) {
    const replacement = PRIMITIVES.has(site.target)
      ? emitPrimitiveCast(site.expr, site.target)
      : emitCompanionCast(site.expr, site.target);
    out = out.slice(0, site.start) + replacement + out.slice(site.end);
  }
  return { code: out, count: sites.length };
}
