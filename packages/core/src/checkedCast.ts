/**
 * Checked casts: `cast<Target>(expr)`
 *
 * Discovery: dialect AST frontend (`./ast`). Rewrite stays here.
 *
 * Target may be a primitive (`string` | `number` | `boolean`) or a known
 * companion name from the project map (`brand type` / `validate type`).
 * Primitives emit an inline typeof check; companions delegate to `.from`.
 */

import { parseSts } from "./ast/index.js";

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

/**
 * Collect `cast<Target>(expr)` sites via the dialect AST frontend.
 * Does not validate targets — that happens at rewrite time against the map.
 */
export function findCheckedCasts(source: string): CheckedCastSite[] {
  return parseSts(source).casts;
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
 *
 * Prefer passing pre-parsed `sites` from `parseSts` when available so the
 * file is not scanned twice.
 */
export function rewriteCheckedCasts(
  source: string,
  options: RewriteCheckedCastsOptions,
  sites: CheckedCastSite[] = findCheckedCasts(source),
): { code: string; count: number } {
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
