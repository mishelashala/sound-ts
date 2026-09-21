/**
 * @mishelashala/superset-ts-core
 *
 * Product: `brand type` / `validate type` dialect + `as!` checked casts →
 * plain TS + runtime companions. Not a TypeScript fork. Stock tooling
 * consumes transform output only.
 *
 * `defineLiteralSet` is an **internal** emit/runtime helper, not the
 * authoring API. Authors write `brand type Account = "admin" | "regular"`.
 */

export {
  transform,
  transformProject,
  type TransformResult,
  type TransformFileOptions,
  type ProjectFileInput,
  type ProjectFileResult,
  type TransformProjectResult,
} from "./transform.js";
export {
  parseBrandTypes,
  maskCommentsAndStrings,
  type BrandTypeDecl,
  type BrandKind,
  type LiteralBrandDecl,
  type RefinedBrandDecl,
  type CombinedBrandDecl,
  type ParseResult,
} from "./parse.js";
export {
  parseValidateTypes,
  emitValidateType,
  type ValidateTypeDecl,
  type ValidateField,
  type ValidateFieldType,
  type ValidateMemberType,
  type PrimitiveTypeName,
  type ValidateParseResult,
} from "./validate.js";
export {
  findCheckedCasts,
  rewriteCheckedCasts,
  type CheckedCastSite,
  type RewriteCheckedCastsOptions,
} from "./checkedCast.js";
export {
  emitBrandType,
  transformSource,
  type EmitOptions,
  type EmitDecl,
} from "./emit.js";
export {
  buildBrandMap,
  buildValidateMap,
  assertNoCompanionNameCollisions,
  companionNames,
  resolveBrandRefs,
  detectBrandCycles,
  orderBrandsDependenciesFirst,
  type BrandMap,
  type BrandMapEntry,
  type BrandSourceFile,
  type ValidateMap,
  type ValidateMapEntry,
  type ValidateSourceFile,
} from "./brandMap.js";

/** @internal — emit target / runtime shape; not the public product API */
export {
  defineLiteralSet,
  type LiteralSet,
  type InferLiteral,
} from "./defineLiteralSet.js";
export { LiteralSetError } from "./errors.js";
