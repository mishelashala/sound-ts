/**
 * Resolve dialect names to symbols (brand members, cast targets, lookups).
 */

import type { CombinedBrandDecl } from "../parse.js";
import type {
  DialectProjectSymbols,
  DialectSymbol,
  FileScope,
} from "./types.js";

const PRIMITIVES = new Set(["string", "number", "boolean"]);

/**
 * Look up a dialect name in a file scope, then the project batch.
 *
 * Order: local decl → import binding (if linked) → batch `byName`.
 * Batch fallback preserves today's flat expand-graph visibility for `|` / `&`
 * and `cast` without requiring authors to import for dialect composition.
 */
export function lookupSymbol(
  project: DialectProjectSymbols,
  filename: string,
  name: string,
): DialectSymbol | undefined {
  const scope = project.scopes.get(filename);
  if (scope) {
    const local = scope.locals.get(name);
    if (local) return local;
    const viaImport = scope.importByLocal.get(name)?.symbol;
    if (viaImport) return viaImport;
  }
  return project.byName.get(name);
}

/**
 * Resolve combined-brand members to brand symbols; reject unknown names + cycles.
 */
export function resolveBrandMemberSymbols(project: DialectProjectSymbols): void {
  for (const sym of project.symbols) {
    if (sym.kind !== "brand") continue;
    const decl = sym.decl;
    if (decl.kind !== "union" && decl.kind !== "intersection") continue;
    const combined = decl as CombinedBrandDecl;
    const where = ` (${sym.filename})`;
    for (const member of combined.members) {
      const target = project.byName.get(member);
      if (!target || target.kind !== "brand") {
        throw new SyntaxError(
          `brand type ${sym.name}: '${member}' is not a known brand name` +
            `${where} (brand unions/intersections may only reference brands ` +
            `declared in the transform input)`,
        );
      }
    }
  }
  detectBrandSymbolCycles(project);
}

function detectBrandSymbolCycles(project: DialectProjectSymbols): void {
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

    const sym = project.byName.get(name);
    if (!sym || sym.kind !== "brand") {
      visited.add(name);
      return;
    }
    if (sym.decl.kind !== "union" && sym.decl.kind !== "intersection") {
      visited.add(name);
      return;
    }

    visiting.add(name);
    for (const member of sym.decl.members) {
      dfs(member, [...stack, member]);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const sym of project.symbols) {
    if (sym.kind === "brand") dfs(sym.name, [sym.name]);
  }
}

/**
 * Resolve a `cast<Target>` name: primitive → undefined symbol, companion → symbol.
 * Throws when the target is neither.
 */
export function resolveCastTarget(
  project: DialectProjectSymbols,
  filename: string,
  target: string,
): { kind: "primitive"; name: string } | { kind: "companion"; symbol: DialectSymbol } {
  if (PRIMITIVES.has(target)) {
    return { kind: "primitive", name: target };
  }
  const symbol = lookupSymbol(project, filename, target);
  if (!symbol) {
    const where = filename ? ` (${filename})` : "";
    throw new SyntaxError(
      `cast<${target}>: '${target}' is not a primitive or known companion` +
        `${where} (checked casts may target string | number | boolean, or a ` +
        `brand type / validate type declared in the transform input)`,
    );
  }
  return { kind: "companion", symbol };
}

/** Dependency-first brand names (leaves first). */
export function orderBrandSymbolsDependenciesFirst(
  project: DialectProjectSymbols,
): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    const sym = project.byName.get(name);
    if (!sym || sym.kind !== "brand") return;
    visiting.add(name);
    if (sym.decl.kind === "union" || sym.decl.kind === "intersection") {
      for (const member of sym.decl.members) {
        visit(member);
      }
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }

  for (const sym of project.symbols) {
    if (sym.kind === "brand") visit(sym.name);
  }
  return ordered;
}

/** Companion names visible to `cast` (all brand + validate symbols). */
export function companionNamesFromSymbols(
  project: DialectProjectSymbols,
): Set<string> {
  return new Set(project.byName.keys());
}

/** File scope helper for tests / #54 rules. */
export function getFileScope(
  project: DialectProjectSymbols,
  filename: string,
): FileScope | undefined {
  return project.scopes.get(filename);
}
