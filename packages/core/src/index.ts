/**
 * @mishelashala/superset-ts-core
 *
 * Product: `brand type` dialect + transform → plain TS + runtime companions.
 * Not a TypeScript fork. Stock tooling consumes transform output only.
 *
 * `defineLiteralSet` is an **internal** emit/runtime helper, not the
 * authoring API. Authors write `brand type Account = "admin" | "regular"`.
 */

export { transform, type TransformResult, type TransformFileOptions } from "./transform.js";
export {
  parseBrandTypes,
  type BrandTypeDecl,
  type BrandKind,
  type LiteralBrandDecl,
  type RefinedBrandDecl,
  type CombinedBrandDecl,
  type ParseResult,
} from "./parse.js";
export { emitBrandType, transformSource, type EmitOptions } from "./emit.js";

/** @internal — emit target / runtime shape; not the public product API */
export {
  defineLiteralSet,
  type LiteralSet,
  type InferLiteral,
} from "./defineLiteralSet.js";
export { LiteralSetError } from "./errors.js";
