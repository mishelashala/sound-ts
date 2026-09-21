import { parseSts } from "./ast/index.js";
import type { DialectProgram } from "./ast/types.js";
import type { BrandTypeDecl } from "./parse.js";
import { transformSource, type EmitOptions } from "./emit.js";
import {
  assertNoCompanionNameCollisions,
  companionNames,
  resolveBrandRefs,
  type BrandMap,
  type ValidateMap,
} from "./brandMap.js";
import type { ValidateTypeDecl } from "./validate.js";
import { rewriteCheckedCasts } from "./checkedCast.js";
import { rewriteMethodsAsProperties } from "./emitMethods.js";
import {
  runSoundnessChecks,
  runSoundness1Checks,
} from "./soundness/index.js";
import {
  buildProjectSymbols,
  brandMapFromSymbols,
  companionNamesFromSymbols,
  orderBrandSymbolsDependenciesFirst,
  resolveBrandMemberSymbols,
  validateMapFromSymbols,
  type DialectProjectSymbols,
} from "./symbols/index.js";

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
  /** Optional pre-built project symbols (preferred with multi-file maps). */
  symbols?: DialectProjectSymbols;
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
  /** Dialect scopes + symbols for the batch (foundation for #54) */
  symbols: DialectProjectSymbols;
}

/**
 * Dialect soundness + rewrites apply to `.sts` (and stdin / unspecified).
 * Plain `.ts` / `.tsx` in a mixed `sts` mirror batch stay byte-for-byte so
 * gradual adoption does not ban `as` / rewrite methods across a stock app.
 */
export function isDialectSurface(filename?: string): boolean {
  if (filename === undefined || filename === "<stdin>") return true;
  return /\.sts$/i.test(filename);
}

function emptyDialect(source: string): DialectProgram {
  return { source, brands: [], validates: [], casts: [] };
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
 * companions (`Name.is` / `Name.from`, and `Name.values` / `Name.toPrimitive`
 * for string-literal brands), rewrite `cast<…>(…)` checked casts, and emit
 * method syntax as readonly function properties (stock `strictFunctionTypes`).
 * Refined, validate, and string-literal brands emit a phantom unique-symbol
 * arm (nominally opaque under stock `tsc`). String-literal brands also keep
 * the member literals in the union so `"admin"` stays assignable; use
 * `.toPrimitive` to recover the closed literal union for DTOs.
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
  if (!isDialectSurface(options.filename)) {
    return {
      code: source,
      decls: [],
      validateDecls: [],
      changed: false,
    };
  }

  runSoundnessChecks(source, options.filename);

  const dialect = parseSts(source);
  const decls = dialect.brands;
  const validateDecls = dialect.validates;

  let brandMap: BrandMap;
  let validateMap: ValidateMap;
  let names: ReadonlySet<string>;
  let symbolsForChecks: DialectProjectSymbols | undefined;

  if (options.symbols) {
    resolveBrandMemberSymbols(options.symbols);
    brandMap = options.brandMap ?? brandMapFromSymbols(options.symbols);
    validateMap = options.validateMap ?? validateMapFromSymbols(options.symbols);
    names =
      options.companionNames ?? companionNamesFromSymbols(options.symbols);
    symbolsForChecks = options.symbols;
  } else if (options.brandMap && options.validateMap) {
    // Legacy injection path (maps without symbols).
    brandMap = options.brandMap;
    validateMap = options.validateMap;
    resolveBrandRefs(brandMap);
    assertNoCompanionNameCollisions(brandMap, validateMap);
    names = options.companionNames ?? companionNames(brandMap, validateMap);
    // Build symbols for 1.0 rules from this file's dialect only.
    symbolsForChecks = buildProjectSymbols([
      {
        filename: options.filename ?? "<stdin>",
        source,
        dialect,
      },
    ]);
  } else {
    const symbols = buildProjectSymbols([
      {
        filename: options.filename ?? "<stdin>",
        source,
        dialect,
      },
    ]);
    resolveBrandMemberSymbols(symbols);
    brandMap = options.brandMap ?? brandMapFromSymbols(symbols);
    validateMap = options.validateMap ?? validateMapFromSymbols(symbols);
    names = options.companionNames ?? companionNamesFromSymbols(symbols);
    symbolsForChecks = symbols;
  }

  if (symbolsForChecks) {
    const checkOpts: {
      symbols: DialectProjectSymbols;
      filename?: string;
    } = { symbols: symbolsForChecks };
    if (options.filename !== undefined) checkOpts.filename = options.filename;
    runSoundness1Checks(source, checkOpts);
  }

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
 * decls from every file, build project symbols (scopes + import links), resolve
 * `|` / `&` members + cycles, then emit each file and rewrite `cast`.
 * Relative imports of companions stay stock TS after emit.
 *
 * Plain `.ts` / `.tsx` are mirrored unchanged (no soundness bans, no method
 * rewrite). Only `.sts` is the dialect surface.
 */
export function transformProject(
  files: ProjectFileInput[],
  options: EmitOptions = {},
): TransformProjectResult {
  for (const f of files) {
    if (isDialectSurface(f.filename)) {
      runSoundnessChecks(f.source, f.filename);
    }
  }

  const parsed = files.map((f) => {
    if (!isDialectSurface(f.filename)) {
      const dialect = emptyDialect(f.source);
      return {
        filename: f.filename,
        source: f.source,
        dialect,
        decls: dialect.brands,
        validateDecls: dialect.validates,
        dialectSurface: false as const,
      };
    }
    const dialect = parseSts(f.source);
    return {
      filename: f.filename,
      source: f.source,
      dialect,
      decls: dialect.brands,
      validateDecls: dialect.validates,
      dialectSurface: true as const,
    };
  });

  const symbols = buildProjectSymbols(
    parsed.map((f) => ({
      filename: f.filename,
      source: f.source,
      dialect: f.dialect,
    })),
  );

  for (const f of parsed) {
    if (f.dialectSurface) {
      runSoundness1Checks(f.source, { filename: f.filename, symbols });
    }
  }

  resolveBrandMemberSymbols(symbols);

  const brandMap = brandMapFromSymbols(symbols);
  const validateMap = validateMapFromSymbols(symbols);
  const brandOrder = orderBrandSymbolsDependenciesFirst(symbols);
  const names = companionNamesFromSymbols(symbols);

  const results: ProjectFileResult[] = parsed.map((f) => {
    if (!f.dialectSurface) {
      return {
        filename: f.filename,
        code: f.source,
        decls: [],
        validateDecls: [],
        changed: false,
      };
    }
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
    symbols,
  };
}
