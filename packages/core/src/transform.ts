import { parseBrandTypes, type BrandTypeDecl } from "./parse.js";
import { transformSource, type EmitOptions } from "./emit.js";
import {
  buildBrandMap,
  orderBrandsDependenciesFirst,
  resolveBrandRefs,
  type BrandMap,
} from "./brandMap.js";

export interface TransformResult {
  /** Transformed source (plain TS) */
  code: string;
  /** Declarations that were expanded */
  decls: BrandTypeDecl[];
  /** True when at least one brand type was rewritten */
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
  /** Brand names in dependency-first order */
  brandOrder: string[];
}

/**
 * Expand `brand type` into plain type aliases plus runtime companions
 * (`Name.is` / `Name.from`, and `Name.values` for string-literal brands).
 *
 * Supports string-literal brands, refined brands, and brand-only unions /
 * intersections. Combined members resolve against the project brand map
 * (this file alone, or a map from `transformProject`).
 *
 * Stock `tsc` / Vite / bundlers consume the **output** only.
 */
export function transform(
  source: string,
  options: TransformFileOptions = {},
): TransformResult {
  const { decls } = parseBrandTypes(source);
  if (decls.length === 0) {
    return { code: source, decls, changed: false };
  }

  if (options.brandMap) {
    // Project path already resolved the shared map; still ensure this file's
    // combined members are covered (map must include them).
    resolveBrandRefs(options.brandMap);
  } else {
    const file: { filename?: string; decls: BrandTypeDecl[] } = { decls };
    if (options.filename !== undefined) file.filename = options.filename;
    const map = buildBrandMap([file]);
    resolveBrandRefs(map);
  }

  const code = transformSource(source, decls, options);
  return { code, decls, changed: true };
}

/**
 * Whole-program transform over the CLI input graph: collect brand decls from
 * every file, build one project brand map, resolve `|` / `&` members + cycles,
 * then emit each file. No import/module resolver — every path on the batch
 * shares the map.
 */
export function transformProject(
  files: ProjectFileInput[],
  options: EmitOptions = {},
): TransformProjectResult {
  const parsed = files.map((f) => ({
    filename: f.filename,
    source: f.source,
    decls: parseBrandTypes(f.source).decls,
  }));

  const brandMap = buildBrandMap(
    parsed.map((f) => ({ filename: f.filename, decls: f.decls })),
  );
  resolveBrandRefs(brandMap);
  const brandOrder = orderBrandsDependenciesFirst(brandMap);

  const results: ProjectFileResult[] = parsed.map((f) => {
    if (f.decls.length === 0) {
      return {
        filename: f.filename,
        code: f.source,
        decls: f.decls,
        changed: false,
      };
    }
    const code = transformSource(f.source, f.decls, options);
    return {
      filename: f.filename,
      code,
      decls: f.decls,
      changed: true,
    };
  });

  return { files: results, brandMap, brandOrder };
}
