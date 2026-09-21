/**
 * Emit method syntax as readonly function properties.
 *
 * Stock `tsc` skips `strictFunctionTypes` for method syntax (bivariant
 * parameters). Function properties get the contravariant check. Authors still
 * write `method()`; this pass rewrites emit only.
 *
 * Caveat: a class method becomes a readonly *instance* property whose value is
 * a function. Instance properties are not on the prototype, and `this` inside
 * the function is lexical (arrow), not the dynamic receiver.
 *
 * Object-literal methods are not rewritten (`readonly name = …` is invalid
 * inside `{…}`); use class methods or explicit function properties there.
 */

import * as ts from "typescript";

export interface RewriteMethodsResult {
  code: string;
  /** Number of methods rewritten */
  count: number;
}

function isGenerator(node: ts.MethodDeclaration): boolean {
  return node.asteriskToken !== undefined;
}

function typeParamsText(
  node: ts.MethodDeclaration | ts.MethodSignature,
  sf: ts.SourceFile,
): string {
  if (!node.typeParameters || node.typeParameters.length === 0) return "";
  return `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>`;
}

function paramsWithParens(
  node: ts.MethodDeclaration | ts.MethodSignature,
  source: string,
): string {
  let open = node.parameters.pos;
  while (open > 0 && source[open - 1] !== "(") open--;
  open--;
  let close = node.parameters.end;
  while (close < source.length && source[close] !== ")") close++;
  return source.slice(open, close + 1);
}

function modifierPrefix(
  node: ts.MethodDeclaration | ts.MethodSignature,
  sf: ts.SourceFile,
): { prefix: string; async: boolean } {
  let async = false;
  const kept: string[] = [];
  for (const mod of node.modifiers ?? []) {
    if (mod.kind === ts.SyntaxKind.AsyncKeyword) {
      async = true;
      continue;
    }
    // Drop decorators; keep visibility / static / abstract / override / declare
    if (ts.isDecorator(mod)) continue;
    kept.push(mod.getText(sf));
  }
  const prefix = kept.length ? kept.join(" ") + " " : "";
  return { prefix, async };
}

function trailingPunctuation(original: string): string {
  const m = original.match(/[;,]\s*$/);
  return m ? m[0]! : "";
}

function rewriteMethodSignature(
  node: ts.MethodSignature,
  source: string,
  sf: ts.SourceFile,
): string {
  const start = node.getStart(sf);
  const original = source.slice(start, node.end);
  const trail = trailingPunctuation(original) || ";";
  const { prefix } = modifierPrefix(node, sf);
  const name = node.name.getText(sf);
  const optional = node.questionToken ? "?" : "";
  const tparams = typeParamsText(node, sf);
  const params = paramsWithParens(node, source);
  const ret = node.type ? node.type.getText(sf) : "any";
  return `${prefix}readonly ${name}${optional}: ${tparams}${params} => ${ret}${trail}`;
}

function rewriteAbstractMethod(
  node: ts.MethodDeclaration,
  source: string,
  sf: ts.SourceFile,
): string {
  const start = node.getStart(sf);
  const original = source.slice(start, node.end);
  const trail = trailingPunctuation(original) || ";";
  const { prefix } = modifierPrefix(node, sf);
  const name = node.name.getText(sf);
  const tparams = typeParamsText(node, sf);
  const params = paramsWithParens(node, source);
  const ret = node.type ? node.type.getText(sf) : "any";
  return `${prefix}readonly ${name}: ${tparams}${params} => ${ret}${trail}`;
}

function rewriteMethodWithBody(
  node: ts.MethodDeclaration,
  source: string,
  sf: ts.SourceFile,
): string {
  const { prefix, async } = modifierPrefix(node, sf);
  const name = node.name.getText(sf);
  const tparams = typeParamsText(node, sf);
  const params = paramsWithParens(node, source);
  const ret = node.type ? `: ${node.type.getText(sf)}` : "";
  const body = node.body!.getText(sf);
  const asyncKw = async ? "async " : "";

  if (isGenerator(node)) {
    // Arrow functions cannot be generators; use a function* expression.
    return `${prefix}readonly ${name} = ${asyncKw}function* ${tparams}${params}${ret} ${body};`;
  }
  return `${prefix}readonly ${name} = ${asyncKw}${tparams}${params}${ret} => ${body};`;
}

function methodKey(node: ts.MethodDeclaration, sf: ts.SourceFile): string {
  const staticBit = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.StaticKeyword,
  )
    ? "static:"
    : "instance:";
  return staticBit + node.name.getText(sf);
}

/**
 * Rewrite method signatures / declarations in `source` to readonly function
 * properties so stock `strictFunctionTypes` applies.
 */
export function rewriteMethodsAsProperties(
  source: string,
): RewriteMethodsResult {
  const sf = ts.createSourceFile(
    "emit-methods.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Detect overload groups in classes (same name, multiple decls).
  // Object-literal methods are left alone: `readonly name = …` is invalid there.
  const declCounts = new Map<string, number>();
  const collectOverloads = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name) {
      const parent = node.parent;
      if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
        const key = `${parent.pos}:${methodKey(node, sf)}`;
        declCounts.set(key, (declCounts.get(key) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, collectOverloads);
  };
  collectOverloads(sf);

  const replacements: { start: number; end: number; text: string }[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isConstructorDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isMethodSignature(node) && node.name) {
      replacements.push({
        start: node.getStart(sf),
        end: node.end,
        text: rewriteMethodSignature(node, source, sf),
      });
      return;
    }

    if (ts.isMethodDeclaration(node) && node.name) {
      const parent = node.parent;
      const inClass =
        ts.isClassDeclaration(parent) || ts.isClassExpression(parent);

      if (!inClass) {
        // Skip object-literal / other method forms (emit would be invalid).
        ts.forEachChild(node, visit);
        return;
      }

      const key = `${parent.pos}:${methodKey(node, sf)}`;
      if ((declCounts.get(key) ?? 0) > 1) {
        // Leave overload groups as methods (property form cannot express them).
        ts.forEachChild(node, visit);
        return;
      }

      const isAbstract = !!node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
      );

      if (node.body) {
        replacements.push({
          start: node.getStart(sf),
          end: node.end,
          text: rewriteMethodWithBody(node, source, sf),
        });
        return;
      }

      if (isAbstract) {
        replacements.push({
          start: node.getStart(sf),
          end: node.end,
          text: rewriteAbstractMethod(node, source, sf),
        });
        return;
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (replacements.length === 0) {
    return { code: source, count: 0 };
  }

  replacements.sort((a, b) => b.start - a.start);
  let code = source;
  for (const r of replacements) {
    code = code.slice(0, r.start) + r.text + code.slice(r.end);
  }
  return { code, count: replacements.length };
}
