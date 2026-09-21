/**
 * Derive legacy brand/validate maps from the symbol table (API stability).
 */

import type { BrandTypeDecl } from "../parse.js";
import type { ValidateTypeDecl } from "../validate.js";
import type { BrandMap, ValidateMap } from "../brandMap.js";
import type { DialectProjectSymbols } from "./types.js";

export function brandMapFromSymbols(project: DialectProjectSymbols): BrandMap {
  const map: BrandMap = new Map();
  for (const sym of project.symbols) {
    if (sym.kind !== "brand") continue;
    map.set(sym.name, {
      filename: sym.filename,
      decl: sym.decl as BrandTypeDecl,
    });
  }
  return map;
}

export function validateMapFromSymbols(project: DialectProjectSymbols): ValidateMap {
  const map: ValidateMap = new Map();
  for (const sym of project.symbols) {
    if (sym.kind !== "validate") continue;
    map.set(sym.name, {
      filename: sym.filename,
      decl: sym.decl as ValidateTypeDecl,
    });
  }
  return map;
}
