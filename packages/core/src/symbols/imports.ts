/**
 * Collect stock TS import bindings from a `.sts` file via the TypeScript AST.
 * Dialect headers are blanked (same prep as soundness) so `createSourceFile` works.
 */

import * as ts from "typescript";
import { prepareDialectForTsAst } from "../soundness/ast.js";

export interface RawImportBinding {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
  start: number;
  end: number;
}

/**
 * Named + default imports only (companions are named exports after emit).
 * Namespace imports are ignored for dialect linking.
 */
export function collectImportBindings(source: string, filename?: string): RawImportBinding[] {
  const { parseText } = prepareDialectForTsAst(source);
  const sf = ts.createSourceFile(
    filename ?? "imports.sts",
    parseText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  const out: RawImportBinding[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.importClause || stmt.importClause.isTypeOnly) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const moduleSpecifier = spec.text;
    const clause = stmt.importClause;

    if (clause.name) {
      out.push({
        localName: clause.name.text,
        importedName: "default",
        moduleSpecifier,
        start: clause.name.getStart(sf),
        end: clause.name.getEnd(),
      });
    }

    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (el.isTypeOnly) continue;
        const importedName = (el.propertyName ?? el.name).text;
        const localName = el.name.text;
        out.push({
          localName,
          importedName,
          moduleSpecifier,
          start: el.getStart(sf),
          end: el.getEnd(),
        });
      }
    }
  }

  return out;
}
