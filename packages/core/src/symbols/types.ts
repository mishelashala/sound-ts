/**
 * Sound-TS dialect symbol model (roadmap 1.0 / #53).
 *
 * Identity for brand / validate companions across the expand batch.
 * See ./README.md.
 */

import type { BrandTypeDecl } from "../parse.js";
import type { ValidateTypeDecl } from "../validate.js";
import type { DialectProgram } from "../ast/types.js";

/** Dialect declaration kinds that introduce a dual type+value companion. */
export type DialectSymbolKind = "brand" | "validate";

/**
 * One dialect name in the project: the type alias + runtime companion
 * (`Name` / `Name.is` / `Name.from`) after expand.
 */
export interface DialectSymbol {
  /** Stable id within one `DialectProjectSymbols` build */
  readonly id: number;
  readonly kind: DialectSymbolKind;
  readonly name: string;
  /** Declaring file path (batch input filename) */
  readonly filename: string;
  readonly decl: BrandTypeDecl | ValidateTypeDecl;
  /**
   * Value-side companion binding after emit (same identifier as `name` today).
   * Stock `import { Name } from "./x.js"` refers to this.
   */
  readonly companionName: string;
}

/** Stock TS import of a name that may resolve to a dialect companion. */
export interface ImportBinding {
  readonly localName: string;
  /** Name in the exporting module (`import { X as Y }` → `X`) */
  readonly importedName: string;
  readonly moduleSpecifier: string;
  readonly start: number;
  readonly end: number;
  /**
   * Linked dialect symbol when the specifier resolves inside the batch and
   * that file declares `importedName`. Undefined for unresolved / non-dialect.
   */
  readonly symbol: DialectSymbol | undefined;
}

/** Per-file scope: locals from `DialectProgram` + import bindings. */
export interface FileScope {
  readonly filename: string;
  readonly dialect: DialectProgram;
  /** Declarations in this file (`brand type` / `validate type`) */
  readonly locals: ReadonlyMap<string, DialectSymbol>;
  readonly imports: readonly ImportBinding[];
  readonly importByLocal: ReadonlyMap<string, ImportBinding>;
}

/**
 * Project-wide symbol table for one `transformProject` batch.
 * Flat `byName` matches today's brand/validate maps (batch = one dialect namespace).
 */
export interface DialectProjectSymbols {
  readonly scopes: ReadonlyMap<string, FileScope>;
  readonly symbols: readonly DialectSymbol[];
  /** Batch-wide index by companion name (duplicate names rejected at build) */
  readonly byName: ReadonlyMap<string, DialectSymbol>;
}
