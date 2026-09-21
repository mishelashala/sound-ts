/**
 * Sound-TS dialect scopes and symbols (roadmap 1.0 / #53).
 */

export type {
  DialectSymbolKind,
  DialectSymbol,
  ImportBinding,
  FileScope,
  DialectProjectSymbols,
} from "./types.js";

export { buildProjectSymbols, type DialectFileInput } from "./project.js";
export { collectImportBindings, type RawImportBinding } from "./imports.js";
export { resolveBatchModule } from "./modules.js";
export {
  lookupSymbol,
  resolveBrandMemberSymbols,
  resolveCastTarget,
  orderBrandSymbolsDependenciesFirst,
  companionNamesFromSymbols,
  getFileScope,
} from "./resolve.js";
export { brandMapFromSymbols, validateMapFromSymbols } from "./maps.js";
