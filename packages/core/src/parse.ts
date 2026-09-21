/**
 * Phase 1: parse `brand type Name = "a" | "b" | ...` declarations.
 * String literal unions only.
 */

export interface BrandTypeDecl {
  /** Declared name, e.g. `Account` */
  name: string;
  /** Ordered unique string literals */
  values: string[];
  /** Full matched source text including trailing semicolon if present */
  raw: string;
  /** Start offset in source */
  start: number;
  /** End offset in source */
  end: number;
}

export interface ParseResult {
  decls: BrandTypeDecl[];
}

/** Match: brand type Ident = "lit" (| "lit")* ;? */
const BRAND_TYPE_RE =
  /\bbrand\s+type\s+([A-Za-z_$][\w$]*)\s*=\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(?:\s*\|\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))*)\s*;?/g;

function unquote(lit: string): string {
  const q = lit[0];
  const body = lit.slice(1, -1);
  if (q === '"') {
    return body.replace(/\\(["\\nrt])/g, (_, c: string) => {
      switch (c) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        default:
          return c;
      }
    });
  }
  return body.replace(/\\(['\\nrt])/g, (_, c: string) => {
    switch (c) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return c;
    }
  });
}

function splitLiterals(unionSrc: string): string[] {
  const litRe = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(unionSrc)) !== null) {
    out.push(unquote(m[0]));
  }
  return out;
}

/**
 * Find all `brand type` declarations in source text.
 *
 * Caveat (v0): comment-skipping is incomplete — the regex can still match
 * inside line/block comments. Documented in README / Pages; fix later.
 */
export function parseBrandTypes(source: string): ParseResult {
  const decls: BrandTypeDecl[] = [];
  const re = new RegExp(BRAND_TYPE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1]!;
    const unionSrc = m[2]!;
    const values = splitLiterals(unionSrc);
    if (values.length === 0) {
      continue;
    }
    const unique = new Set(values);
    if (unique.size !== values.length) {
      throw new SyntaxError(
        `brand type ${name}: duplicate string literals are not allowed`,
      );
    }
    decls.push({
      name,
      values,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return { decls };
}
