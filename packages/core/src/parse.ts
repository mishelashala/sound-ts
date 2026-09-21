/**
 * Brand declaration types.
 *
 * Dialect parsing lives in `./ast` (TypeScript scanner + synthetic AST snippets).
 * `parseBrandTypes` is a thin adapter over `parseSts`.
 */

import { parseSts } from "./ast/index.js";

export { maskCommentsAndStrings } from "./mask.js";

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

/**
 * Find all `brand type` declarations via the dialect AST frontend.
 */
export function parseBrandTypes(source: string): ParseResult {
  return { decls: parseSts(source).brands };
}
