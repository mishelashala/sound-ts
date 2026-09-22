/**
 * 1.0 outbound widen — a dialect value is not the naked type.
 *
 * Stock `tsc` accepts `Fields & { readonly [Brand]: unique symbol }` as
 * `Fields` (extra properties are fine; excess-property checks apply only to
 * fresh object literals). That direction cannot be closed by a phantom
 * intersection and still allow field reads (`user.id`). This visitor is the
 * gate. It throws before emit and does not rewrite the value.
 *
 * Literal brands already refuse the bare union under stock `tsc` because
 * emit is `Members | (primitive & { readonly [Brand]: true })`. That emit
 * stays. `.toPrimitive` is the unwrap back to the bare union. Assignability
 * to the wide primitive (`string` / `number`) stays.
 *
 * What this sees: a binding whose annotation is the full naked field
 * structure (or the bare literal union), and whose initializer — or a later
 * `=` to that binding — is a validate-type / literal-brand value. Those values are
 * `.from` / `cast<>`, or a binding annotated as that
 * companion or initialized with one of those expressions.
 */

import * as ts from "typescript";
import type { LiteralBrandDecl } from "../parse.js";
import { lookupSymbol } from "../symbols/resolve.js";
import type { DialectProjectSymbols, DialectSymbol } from "../symbols/types.js";
import type { ValidateTypeDecl } from "../validate.js";
import {
  createSoundnessAst,
  formatLoc,
  isDialectTypeAlias,
  walkAst,
} from "./ast.js";

type Frame = Map<string, Facts>;

type Facts = {
  /** Dialect values this binding holds (annotation or initializer). */
  holds: DialectSymbol[];
  /** Naked structures this binding is annotated with. */
  naked: DialectSymbol[];
};

function literalDecl(sym: DialectSymbol): LiteralBrandDecl | undefined {
  if (sym.decl.kind === "literal") return sym.decl;
  return undefined;
}

function validateDecl(sym: DialectSymbol): ValidateTypeDecl | undefined {
  if (sym.decl.kind === "validate") return sym.decl;
  return undefined;
}

function isOutboundTarget(sym: DialectSymbol): boolean {
  return validateDecl(sym) !== undefined || literalDecl(sym) !== undefined;
}

function memberKey(member: ValidateTypeDecl["fields"][number]["type"]["members"][number]): string {
  if (member.kind === "null") return "null";
  if (member.kind === "primitive") return member.name;
  if (member.kind === "array") return `${member.element}[]`;
  if (member.kind === "date") return "Date";
  if (member.kind === "ref") return `ref:${member.name}`;
  return `obj:${fieldParts(member.fields).join(";")}`;
}

function fieldParts(fields: ValidateTypeDecl["fields"]): string[] {
  const parts = fields.map((field) => {
    const typeKey = field.type.members.map(memberKey).sort().join("|");
    const opt = field.optional ? "?" : "";
    return `${field.name}${opt}:${typeKey}`;
  });
  parts.sort();
  return parts;
}

function validateNakedKey(decl: ValidateTypeDecl): string {
  return `obj:${fieldParts(decl.fields).join(";")}`;
}

function literalNakedKey(decl: LiteralBrandDecl): string {
  const parts = decl.values.map((value) =>
    typeof value === "number" ? `n:${value}` : `s:${JSON.stringify(value)}`,
  );
  parts.sort();
  return `lit:${parts.join("|")}`;
}

function nakedKeyOf(sym: DialectSymbol): string | undefined {
  const validate = validateDecl(sym);
  if (validate) return validateNakedKey(validate);
  const literal = literalDecl(sym);
  if (literal) return literalNakedKey(literal);
  return undefined;
}

/**
 * Throw when a validate-type value is used as its naked field structure, or
 * a literal brand is used as its bare literal union, without `.toPrimitive`.
 */
export function assertNoOutboundWiden(
  source: string,
  symbols: DialectProjectSymbols,
  filename?: string,
): void {
  const carriers = symbols.symbols.filter(isOutboundTarget);
  if (carriers.length === 0) return;

  const scopeName = filename ?? "<stdin>";
  const resolveName = (name: string): DialectSymbol | undefined =>
    lookupSymbol(symbols, scopeName, name);

  const byNakedKey = new Map<string, DialectSymbol[]>();
  for (const sym of carriers) {
    const key = nakedKeyOf(sym);
    if (key === undefined) continue;
    const list = byNakedKey.get(key);
    if (list) list.push(sym);
    else byNakedKey.set(key, [sym]);
  }

  const { sf, dialectTypeOffsets } = createSoundnessAst(source, filename);
  const aliases = collectTypeAliasKeys(sf, dialectTypeOffsets);

  const frames: Frame[] = [new Map()];

  const lookupBinding = (name: string): Facts | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const hit = frames[i]!.get(name);
      if (hit) return hit;
    }
    return undefined;
  };

  const withFrame = (fn: () => void): void => {
    frames.push(new Map());
    try {
      fn();
    } finally {
      frames.pop();
    }
  };

  const unwrapType = (type: ts.TypeNode): ts.TypeNode => {
    let t = type;
    for (;;) {
      if (ts.isParenthesizedTypeNode(t)) {
        t = t.type;
        continue;
      }
      if (
        ts.isTypeOperatorNode(t) &&
        t.operator === ts.SyntaxKind.ReadonlyKeyword
      ) {
        t = t.type;
        continue;
      }
      if (
        ts.isTypeReferenceNode(t) &&
        ts.isIdentifier(t.typeName) &&
        t.typeName.text === "Readonly" &&
        t.typeArguments?.length === 1
      ) {
        t = t.typeArguments[0]!;
        continue;
      }
      return t;
    }
  };

  const typeNodeKey = (type: ts.TypeNode): string | undefined => {
    let t = type;
    while (ts.isParenthesizedTypeNode(t)) t = t.type;
    if (
      ts.isTypeOperatorNode(t) &&
      t.operator === ts.SyntaxKind.ReadonlyKeyword
    ) {
      return typeNodeKey(t.type);
    }
    if (t.kind === ts.SyntaxKind.StringKeyword) return "string";
    if (t.kind === ts.SyntaxKind.NumberKeyword) return "number";
    if (t.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
    if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) {
      return "null";
    }
    if (ts.isArrayTypeNode(t)) {
      const element = typeNodeKey(t.elementType);
      if (
        element === "string" ||
        element === "number" ||
        element === "boolean"
      ) {
        return `${element}[]`;
      }
      return undefined;
    }
    if (
      ts.isTypeReferenceNode(t) &&
      ts.isIdentifier(t.typeName) &&
      t.typeName.text === "Array" &&
      t.typeArguments?.length === 1
    ) {
      const element = typeNodeKey(t.typeArguments[0]!);
      if (
        element === "string" ||
        element === "number" ||
        element === "boolean"
      ) {
        return `${element}[]`;
      }
      return undefined;
    }
    if (ts.isTypeLiteralNode(t)) return objectKey(t);
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
      if (t.typeArguments && t.typeArguments.length > 0) return undefined;
      if (t.typeName.text === "Date") return "Date";
      return aliases.get(t.typeName.text);
    }
    if (ts.isUnionTypeNode(t)) {
      const parts: string[] = [];
      for (const arm of t.types) {
        const key = typeNodeKey(arm);
        if (key === undefined) return undefined;
        parts.push(key);
      }
      parts.sort();
      return parts.join("|");
    }
    return undefined;
  };

  const propNameOf = (name: ts.PropertyName): string | undefined => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name)
    ) {
      return name.text;
    }
    return undefined;
  };

  const objectKey = (type: ts.TypeLiteralNode): string | undefined => {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const member of type.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) {
        return undefined;
      }
      const name = propNameOf(member.name);
      if (name === undefined || seen.has(name)) return undefined;
      seen.add(name);
      const typeKey = typeNodeKey(member.type);
      if (typeKey === undefined) return undefined;
      const opt = member.questionToken ? "?" : "";
      parts.push(`${name}${opt}:${typeKey}`);
    }
    parts.sort();
    return `obj:${parts.join(";")}`;
  };

  const literalToken = (expr: ts.Expression): string | undefined => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return `s:${JSON.stringify(expr.text)}`;
    }
    if (ts.isNumericLiteral(expr)) return `n:${Number(expr.text)}`;
    if (
      ts.isPrefixUnaryExpression(expr) &&
      expr.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expr.operand)
    ) {
      return `n:${-Number(expr.operand.text)}`;
    }
    return undefined;
  };

  const literalUnionKey = (type: ts.TypeNode): string | undefined => {
    const t = unwrapType(type);
    const parts: string[] = [];
    const collect = (node: ts.TypeNode): boolean => {
      const inner = unwrapType(node);
      if (ts.isUnionTypeNode(inner)) {
        for (const arm of inner.types) {
          if (!collect(arm)) return false;
        }
        return true;
      }
      if (!ts.isLiteralTypeNode(inner)) return false;
      const token = literalToken(inner.literal);
      if (token === undefined) return false;
      parts.push(token);
      return true;
    };
    if (!collect(t) || parts.length === 0) return undefined;
    parts.sort();
    return `lit:${parts.join("|")}`;
  };

  const annotationKey = (type: ts.TypeNode): string | undefined => {
    const t = unwrapType(type);
    if (ts.isTypeLiteralNode(t)) return objectKey(t);
    if (ts.isUnionTypeNode(t) || ts.isLiteralTypeNode(t)) return literalUnionKey(t);
    return undefined;
  };

  const typeRefCarrier = (type: ts.TypeNode | undefined): DialectSymbol | undefined => {
    if (!type) return undefined;
    const t = unwrapType(type);
    if (!ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return undefined;
    if (t.typeArguments && t.typeArguments.length > 0) return undefined;
    const sym = resolveName(t.typeName.text);
    if (!sym || !isOutboundTarget(sym)) return undefined;
    return sym;
  };

  const matchingNaked = (type: ts.TypeNode | undefined): DialectSymbol[] => {
    if (!type) return [];
    // `const u: User` is the companion, not the naked structure. The blanked
    // AST still shows `type User = { … }` — do not expand that alias.
    if (typeRefCarrier(type)) return [];
    const key = annotationKey(type);
    if (key === undefined) return [];
    return byNakedKey.get(key) ?? [];
  };

  const unwrapExpr = (expr: ts.Expression): ts.Expression => {
    let e = expr;
    while (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    ) {
      e = e.expression;
    }
    return e;
  };

  const uniqueSyms = (list: DialectSymbol[]): DialectSymbol[] => {
    const seen = new Set<number>();
    const out: DialectSymbol[] = [];
    for (const sym of list) {
      if (seen.has(sym.id)) continue;
      seen.add(sym.id);
      out.push(sym);
    }
    return out;
  };

  const callCarrier = (call: ts.CallExpression): DialectSymbol | undefined => {
    const callee = unwrapExpr(call.expression);
    if (ts.isIdentifier(callee) && callee.text === "cast") {
      const arg = call.typeArguments?.[0];
      if (!arg) return undefined;
      return typeRefCarrier(arg);
    }
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (!ts.isIdentifier(callee.expression)) return undefined;
    const member = callee.name.text;
    if (member !== "from") return undefined;
    const sym = resolveName(callee.expression.text);
    if (!sym || !isOutboundTarget(sym)) return undefined;
    return sym;
  };

  const valuesIn = (expr: ts.Expression | undefined): DialectSymbol[] => {
    if (!expr) return [];
    const e = unwrapExpr(expr);
    if (ts.isIdentifier(e)) return lookupBinding(e.text)?.holds ?? [];
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      return valuesIn(e.right);
    }
    if (ts.isConditionalExpression(e)) {
      return uniqueSyms([...valuesIn(e.whenTrue), ...valuesIn(e.whenFalse)]);
    }
    if (ts.isCallExpression(e)) {
      const sym = callCarrier(e);
      return sym ? [sym] : [];
    }
    return [];
  };

  const reject = (at: number, sym: DialectSymbol): never => {
    const { prefix } = formatLoc(filename, source, at);
    if (validateDecl(sym)) {
      throw new SyntaxError(
        `${prefix}outbound widen of validate type '${sym.name}' to its naked field structure ` +
          `is not allowed in .sts (offset ${at}); ` +
          `stock tsc still accepts this assignment — this visitor is the gate`,
      );
    }
    throw new SyntaxError(
      `${prefix}outbound widen of literal brand '${sym.name}' to its bare literal union ` +
        `is not allowed in .sts (offset ${at}); ` +
        `unwrap with ${sym.name}.toPrimitive(…)`,
    );
  };

  const rejectIfWiden = (
    type: ts.TypeNode | undefined,
    expr: ts.Expression | undefined,
  ): void => {
    if (!type || !expr) return;
    const naked = matchingNaked(type);
    if (naked.length === 0) return;
    const nakedIds = new Set(naked.map((sym) => sym.id));
    const hit = valuesIn(expr).find((sym) => nakedIds.has(sym.id));
    if (hit) reject(expr.getStart(sf), hit);
  };

  const factsFor = (
    type: ts.TypeNode | undefined,
    initializer: ts.Expression | undefined,
  ): Facts => {
    const annotated = type ? typeRefCarrier(type) : undefined;
    const holds = annotated
      ? [annotated]
      : type
        ? []
        : valuesIn(initializer);
    return { holds, naked: matchingNaked(type) };
  };

  const bindName = (name: ts.BindingName, facts: Facts): void => {
    if (!ts.isIdentifier(name)) return;
    frames[frames.length - 1]!.set(name.text, facts);
  };

  const walkFunction = (
    node:
      | ts.FunctionDeclaration
      | ts.FunctionExpression
      | ts.ArrowFunction
      | ts.MethodDeclaration
      | ts.ConstructorDeclaration
      | ts.GetAccessorDeclaration
      | ts.SetAccessorDeclaration,
  ): void => {
    withFrame(() => {
      for (const param of node.parameters) {
        if (param.initializer) {
          walk(param.initializer);
          rejectIfWiden(param.type, param.initializer);
        }
        bindName(param.name, factsFor(param.type, param.initializer));
      }
      if (node.body) walk(node.body);
    });
  };

  const walk = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      walkFunction(node);
      return;
    }

    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      withFrame(() => {
        for (const statement of node.statements) walk(statement);
      });
      return;
    }

    if (ts.isClassLike(node)) {
      ts.forEachChild(node, (child) => {
        if (ts.isPropertyDeclaration(child)) {
          if (child.initializer) {
            walk(child.initializer);
            rejectIfWiden(child.type, child.initializer);
          }
          return;
        }
        walk(child);
      });
      return;
    }

    if (ts.isForStatement(node)) {
      withFrame(() => {
        if (node.initializer) walk(node.initializer);
        if (node.condition) walk(node.condition);
        if (node.incrementor) walk(node.incrementor);
        walk(node.statement);
      });
      return;
    }

    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      withFrame(() => {
        walk(node.expression);
        walk(node.initializer);
        walk(node.statement);
      });
      return;
    }

    if (ts.isCatchClause(node)) {
      withFrame(() => {
        if (node.variableDeclaration) {
          bindName(
            node.variableDeclaration.name,
            factsFor(node.variableDeclaration.type, undefined),
          );
        }
        walk(node.block);
      });
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) walk(node.initializer);
      rejectIfWiden(node.type, node.initializer);
      bindName(node.name, factsFor(node.type, node.initializer));
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      walk(node.right);
      walk(node.left);
      if (ts.isIdentifier(node.left)) {
        const facts = lookupBinding(node.left.text);
        if (facts && facts.naked.length > 0) {
          const nakedIds = new Set(facts.naked.map((sym) => sym.id));
          const hit = valuesIn(node.right).find((sym) => nakedIds.has(sym.id));
          if (hit) reject(node.right.getStart(sf), hit);
        }
      }
      return;
    }

    ts.forEachChild(node, walk);
  };

  walk(sf);
}

/**
 * Non-dialect aliases of primitive / array / union field types
 * (`type Id = string`) so `{ id: Id }` still matches a `string` field.
 * Dialect companions are excluded: after keyword blanking their alias is
 * the naked object, and expanding it would reject `const u: User`.
 */
function collectTypeAliasKeys(
  sf: ts.SourceFile,
  dialectTypeOffsets: ReadonlySet<number>,
): Map<string, string> {
  const decls: { name: string; type: ts.TypeNode }[] = [];
  walkAst(sf, (node) => {
    if (!ts.isTypeAliasDeclaration(node)) return;
    if (isDialectTypeAlias(node, sf, dialectTypeOffsets)) return;
    decls.push({ name: node.name.text, type: node.type });
  });

  const aliases = new Map<string, string>();
  const keyOf = (type: ts.TypeNode): string | undefined => {
    let t = type;
    while (ts.isParenthesizedTypeNode(t)) t = t.type;
    if (t.kind === ts.SyntaxKind.StringKeyword) return "string";
    if (t.kind === ts.SyntaxKind.NumberKeyword) return "number";
    if (t.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
    if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) {
      return "null";
    }
    if (ts.isArrayTypeNode(t)) {
      const element = keyOf(t.elementType);
      if (element === "string" || element === "number" || element === "boolean") {
        return `${element}[]`;
      }
      return undefined;
    }
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
      if (t.typeArguments && t.typeArguments.length > 0) return undefined;
      return aliases.get(t.typeName.text);
    }
    if (ts.isUnionTypeNode(t)) {
      const parts: string[] = [];
      for (const arm of t.types) {
        const key = keyOf(arm);
        if (key === undefined) return undefined;
        parts.push(key);
      }
      parts.sort();
      return parts.join("|");
    }
    return undefined;
  };

  for (let pass = 0; pass < decls.length; pass++) {
    for (const decl of decls) {
      const key = keyOf(decl.type);
      if (key !== undefined) aliases.set(decl.name, key);
    }
  }
  return aliases;
}
