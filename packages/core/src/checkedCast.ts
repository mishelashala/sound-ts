/**
 * Checked casts: `cast<Target>(expr)`
 *
 * Target may be a primitive (`string` | `number` | `boolean`) or a known
 * companion name from the project map (`brand type` / `validate type`).
 * Primitives emit an inline typeof check; companions delegate to `.from`.
 */

import { maskCommentsAndStrings } from "./parse.js";

const PRIMITIVES = new Set(["string", "number", "boolean"]);

export interface CheckedCastSite {
  /** Start of the full `cast<Target>(expr)` span */
  start: number;
  /** End of the span (after closing `)`) */
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

function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

/**
 * Collect `cast<Target>(expr)` sites from source (comment/string safe).
 * Does not validate targets — that happens at rewrite time against the map.
 */
export function findCheckedCasts(source: string): CheckedCastSite[] {
  const masked = maskCommentsAndStrings(source);
  const sites: CheckedCastSite[] = [];
  const re = /\bcast\s*</g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    const castStart = m.index;
    let pos = skipWs(masked, m.index + m[0].length);

    const targetTok = source.slice(pos).match(/^[A-Za-z_$][\w$]*/);
    if (!targetTok) {
      throw new SyntaxError(
        `cast: expected type name after 'cast<' (offset ${castStart})`,
      );
    }
    const target = targetTok[0]!;
    pos += target.length;
    pos = skipWs(masked, pos);

    if (masked[pos] !== ">") {
      throw new SyntaxError(
        `cast: expected '>' after type name (offset ${castStart})`,
      );
    }
    pos = skipWs(masked, pos + 1);

    if (masked[pos] !== "(") {
      throw new SyntaxError(
        `cast: expected '(' after cast<Target> (offset ${castStart})`,
      );
    }
    const openParen = pos;
    let depth = 0;
    let closeParen = -1;
    for (let j = openParen; j < masked.length; j++) {
      const c = masked[j]!;
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          closeParen = j;
          break;
        }
      }
    }
    if (closeParen < 0) {
      throw new SyntaxError(
        `cast: unbalanced '(' in cast operand (offset ${castStart})`,
      );
    }

    let exprStart = openParen + 1;
    let exprEnd = closeParen;
    while (exprStart < exprEnd && /[\s\n\r\t]/.test(source[exprStart]!)) {
      exprStart++;
    }
    while (exprEnd > exprStart && /[\s\n\r\t]/.test(source[exprEnd - 1]!)) {
      exprEnd--;
    }
    if (exprStart >= exprEnd) {
      throw new SyntaxError(
        `cast: expected expression inside cast<…>(…) (offset ${castStart})`,
      );
    }

    sites.push({
      start: castStart,
      end: closeParen + 1,
      expr: source.slice(exprStart, exprEnd),
      target,
    });
    re.lastIndex = closeParen + 1;
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
 * Rewrite every `cast<…>(…)` in `source`. Throws if a target is neither a
 * primitive nor a known companion name in the batch.
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
      `cast<${site.target}>: '${site.target}' is not a primitive or known companion` +
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
