/**
 * Parse one `brand type` declaration starting at `brand` (scanner positioned there).
 * Advances the scanner past the declaration.
 */

import * as ts from "typescript";
import type {
  BrandTypeDecl,
  CombinedBrandDecl,
  LiteralBrandDecl,
  RefinedBrandDecl,
} from "../parse.js";
import {
  createTriviaSkippingScanner,
  parseClassMethodSnippet,
  parseTypeSnippet,
  scanBalancedBrace,
  skipWs,
  leadingExportStart,
} from "./helpers.js";

function unquoteStringLiteral(node: ts.StringLiteral): string {
  // node.text is already unescaped by the TS parser
  return node.text;
}

function numericLiteralValue(expr: ts.Expression, name: string): number {
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text);
  }
  throw new SyntaxError(
    `brand type ${name}: expected number literal in union`,
  );
}

function literalValuesFromType(
  type: ts.TypeNode,
  name: string,
): { primitive: "string" | "number"; values: (string | number)[] } {
  const values: (string | number)[] = [];
  let primitive: "string" | "number" | undefined;
  const collect = (t: ts.TypeNode): void => {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
      if (primitive === "number") {
        throw new SyntaxError(
          `brand type ${name}: cannot mix string and number literals`,
        );
      }
      primitive = "string";
      values.push(unquoteStringLiteral(t.literal));
      return;
    }
    if (ts.isLiteralTypeNode(t)) {
      const n = numericLiteralValue(t.literal, name);
      if (primitive === "string") {
        throw new SyntaxError(
          `brand type ${name}: cannot mix string and number literals`,
        );
      }
      primitive = "number";
      values.push(n);
      return;
    }
    if (ts.isUnionTypeNode(t)) {
      for (const eng of t.types) collect(eng);
      return;
    }
    throw new SyntaxError(
      `brand type ${name}: expected string or number literal in union`,
    );
  };
  collect(type);
  if (primitive === undefined || values.length === 0) {
    throw new SyntaxError(`brand type ${name}: empty literal union`);
  }
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new SyntaxError(
      `brand type ${name}: duplicate literals are not allowed`,
    );
  }
  return { primitive, values };
}

function brandMembersFromType(
  type: ts.TypeNode,
  name: string,
): { kind: "union" | "intersection"; members: string[] } {
  const members: string[] = [];
  let kind: "union" | "intersection" = "union";

  const takeIdent = (t: ts.TypeNode): string => {
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
      if (t.typeArguments && t.typeArguments.length > 0) {
        throw new SyntaxError(
          `brand type ${name}: unexpected token after '${t.typeName.text}' ` +
            `(refined brands need '{ is(...) }'; unions need '|' / '&' between brand names)`,
        );
      }
      return t.typeName.text;
    }
    // Open types / keywords — kept as names so brand-map resolution can reject
    if (t.kind === ts.SyntaxKind.StringKeyword) return "string";
    if (t.kind === ts.SyntaxKind.NumberKeyword) return "number";
    if (t.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
    if (t.kind === ts.SyntaxKind.AnyKeyword) return "any";
    if (t.kind === ts.SyntaxKind.UnknownKeyword) return "unknown";
    if (t.kind === ts.SyntaxKind.NeverKeyword) return "never";
    if (t.kind === ts.SyntaxKind.ObjectKeyword) return "object";
    if (t.kind === ts.SyntaxKind.SymbolKeyword) return "symbol";
    if (t.kind === ts.SyntaxKind.UndefinedKeyword) return "undefined";
    if (t.kind === ts.SyntaxKind.NullKeyword) return "null";
    throw new SyntaxError(
      `brand type ${name}: expected brand name in union/intersection`,
    );
  };

  if (ts.isUnionTypeNode(type)) {
    kind = "union";
    for (const eng of type.types) members.push(takeIdent(eng));
  } else if (ts.isIntersectionTypeNode(type)) {
    kind = "intersection";
    for (const eng of type.types) members.push(takeIdent(eng));
  } else {
    members.push(takeIdent(type));
    kind = "union";
  }

  if (members.length === 0) {
    throw new SyntaxError(`brand type ${name}: empty union/intersection`);
  }
  return { kind, members };
}

/**
 * Slice RHS text for a non-refined brand: from `rhsStart` through optional `;`,
 * stopping before the next statement-ish token when no semicolon.
 *
 * Uses a scanner so `|` / `&` / string literals are included; stops at `;` or
 * at a position where continuing would start another top-level construct.
 */
function sliceBrandRhs(
  source: string,
  rhsStart: number,
  name: string,
): { text: string; end: number; literal: "string" | "number" | null } {
  const scanner = createTriviaSkippingScanner(source);
  scanner.setTextPos(rhsStart);
  let token = scanner.scan();
  if (token === ts.SyntaxKind.EndOfFileToken) {
    throw new SyntaxError(
      `brand type ${name}: expected string literal, base type, or brand name after '='`,
    );
  }

  // TypeScript allows a leading `|` on multiline unions (`= | "a" | "b"`).
  if (token === ts.SyntaxKind.BarToken) {
    token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) {
      throw new SyntaxError(
        `brand type ${name}: expected string literal or brand name after leading '|'`,
      );
    }
  }

  const literal: "string" | "number" | null =
    token === ts.SyntaxKind.StringLiteral
      ? "string"
      : token === ts.SyntaxKind.NumericLiteral ||
          token === ts.SyntaxKind.MinusToken
        ? "number"
        : null;
  let lastEnd = scanner.getTextPos();
  let sawOp = false;

  const expectLiteralMember = (kind: "string" | "number"): void => {
    if (kind === "string") {
      if (token !== ts.SyntaxKind.StringLiteral) {
        throw new SyntaxError(
          `brand type ${name}: expected string literal in union`,
        );
      }
      return;
    }
    if (token === ts.SyntaxKind.MinusToken) {
      token = scanner.scan();
      if (token !== ts.SyntaxKind.NumericLiteral) {
        throw new SyntaxError(
          `brand type ${name}: expected number literal in union`,
        );
      }
      return;
    }
    if (token !== ts.SyntaxKind.NumericLiteral) {
      throw new SyntaxError(
        `brand type ${name}: expected number literal in union`,
      );
    }
  };

  if (literal) {
    expectLiteralMember(literal);
    for (;;) {
      lastEnd = scanner.getTextPos();
      token = scanner.scan();
      if (token === ts.SyntaxKind.BarToken) {
        sawOp = true;
        token = scanner.scan();
        expectLiteralMember(literal);
        lastEnd = scanner.getTextPos();
        continue;
      }
      break;
    }
  } else if (token === ts.SyntaxKind.Identifier) {
    // Could be refined (`Name {`), combined (`A | B`), or single alias.
    lastEnd = scanner.getTextPos();
    const afterIdent = skipWs(source, lastEnd);
    if (source[afterIdent] === "{") {
      // Caller handles refined separately — should not reach here.
      throw new SyntaxError(
        `brand type ${name}: internal error — refined RHS in sliceBrandRhs`,
      );
    }
    token = scanner.scan();
    if (
      token === ts.SyntaxKind.BarToken ||
      token === ts.SyntaxKind.AmpersandToken
    ) {
      const firstOp = token;
      sawOp = true;
      for (;;) {
        token = scanner.scan();
        if (
          token !== ts.SyntaxKind.Identifier &&
          token !== ts.SyntaxKind.StringKeyword &&
          token !== ts.SyntaxKind.NumberKeyword &&
          token !== ts.SyntaxKind.BooleanKeyword &&
          token !== ts.SyntaxKind.AnyKeyword &&
          token !== ts.SyntaxKind.UnknownKeyword &&
          token !== ts.SyntaxKind.ObjectKeyword &&
          token !== ts.SyntaxKind.SymbolKeyword &&
          token !== ts.SyntaxKind.NeverKeyword &&
          token !== ts.SyntaxKind.UndefinedKeyword &&
          token !== ts.SyntaxKind.NullKeyword
        ) {
          throw new SyntaxError(
            `brand type ${name}: expected brand name in union/intersection`,
          );
        }
        lastEnd = scanner.getTextPos();
        token = scanner.scan();
        if (token === ts.SyntaxKind.BarToken || token === ts.SyntaxKind.AmpersandToken) {
          if (token !== firstOp) {
            throw new SyntaxError(
              `brand type ${name}: cannot mix '|' and '&' in one brand declaration`,
            );
          }
          continue;
        }
        break;
      }
    }
  } else {
    throw new SyntaxError(
      `brand type ${name}: expected string literal, base type, or brand name after '='`,
    );
  }

  // Optional trailing semicolon (may still be next token)
  let end = lastEnd;
  if (token === ts.SyntaxKind.SemicolonToken) {
    end = scanner.getTextPos();
  } else {
    // Semicolon may sit in trivia-skipped gap — check raw source
    const semi = skipWs(source, lastEnd);
    if (source[semi] === ";") end = semi + 1;
  }

  void sawOp;
  // Drop a leading `|` from the sliced text so synthetic `type __T = …` parses.
  let text = source.slice(rhsStart, lastEnd).trim();
  if (text.startsWith("|")) {
    text = text.slice(1).trim();
  }
  return {
    text,
    end,
    literal,
  };
}

function parseRefinedBrand(
  source: string,
  declStart: number,
  name: string,
  rhsStart: number,
  exported: boolean,
): RefinedBrandDecl {
  const scanner = createTriviaSkippingScanner(source);
  scanner.setTextPos(rhsStart);
  let token = scanner.scan();
  if (token !== ts.SyntaxKind.Identifier) {
    // number / string / boolean as base
    const kw =
      token === ts.SyntaxKind.NumberKeyword
        ? "number"
        : token === ts.SyntaxKind.StringKeyword
          ? "string"
          : token === ts.SyntaxKind.BooleanKeyword
            ? "boolean"
            : null;
    if (!kw) {
      throw new SyntaxError(
        `brand type ${name}: expected base type before '{' in Mode B refined brand`,
      );
    }
  }
  const baseType =
    token === ts.SyntaxKind.Identifier
      ? scanner.getTokenValue()
      : token === ts.SyntaxKind.NumberKeyword
        ? "number"
        : token === ts.SyntaxKind.StringKeyword
          ? "string"
          : "boolean";
  const afterBase = scanner.getTextPos();
  const bracePos = skipWs(source, afterBase);
  if (source[bracePos] !== "{") {
    throw new SyntaxError(
      `brand type ${name}: expected '{' after base type '${baseType}'`,
    );
  }
  const blockEnd = scanBalancedBrace(source, bracePos);
  const inner = source.slice(bracePos + 1, blockEnd - 1);
  const { sf, method } = parseClassMethodSnippet(inner.trim(), `brand type ${name}`);

  if (!method.name || !ts.isIdentifier(method.name) || method.name.text !== "is") {
    throw new SyntaxError(
      `brand type ${name}: Mode B block must start with 'is(...)'`,
    );
  }
  if (!method.parameters || method.parameters.length !== 1) {
    throw new SyntaxError(
      `brand type ${name}: expected parameter name in is(...)`,
    );
  }
  const param = method.parameters[0]!;
  if (!ts.isIdentifier(param.name)) {
    throw new SyntaxError(
      `brand type ${name}: expected parameter name in is(...)`,
    );
  }
  const isParamName = param.name.text;
  let isParamType: string;
  if (!param.type) {
    throw new SyntaxError(
      `brand type ${name}: expected parameter type in is(...)`,
    );
  }
  if (ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
    isParamType = param.type.typeName.text;
  } else if (param.type.kind === ts.SyntaxKind.NumberKeyword) {
    isParamType = "number";
  } else if (param.type.kind === ts.SyntaxKind.StringKeyword) {
    isParamType = "string";
  } else if (param.type.kind === ts.SyntaxKind.BooleanKeyword) {
    isParamType = "boolean";
  } else {
    throw new SyntaxError(
      `brand type ${name}: expected parameter type in is(...)`,
    );
  }

  // Type predicate: `param is Name`
  if (!method.type || !ts.isTypePredicateNode(method.type)) {
    throw new SyntaxError(
      `brand type ${name}: expected return type ': ${isParamName} is ${name}' after is(...)`,
    );
  }
  const pred = method.type;
  if (!pred.parameterName || !ts.isIdentifier(pred.parameterName)) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must be '${isParamName} is ${name}'`,
    );
  }
  if (pred.parameterName.text !== isParamName) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must be '${isParamName} is ${name}'`,
    );
  }
  if (!pred.type || !ts.isTypeReferenceNode(pred.type) || !ts.isIdentifier(pred.type.typeName)) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must refine '${name}' (got '?')`,
    );
  }
  if (pred.type.typeName.text !== name) {
    throw new SyntaxError(
      `brand type ${name}: type predicate must refine '${name}' (got '${pred.type.typeName.text}')`,
    );
  }
  if (!method.body) {
    throw new SyntaxError(
      `brand type ${name}: expected '{' for is() body`,
    );
  }

  // Body text without surrounding braces — parity with old scanner slice
  const bodyFull = method.body.getText(sf);
  let isBody = bodyFull.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
  isBody = isBody.replace(/^\n/, "").replace(/\n\s*$/, "");

  // Reject trailing junk after the method inside the Mode B block
  const methodEndInInner = method.getEnd();
  // method positions are relative to the class snippet, not `inner`.
  // Re-check by ensuring the class has exactly one member (already) and
  // that trimming inner left only the method — parseClassMethodSnippet
  // already requires a single member; extra tokens become extra members or diags.
  const classStmt = sf.statements[0];
  if (
    classStmt &&
    ts.isClassDeclaration(classStmt) &&
    classStmt.members.length > 1
  ) {
    throw new SyntaxError(
      `brand type ${name}: unexpected tokens after is() body in Mode B block`,
    );
  }
  void methodEndInInner;

  let end = skipWs(source, blockEnd);
  if (source[end] === ";") end++;

  return {
    kind: "refined",
    name,
    baseType,
    isParamName,
    isParamType,
    isBody,
    raw: source.slice(declStart, end),
    start: declStart,
    end,
    exported,
  };
}

const ENUM_RESERVED = new Set([
  "name",
  "values",
  "is",
  "from",
  "toPrimitive",
]);

/**
 * Parse `brand enum`. Scanner must be on `brand`.
 * A member name is a companion property (`AccountCode.Zero`).
 */
export function parseBrandEnumAt(
  source: string,
  scanner: ts.Scanner,
): LiteralBrandDecl {
  const brandTokenStart = scanner.getTokenPos();
  const { start: declStart, exported } = leadingExportStart(
    source,
    brandTokenStart,
  );
  scanner.scan();
  if (scanner.getToken() !== ts.SyntaxKind.EnumKeyword) {
    throw new SyntaxError(`expected 'enum' after 'brand'`);
  }
  scanner.scan();
  if (scanner.getToken() !== ts.SyntaxKind.Identifier) {
    throw new SyntaxError(`brand enum: expected name`);
  }
  const name = scanner.getTokenValue();
  scanner.scan();
  if (scanner.getToken() !== ts.SyntaxKind.OpenBraceToken) {
    throw new SyntaxError(`brand enum ${name}: expected '{'`);
  }
  scanner.scan();

  const members: { name: string; value: number }[] = [];
  const seenNames = new Set<string>();
  const seenValues = new Set<number>();

  while (scanner.getToken() !== ts.SyntaxKind.CloseBraceToken) {
    if (scanner.getToken() === ts.SyntaxKind.EndOfFileToken) {
      throw new SyntaxError(`brand enum ${name}: expected '}'`);
    }
    const memberName = scanner.getTokenValue();
    if (ENUM_RESERVED.has(memberName)) {
      throw new SyntaxError(
        `brand enum ${name}: member '${memberName}' is reserved`,
      );
    }
    if (scanner.getToken() !== ts.SyntaxKind.Identifier) {
      throw new SyntaxError(`brand enum ${name}: expected member name`);
    }
    if (seenNames.has(memberName)) {
      throw new SyntaxError(
        `brand enum ${name}: duplicate member '${memberName}'`,
      );
    }
    scanner.scan();
    if (scanner.getToken() !== ts.SyntaxKind.EqualsToken) {
      throw new SyntaxError(
        `brand enum ${name}: expected '=' after '${memberName}'`,
      );
    }
    scanner.scan();
    let value: number;
    if (scanner.getToken() === ts.SyntaxKind.MinusToken) {
      scanner.scan();
      if (scanner.getToken() !== ts.SyntaxKind.NumericLiteral) {
        throw new SyntaxError(
          `brand enum ${name}: expected number after '-'`,
        );
      }
      value = -Number(scanner.getTokenValue());
    } else if (scanner.getToken() === ts.SyntaxKind.NumericLiteral) {
      value = Number(scanner.getTokenValue());
    } else {
      throw new SyntaxError(
        `brand enum ${name}: expected number literal for '${memberName}'`,
      );
    }
    if (!Number.isFinite(value)) {
      throw new SyntaxError(
        `brand enum ${name}: expected finite number for '${memberName}'`,
      );
    }
    if (seenValues.has(value)) {
      throw new SyntaxError(`brand enum ${name}: duplicate value ${value}`);
    }
    seenNames.add(memberName);
    seenValues.add(value);
    members.push({ name: memberName, value });
    scanner.scan();
    if (scanner.getToken() === ts.SyntaxKind.CommaToken) {
      scanner.scan();
    }
  }
  if (members.length === 0) {
    throw new SyntaxError(`brand enum ${name}: expected at least one member`);
  }
  scanner.scan();
  if (scanner.getToken() === ts.SyntaxKind.SemicolonToken) {
    scanner.scan();
  }
  const end = scanner.getTokenPos();
  const decl: LiteralBrandDecl = {
    kind: "literal",
    name,
    primitive: "number",
    values: members.map((member) => member.value),
    members,
    raw: source.slice(declStart, end),
    start: declStart,
    end,
    exported,
  };
  return decl;
}

/**
 * Parse brand decl. Scanner must be on `brand`. Returns decl and end offset;
 * caller should setTextPos(end) before continuing.
 */
export function parseBrandAt(
  source: string,
  scanner: ts.Scanner,
): BrandTypeDecl {
  const brandTokenStart = scanner.getTokenPos();
  const { start: declStart, exported } = leadingExportStart(
    source,
    brandTokenStart,
  );
  // brand
  scanner.scan(); // type
  if (scanner.getToken() !== ts.SyntaxKind.TypeKeyword) {
    throw new SyntaxError(`expected 'type' after 'brand'`);
  }
  scanner.scan(); // name
  if (scanner.getToken() !== ts.SyntaxKind.Identifier) {
    throw new SyntaxError(`brand type: expected name`);
  }
  const name = scanner.getTokenValue();
  scanner.scan(); // =
  if (scanner.getToken() !== ts.SyntaxKind.EqualsToken) {
    throw new SyntaxError(`brand type ${name}: expected '='`);
  }
  const rhsStart = skipWs(source, scanner.getTextPos());

  // Refined if Ident/{keyword} then `{`
  const peek = createTriviaSkippingScanner(source);
  peek.setTextPos(rhsStart);
  const first = peek.scan();
  const afterFirst = peek.getTextPos();
  const afterFirstWs = skipWs(source, afterFirst);
  if (
    (first === ts.SyntaxKind.Identifier ||
      first === ts.SyntaxKind.NumberKeyword ||
      first === ts.SyntaxKind.StringKeyword ||
      first === ts.SyntaxKind.BooleanKeyword) &&
    source[afterFirstWs] === "{"
  ) {
    return parseRefinedBrand(source, declStart, name, rhsStart, exported);
  }

  const sliced = sliceBrandRhs(source, rhsStart, name);
  const typeNode = parseTypeSnippet(sliced.text, `brand type ${name}`);

  if (sliced.literal) {
    const { primitive, values } = literalValuesFromType(typeNode, name);
    const decl: LiteralBrandDecl = {
      kind: "literal",
      name,
      primitive,
      values,
      raw: source.slice(declStart, sliced.end),
      start: declStart,
      end: sliced.end,
      exported,
    };
    return decl;
  }

  const combined = brandMembersFromType(typeNode, name);
  // Detect mixed | and & — TS parser won't produce a mixed node; sliceBrandRhs already rejects.
  const decl: CombinedBrandDecl = {
    kind: combined.kind,
    name,
    members: combined.members,
    raw: source.slice(declStart, sliced.end),
    start: declStart,
    end: sliced.end,
    exported,
  };
  return decl;
}
