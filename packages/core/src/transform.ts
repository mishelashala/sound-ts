import { parseBrandTypes, type BrandTypeDecl } from "./parse.js";
import { transformSource, type EmitOptions } from "./emit.js";

export interface TransformResult {
  /** Transformed source (plain TS) */
  code: string;
  /** Declarations that were expanded */
  decls: BrandTypeDecl[];
  /** True when at least one brand type was rewritten */
  changed: boolean;
}

export interface TransformFileOptions extends EmitOptions {
  /** Optional filename for diagnostics (unused in v0 beyond passthrough) */
  filename?: string;
}

/**
 * Expand `brand type Name = "a" | "b"` into a plain type alias plus a
 * runtime companion (`Name.is` / `Name.from` / `Name.values`).
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
  const code = transformSource(source, decls, options);
  return { code, decls, changed: true };
}
