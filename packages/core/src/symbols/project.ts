/**
 * Build file scopes + project symbol table from DialectProgram side-tables.
 */

import type { DialectProgram } from "../ast/types.js";
import type { BrandTypeDecl } from "../parse.js";
import type { ValidateTypeDecl } from "../validate.js";
import { collectImportBindings } from "./imports.js";
import { resolveBatchModule } from "./modules.js";
import type {
  DialectProjectSymbols,
  DialectSymbol,
  FileScope,
  ImportBinding,
} from "./types.js";

export interface DialectFileInput {
  filename: string;
  source: string;
  dialect: DialectProgram;
}

/**
 * Collect symbols, link imports within the batch, and index by name.
 * Throws on duplicate companion names (brand vs brand, validate vs validate,
 * or brand vs validate) — same collision rules as the legacy maps.
 */
export function buildProjectSymbols(files: DialectFileInput[]): DialectProjectSymbols {
  const symbols: DialectSymbol[] = [];
  const byName = new Map<string, DialectSymbol>();
  let nextId = 1;

  function declare(
    kind: "brand" | "validate",
    name: string,
    filename: string,
    decl: BrandTypeDecl | ValidateTypeDecl,
  ): DialectSymbol {
    const prev = byName.get(name);
    if (prev) {
      const prevWhere = ` in ${prev.filename}`;
      const hereWhere = ` in ${filename}`;
      if (prev.kind !== kind) {
        throw new SyntaxError(
          `companion name '${name}' is declared as both brand type and validate type` +
            ` (${prev.filename} / ${filename})`,
        );
      }
      const label = kind === "brand" ? "brand type" : "validate type";
      throw new SyntaxError(
        `${label} ${name}: duplicate declaration${prevWhere} (also${hereWhere})`,
      );
    }
    const sym: DialectSymbol = {
      id: nextId++,
      kind,
      name,
      filename,
      decl,
      companionName: name,
    };
    symbols.push(sym);
    byName.set(name, sym);
    return sym;
  }

  const localsByFile = new Map<string, Map<string, DialectSymbol>>();

  for (const file of files) {
    const locals = new Map<string, DialectSymbol>();
    for (const decl of file.dialect.brands) {
      locals.set(decl.name, declare("brand", decl.name, file.filename, decl));
    }
    for (const decl of file.dialect.validates) {
      locals.set(decl.name, declare("validate", decl.name, file.filename, decl));
    }
    localsByFile.set(file.filename, locals);
  }

  const filenames = new Set(files.map((f) => f.filename));
  const scopes = new Map<string, FileScope>();

  for (const file of files) {
    const locals = localsByFile.get(file.filename)!;
    const rawImports = collectImportBindings(file.source, file.filename);
    const imports: ImportBinding[] = rawImports.map((raw) => {
      const targetFile = resolveBatchModule(
        file.filename,
        raw.moduleSpecifier,
        filenames,
      );
      let symbol: DialectSymbol | undefined;
      if (targetFile) {
        const remote = localsByFile.get(targetFile);
        symbol = remote?.get(raw.importedName);
      }
      return {
        localName: raw.localName,
        importedName: raw.importedName,
        moduleSpecifier: raw.moduleSpecifier,
        start: raw.start,
        end: raw.end,
        symbol,
      };
    });

    const importByLocal = new Map<string, ImportBinding>();
    for (const b of imports) {
      importByLocal.set(b.localName, b);
    }

    scopes.set(file.filename, {
      filename: file.filename,
      dialect: file.dialect,
      locals,
      imports,
      importByLocal,
    });
  }

  return { scopes, symbols, byName };
}
