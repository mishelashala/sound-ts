/**
 * Parse `brand type` declarations (phase 1 + phase 2).
 *
 * Supported forms:
 * - Mode A (string literals): `brand type Account = "admin" | "regular"`
 * - Mode B (refined): `brand type PositiveInt = number { is(n: number): n is PositiveInt { … } }`
 * - Brand unions / intersections: `brand type Staff = Admin | Regular`
 *   (members must be known brand names — resolved via project brand map)
 *
 * Before scanning for `brand type`, line/block comments and string/template
 * literals are masked in-place with spaces (offsets stay aligned for emit).
 * Remaining edges: regex literals; nested `${}` inside templates (masked whole).
 */

export type BrandKind = "literal" | "refined" | "union" | "intersection";

interface BrandTypeDeclBase {
  /** Declared name, e.g. `Account` */
  name: string;
  /** Full matched source text including trailing semicolon if present */
  raw: string;
  /** Start offset in source */
  start: number;
  /** End offset in source */
  end: number;
}

/** Phase 1: closed string literal union */
export interface LiteralBrandDecl extends BrandTypeDeclBase {
  kind: "literal";
  /** Ordered unique string literals */
  values: string[];
}

/** Phase 2 Mode B: base type + custom `is`, generated `from` */
export interface RefinedBrandDecl extends BrandTypeDeclBase {
  kind: "refined";
  /** Base type expression (simple ident), e.g. `number` */
  baseType: string;
  /** Parameter name in `is(...)` */
  isParamName: string;
  /** Parameter type in `is(...)` */
  isParamType: string;
  /** Body of the user-provided `is` function (without surrounding braces) */
  isBody: string;
}

/** Union or intersection of known brand names (resolved after parse) */
export interface CombinedBrandDecl extends BrandTypeDeclBase {
  kind: "union" | "intersection";
  /** Brand member names in source order */
  members: string[];
}

export type BrandTypeDecl =
  | LiteralBrandDecl
  | RefinedBrandDecl
  | CombinedBrandDecl;

export interface ParseResult {
  decls: BrandTypeDecl[];
}

const IDENT = /[A-Za-z_$][\w$]*/;

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

function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

function matchIdent(source: string, i: number): { ident: string; end: number } | null {
  const m = source.slice(i).match(new RegExp("^" + IDENT.source));
  if (!m) return null;
  return { ident: m[0], end: i + m[0].length };
}

/** Scan a balanced `{ … }` starting at `i` (must point at `{`). Returns index after close. */
function scanBalancedBrace(source: string, i: number): number {
  if (source[i] !== "{") {
    throw new SyntaxError(`expected '{' at offset ${i}`);
  }
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let escape = false;
  for (let j = i; j < source.length; j++) {
    const c = source[j]!;
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  throw new SyntaxError(`unclosed '{' starting at offset ${i}`);
}

function parseStringLiteral(source: string, i: number): { value: string; lit: string; end: number } | null {
  const c = source[i];
  if (c !== '"' && c !== "'") return null;
  const quote = c;
  let j = i + 1;
  let escape = false;
  while (j < source.length) {
    const ch = source[j]!;
    if (escape) {
      escape = false;
      j++;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      j++;
      continue;
    }
    if (ch === quote) {
      const lit = source.slice(i, j + 1);
      return { value: unquote(lit), lit, end: j + 1 };
    }
    j++;
  }
  throw new SyntaxError(`unclosed string literal at offset ${i}`);
}

function parseLiteralUnion(
  source: string,
  startEq: number,
  name: string,
): { values: string[]; end: number } {
  let i = skipWs(source, startEq);
  const values: string[] = [];
  for (;;) {
    const lit = parseStringLiteral(source, i);
    if (!lit) {
      throw new SyntaxError(
        `brand type ${name}: expected string literal in union`,
      );
    }
    values.push(lit.value);
    i = skipWs(source, lit.end);
    if (source[i] === "|") {
      i = skipWs(source, i + 1);
      continue;
    }
    break;
  }
  if (source[i] === ";") i++;
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new SyntaxError(
      `brand type ${name}: duplicate string literals are not allowed`,
    );
  }
  if (values.length === 0) {
    throw new SyntaxError(`brand type ${name}: empty literal union`);
  }
  return { values, end: i };
}

/**
 * Parse Mode B: `BaseType { is(param: Type): param is Name { body } }`
 * `i` points at the start of BaseType.
 */
function parseRefined(
  source: string,
  i: number,
  name: string,
): Omit<RefinedBrandDecl, keyof BrandTypeDeclBase> & { end: number } {
  const base = matchIdent(source, i);
  if (!base) {
    throw new SyntaxError(
      `brand type ${name}: expected base type before '{' in Mode B refined brand`,
    );
  }
  let pos = skipWs(source, base.end);
  if (source[pos] !== "{") {
    throw new SyntaxError(
      `brand type ${name}: expected '{' after base type '${base.ident}'`,
    );
  }
  const blockEnd = scanBalancedBrace(source, pos);
  const inner = source.slice(pos + 1, blockEnd - 1);
  // Parse `is(param: type): param is Name { body }` inside the block
  let k = skipWs(inner, 0);
  const isKw = matchIdent(inner, k);
  if (!isKw || isKw.ident !== "is") {
    throw new SyntaxError(
      `brand type ${name}: Mode B block must start with 'is(...)'`,
    );
  }
  k = skipWs(inner, isKw.end);
  if (inner[k] !== "(") {
    throw new SyntaxError(
      `brand type ${name}: expected '(' after 'is'`,
    );
  }
  k++;
  k = skipWs(inner, k);
  const param = matchIdent(inner, k);
  if (!param) {
    throw new SyntaxError(
      `brand type ${name}: expected parameter name in is(...)`,
    );
  }
  k = skipWs(inner, param.end);
  if (inner[k] !== ":") {
    throw new SyntaxError(
      `brand type ${name}: expected ':' after is() parameter name`,
    );
  }
  k = skipWs(inner, k + 1);
  const paramType = matchIdent(inner, k);
  if (!paramType) {
    throw new SyntaxError(
      `brand type ${name}: expected parameter type in is(...)`,
    );
  }
  k = skipWs(inner, paramType.end);
  if (inner[k] !== ")") {
    throw new SyntaxError(
      `brand type ${name}: expected ')' after is() parameter`,
    );
  }
  k = skipWs(inner, k + 1);
  if (inner[k] !== ":") {
    throw new SyntaxError(
      `brand type ${name}: expected return type ': ${param.ident} is ${name}' after is(...)`,
    );
  }
  k = skipWs(inner, k + 1);
  const retParam = matchIdent(inner, k);
  if (!retParam || retParam.ident !== param.ident) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must be '${param.ident} is ${name}'`,
    );
  }
  k = skipWs(inner, retParam.end);
  const isKw2 = matchIdent(inner, k);
  if (!isKw2 || isKw2.ident !== "is") {
    throw new SyntaxError(
      `brand type ${name}: type predicate must be '${param.ident} is ${name}'`,
    );
  }
  k = skipWs(inner, isKw2.end);
  const retBrand = matchIdent(inner, k);
  if (!retBrand || retBrand.ident !== name) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must refine '${name}' (got '${retBrand?.ident ?? "?"}')`,
    );
  }
  k = skipWs(inner, retBrand.end);
  if (inner[k] !== "{") {
    throw new SyntaxError(
      `brand type ${name}: expected '{' for is() body`,
    );
  }
  const bodyEndInInner = scanBalancedBrace(inner, k);
  const isBody = inner.slice(k + 1, bodyEndInInner - 1).replace(/^\n/, "").replace(/\n\s*$/, "");
  k = skipWs(inner, bodyEndInInner);
  if (k < inner.length) {
    // allow trailing whitespace only
    throw new SyntaxError(
      `brand type ${name}: unexpected tokens after is() body in Mode B block`,
    );
  }

  let end = blockEnd;
  end = skipWs(source, end);
  if (source[end] === ";") end++;
  return {
    kind: "refined",
    baseType: base.ident,
    isParamName: param.ident,
    isParamType: paramType.ident,
    isBody,
    end,
  };
}

/**
 * Parse brand-only union or intersection: `Admin | Regular` or `User & Session`.
 * `i` points at first member ident.
 */
function parseCombined(
  source: string,
  i: number,
  name: string,
): Omit<CombinedBrandDecl, keyof BrandTypeDeclBase> & { end: number } {
  const members: string[] = [];
  let op: "|" | "&" | null = null;
  let pos = i;

  for (;;) {
    const id = matchIdent(source, pos);
    if (!id) {
      throw new SyntaxError(
        `brand type ${name}: expected brand name in union/intersection`,
      );
    }
    // String literals are never valid here — caught earlier. Reject if someone
    // used a non-ident. Base open types like `string` are rejected later as
    // "not a known brand".
    members.push(id.ident);
    pos = skipWs(source, id.end);
    const c = source[pos];
    if (c === "|" || c === "&") {
      if (op === null) op = c;
      else if (op !== c) {
        throw new SyntaxError(
          `brand type ${name}: cannot mix '|' and '&' in one brand declaration`,
        );
      }
      pos = skipWs(source, pos + 1);
      continue;
    }
    break;
  }

  if (members.length === 0) {
    throw new SyntaxError(`brand type ${name}: empty union/intersection`);
  }
  // Single member without op: treat as degenerate union (alias of one brand).
  const kind: "union" | "intersection" =
    op === "&" ? "intersection" : "union";

  if (source[pos] === ";") pos++;
  return { kind, members, end: pos };
}

/**
 * Mask line comments (`//`), block comments, and `"…"`, `'…'`, `` `…` ``
 * literals with spaces (same length) so a subsequent `brand type` scan cannot
 * match inside them while decl offsets still point into the original source.
 *
 * Template literals are masked as a single span (including any `${…}`); we do
 * not re-enter expression mode inside `${}` — good enough for v0.
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;

    // Line comment: // … to EOL (newline kept)
    if (c === "/" && source[i + 1] === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        out[i] = " ";
        i++;
      }
      continue;
    }

    // Block comment: /* … */
    if (c === "/" && source[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          break;
        }
        if (source[i] !== "\n" && source[i] !== "\r") {
          out[i] = " ";
        }
        i++;
      }
      continue;
    }

    // Single- or double-quoted string
    if (c === '"' || c === "'") {
      const quote = c;
      out[i] = " ";
      i++;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === "\\") {
          out[i] = " ";
          if (i + 1 < source.length) {
            out[i + 1] = " ";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out[i] = " ";
        i++;
        if (ch === quote) break;
      }
      continue;
    }

    // Template literal (plain span through closing backtick)
    if (c === "`") {
      out[i] = " ";
      i++;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === "\\") {
          out[i] = " ";
          if (i + 1 < source.length) {
            out[i + 1] = " ";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out[i] = " ";
        i++;
        if (ch === "`") break;
      }
      continue;
    }

    i++;
  }
  return out.join("");
}

/**
 * Find all `brand type` declarations in source text.
 * Scans a comment/string-masked copy; parses spans from the original source.
 */
export function parseBrandTypes(source: string): ParseResult {
  const decls: BrandTypeDecl[] = [];
  const scan = maskCommentsAndStrings(source);
  const headerRe = /\bbrand\s+type\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m: RegExpExecArray | null;

  while ((m = headerRe.exec(scan)) !== null) {
    const name = m[1]!;
    const declStart = m.index;
    const afterEq = m.index + m[0].length;
    let i = skipWs(source, afterEq);
    const first = source[i];

    let decl: BrandTypeDecl;

    if (first === '"' || first === "'") {
      const lit = parseLiteralUnion(source, i, name);
      decl = {
        kind: "literal",
        name,
        values: lit.values,
        raw: source.slice(declStart, lit.end),
        start: declStart,
        end: lit.end,
      };
    } else {
      const firstIdent = matchIdent(source, i);
      if (!firstIdent) {
        throw new SyntaxError(
          `brand type ${name}: expected string literal, base type, or brand name after '='`,
        );
      }
      const afterFirst = skipWs(source, firstIdent.end);
      if (source[afterFirst] === "{") {
        // Refined: `number { is… }`
        const refined = parseRefined(source, i, name);
        decl = {
          kind: "refined",
          name,
          baseType: refined.baseType,
          isParamName: refined.isParamName,
          isParamType: refined.isParamType,
          isBody: refined.isBody,
          raw: source.slice(declStart, refined.end),
          start: declStart,
          end: refined.end,
        };
      } else if (
        source[afterFirst] === "|" ||
        source[afterFirst] === "&" ||
        source[afterFirst] === ";" ||
        afterFirst === source.length ||
        // lone brand alias / end of statement-ish
        /[\r\n]/.test(source[afterFirst] ?? "")
      ) {
        // Brand union / intersection / single-brand alias.
        // Member resolution (known brand / cycle) is deferred to the project
        // brand map — see buildBrandMap + resolveBrandRefs.
        const combined = parseCombined(source, i, name);
        decl = {
          kind: combined.kind,
          name,
          members: combined.members,
          raw: source.slice(declStart, combined.end),
          start: declStart,
          end: combined.end,
        };
      } else {
        throw new SyntaxError(
          `brand type ${name}: unexpected token after '${firstIdent.ident}' ` +
            `(refined brands need '{ is(...) }'; unions need '|' / '&' between brand names)`,
        );
      }
    }

    decls.push(decl);
    // Continue search after this decl (headerRe.lastIndex may sit inside body)
    headerRe.lastIndex = decl.end;
  }

  return { decls };
}
