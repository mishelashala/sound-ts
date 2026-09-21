import { parseSts } from "./ast/index.js";
import type { BrandTypeDecl } from "./parse.js";
import { transformSource, type EmitOptions } from "./emit.js";
import {
  assertNoCompanionNameCollisions,
  buildBrandMap,
  buildValidateMap,
  companionNames,
  orderBrandsDependenciesFirst,
  resolveBrandRefs,
  type BrandMap,
  type ValidateMap,
} from "./brandMap.js";
import type { ValidateTypeDecl } from "./validate.js";
import { rewriteCheckedCasts } from "./checkedCast.js";
import { rewriteMethodsAsProperties } from "./emitMethods.js";
import { runSoundnessChecks } from "./soundness/index.js";

export interface TransformResult {
  /** Transformed source (plain TS) */
  code: string;
  /** Brand declarations that were expanded */
  decls: BrandTypeDecl[];
  /** Validate type declarations that were expanded */
  validateDecls: ValidateTypeDecl[];
  /** True when at least one dialect construct was rewritten */
  changed: boolean;
}

export interface TransformFileOptions extends EmitOptions {
  /** Optional filename for diagnostics */
  filename?: string;
  /**
   * Optional pre-built project brand map. When omitted, a map is built from
   * this file's decls only (still two-pass: collect, then resolve).
   */
  brandMap?: BrandMap;
  /** Optional pre-built validate map (same batch as brandMap). */
  validateMap?: ValidateMap;
  /** Optional pre-computed companion names for `cast` (brands + validate). */
  companionNames?: ReadonlySet<string>;
}

export interface ProjectFileInput {
  filename: string;
  source: string;
}

export interface ProjectFileResult extends TransformResult {
  filename: string;
}

export interface TransformProjectResult {
  files: ProjectFileResult[];
  brandMap: BrandMap;
  validateMap: ValidateMap;
  /** Brand names in dependency-first order */
  brandOrder: string[];
  /** All companion names (brands + validate types) */
  companionNames: Set<string>;
}

function expandFile(
  source: string,
  brandDecls: BrandTypeDecl[],
  validateDecls: ValidateTypeDecl[],
  options: EmitOptions,
  castCompanions: ReadonlySet<string>,
  filename?: string,
): { code: string; changed: boolean } {
  const allDecls = [...brandDecls, ...validateDecls];
  let code = source;
  let changed = false;
  if (allDecls.length > 0) {
    code = transformSource(source, allDecls, options);
    changed = true;
  }
  const castOpts: {
    companionNames: ReadonlySet<string>;
    filename?: string;
  } = { companionNames: castCompanions };
  if (filename !== undefined) castOpts.filename = filename;

  // Re-discover casts on post-emit source (brand/validate splice shifts offsets).
  const cast = rewriteCheckedCasts(code, castOpts);
  if (cast.count > 0) {
    code = cast.code;
    changed = true;
  }
  const methods = rewriteMethodsAsProperties(code);
  if (methods.count > 0) {
    code = methods.code;
    changed = true;
  }
  return { code, changed };
}

/**
 * Expand `brand type` / `validate type` into plain TS types plus runtime
 * companions (`Name.is` / `Name.from`, and `Name.values` for string-literal
 * brands), rewrite `cast<…>(…)` checked casts, and emit method syntax as
 * readonly function properties (stock `strictFunctionTypes`).
 * Refined, validate, and string-literal brands emit a phantom unique-symbol
 * arm (nominally opaque under stock `tsc`). String-literal brands also keep
 * the member literals in the union so `"admin"` stays assignable.
 *
 * Combined brand members resolve against the project brand map (this file
 * alone, or a map from `transformProject`). `cast` targets resolve against
 * primitives plus known companions in the batch.
 *
 * Stock `tsc` / Vite / bundlers consume the **output** only.
 */
export function transform(
  source: string,
  options: TransformFileOptions = {},
): TransformResult {
  runSoundnessChecks(source, options.filename);

  const dialect = parseSts(source);
  const decls = dialect.brands;
  const validateDecls = dialect.validates;

  let brandMap: BrandMap;
  let validateMap: ValidateMap;

  if (options.brandMap && options.validateMap) {
    brandMap = options.brandMap;
    validateMap = options.validateMap;
    resolveBrandRefs(brandMap);
    assertNoCompanionNameCollisions(brandMap, validateMap);
  } else {
    const brandFile: { filename?: string; decls: BrandTypeDecl[] } = {
      decls,
    };
    if (options.filename !== undefined) brandFile.filename = options.filename;
    const validateFile: { filename?: string; decls: ValidateTypeDecl[] } = {
      decls: validateDecls,
    };
    if (options.filename !== undefined) validateFile.filename = options.filename;
    brandMap = options.brandMap ?? buildBrandMap([brandFile]);
    validateMap = options.validateMap ?? buildValidateMap([validateFile]);
    resolveBrandRefs(brandMap);
    assertNoCompanionNameCollisions(brandMap, validateMap);
  }

  const names =
    options.companionNames ?? companionNames(brandMap, validateMap);

  if (decls.length === 0 && validateDecls.length === 0) {
    // Still may have cast<…>(…) casts and/or method syntax to rewrite
    const castOpts: {
      companionNames: ReadonlySet<string>;
      filename?: string;
    } = { companionNames: names };
    if (options.filename !== undefined) castOpts.filename = options.filename;
    const cast = rewriteCheckedCasts(source, castOpts, dialect.casts);
    const methods = rewriteMethodsAsProperties(cast.code);
    return {
      code: methods.code,
      decls,
      validateDecls,
      changed: cast.count > 0 || methods.count > 0,
    };
  }

  const { code, changed } = expandFile(
    source,
    decls,
    validateDecls,
    options,
    names,
    options.filename,
  );
  return { code, decls, validateDecls, changed };
}

/**
 * Whole-program transform over the CLI input graph: collect brand + validate
 * decls from every file, build project maps, resolve `|` / `&` members +
 * cycles, then emit each file and rewrite `cast`. No import/module resolver —
 * every path on the batch shares the maps.
 */
export function transformProject(
  files: ProjectFileInput[],
  options: EmitOptions = {},
): TransformProjectResult {
  for (const f of files) {
    runSoundnessChecks(f.source, f.filename);
  }

  const parsed = files.map((f) => {
    const dialect = parseSts(f.source);
    return {
      filename: f.filename,
      source: f.source,
      decls: dialect.brands,
      validateDecls: dialect.validates,
    };
  });

  const brandMap = buildBrandMap(
    parsed.map((f) => ({ filename: f.filename, decls: f.decls })),
  );
  const validateMap = buildValidateMap(
    parsed.map((f) => ({
      filename: f.filename,
      decls: f.validateDecls,
    })),
  );
  assertNoCompanionNameCollisions(brandMap, validateMap);
  resolveBrandRefs(brandMap);
  const brandOrder = orderBrandsDependenciesFirst(brandMap);
  const names = companionNames(brandMap, validateMap);

  const results: ProjectFileResult[] = parsed.map((f) => {
    const { code, changed } = expandFile(
      f.source,
      f.decls,
      f.validateDecls,
      options,
      names,
      f.filename,
    );
    return {
      filename: f.filename,
      code,
      decls: f.decls,
      validateDecls: f.validateDecls,
      changed,
    };
  });

  return {
    files: results,
    brandMap,
    validateMap,
    brandOrder,
    companionNames: names,
  };
}
