/**
 * Project-wide companion map: collect `brand type` and `validate type` decls
 * across a CLI batch, then resolve `|` / `&` brand members and detect cycles.
 * No module/import resolver — every file on the transform input graph shares
 * one map (needed so `cast<User>(…)` can see companions from other files).
 *
 * Prefer `buildProjectSymbols` / `DialectProjectSymbols` for new code (identity
 * + import bindings). These maps remain the stable derived view used by emit
 * callers; `transformProject` builds them from the symbol table.
 */

import type { BrandTypeDecl, CombinedBrandDecl } from "./parse.js";
import type { ValidateTypeDecl } from "./validate.js";

export interface BrandMapEntry {
  /** Declaring file path (when known) */
  filename?: string;
  decl: BrandTypeDecl;
}

export type BrandMap = Map<string, BrandMapEntry>;

export interface ValidateMapEntry {
  filename?: string;
  decl: ValidateTypeDecl;
}

export type ValidateMap = Map<string, ValidateMapEntry>;

export interface BrandSourceFile {
  filename?: string;
  decls: BrandTypeDecl[];
}

export interface ValidateSourceFile {
  filename?: string;
  decls: ValidateTypeDecl[];
}

/**
 * Collect brand declarations into a project map.
 * Throws on duplicate brand names across the batch.
 */
export function buildBrandMap(files: BrandSourceFile[]): BrandMap {
  const map: BrandMap = new Map();
  for (const file of files) {
    for (const decl of file.decls) {
      const prev = map.get(decl.name);
      if (prev) {
        const prevWhere = prev.filename ? ` in ${prev.filename}` : "";
        const hereWhere = file.filename ? ` in ${file.filename}` : "";
        throw new SyntaxError(
          `brand type ${decl.name}: duplicate declaration` +
            `${prevWhere}${hereWhere ? ` (also${hereWhere})` : ""}`,
        );
      }
      const entry: BrandMapEntry = { decl };
      if (file.filename !== undefined) entry.filename = file.filename;
      map.set(decl.name, entry);
    }
  }
  return map;
}

/**
 * Collect validate type declarations into a project map.
 * Throws on duplicate validate names across the batch.
 */
export function buildValidateMap(files: ValidateSourceFile[]): ValidateMap {
  const map: ValidateMap = new Map();
  for (const file of files) {
    for (const decl of file.decls) {
      const prev = map.get(decl.name);
      if (prev) {
        const prevWhere = prev.filename ? ` in ${prev.filename}` : "";
        const hereWhere = file.filename ? ` in ${file.filename}` : "";
        throw new SyntaxError(
          `validate type ${decl.name}: duplicate declaration` +
            `${prevWhere}${hereWhere ? ` (also${hereWhere})` : ""}`,
        );
      }
      const entry: ValidateMapEntry = { decl };
      if (file.filename !== undefined) entry.filename = file.filename;
      map.set(decl.name, entry);
    }
  }
  return map;
}

/**
 * Reject names that appear as both a brand and a validate type in the batch.
 */
export function assertNoCompanionNameCollisions(
  brandMap: BrandMap,
  validateMap: ValidateMap,
): void {
  for (const name of validateMap.keys()) {
    if (brandMap.has(name)) {
      const brandFile = brandMap.get(name)?.filename;
      const validateFile = validateMap.get(name)?.filename;
      const where =
        brandFile || validateFile
          ? ` (${[brandFile, validateFile].filter(Boolean).join(" / ")})`
          : "";
      throw new SyntaxError(
        `companion name '${name}' is declared as both brand type and validate type${where}`,
      );
    }
  }
}

/** All companion names (brands + validate types) visible to `cast`. */
export function companionNames(
  brandMap: BrandMap,
  validateMap: ValidateMap,
): Set<string> {
  return new Set([...brandMap.keys(), ...validateMap.keys()]);
}

/**
 * Resolve combined-brand members against the project map and reject cycles.
 */
export function resolveBrandRefs(brandMap: BrandMap): void {
  for (const [name, entry] of brandMap) {
    if (entry.decl.kind !== "union" && entry.decl.kind !== "intersection") {
      continue;
    }
    const combined = entry.decl as CombinedBrandDecl;
    const where = entry.filename ? ` (${entry.filename})` : "";
    for (const member of combined.members) {
      if (!brandMap.has(member)) {
        throw new SyntaxError(
          `brand type ${name}: '${member}' is not a known brand name` +
            `${where} (brand unions/intersections may only reference brands ` +
            `declared in the transform input)`,
        );
      }
    }
  }
  detectBrandCycles(brandMap);
}

/**
 * DFS cycle detection over combined-brand dependency edges.
 */
export function detectBrandCycles(brandMap: BrandMap): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(name: string, stack: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      const cycle =
        start >= 0
          ? [...stack.slice(start), name].join(" → ")
          : [...stack, name].join(" → ");
      throw new SyntaxError(`brand type cycle detected: ${cycle}`);
    }

    const entry = brandMap.get(name);
    if (!entry) {
      visited.add(name);
      return;
    }
    if (entry.decl.kind !== "union" && entry.decl.kind !== "intersection") {
      visited.add(name);
      return;
    }

    visiting.add(name);
    for (const member of entry.decl.members) {
      dfs(member, [...stack, member]);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of brandMap.keys()) {
    dfs(name, [name]);
  }
}

/**
 * Dependency-first ordering of brand names (leaves / literals first).
 * Combined brands appear after their members. Useful for stable multi-file emit.
 */
export function orderBrandsDependenciesFirst(brandMap: BrandMap): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      // Cycle — resolveBrandRefs should have thrown already; keep deterministic.
      return;
    }
    const entry = brandMap.get(name);
    if (!entry) return;
    visiting.add(name);
    if (entry.decl.kind === "union" || entry.decl.kind === "intersection") {
      for (const member of entry.decl.members) {
        visit(member);
      }
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }

  for (const name of brandMap.keys()) {
    visit(name);
  }
  return ordered;
}
