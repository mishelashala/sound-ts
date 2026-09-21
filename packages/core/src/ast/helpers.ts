/**
 * Shared TypeScript scanner / synthetic-snippet helpers for the dialect frontend.
 */

import * as ts from "typescript";

export function createTriviaSkippingScanner(source: string): ts.Scanner {
  return ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.Standard,
    source,
  );
}

/** True when the current token is Identifier with the given text. */
export function isIdent(scanner: ts.Scanner, name: string): boolean {
  return (
    scanner.getToken() === ts.SyntaxKind.Identifier &&
    scanner.getTokenValue() === name
  );
}

/**
 * Parse `type __T = ${typeText}` and return the type node.
 * Throws SyntaxError if the snippet is not a single type alias.
 */
export function parseTypeSnippet(typeText: string, label: string): ts.TypeNode {
  const sf = ts.createSourceFile(
    "dialect-type.ts",
    `type __T = ${typeText}`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isTypeAliasDeclaration(stmt) || !stmt.type) {
    throw new SyntaxError(`${label}: could not parse type '${typeText}'`);
  }
  // Surface parser diagnostics that indicate real syntax failure
  const diags = (sf as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  if (diags && diags.length > 0) {
    const hard = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (hard.length > 0) {
      throw new SyntaxError(
        `${label}: ${ts.flattenDiagnosticMessageText(hard[0]!.messageText, "\n")}`,
      );
    }
  }
  return stmt.type;
}

/**
 * Parse a class with a single method body (refined brand `is`).
 */
export function parseClassMethodSnippet(
  methodText: string,
  label: string,
): { sf: ts.SourceFile; method: ts.MethodDeclaration } {
  const sf = ts.createSourceFile(
    "dialect-method.ts",
    `class __C {\n${methodText}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isClassDeclaration(stmt) || !stmt.members[0]) {
    throw new SyntaxError(`${label}: could not parse refined 'is' method`);
  }
  const member = stmt.members[0]!;
  if (!ts.isMethodDeclaration(member)) {
    throw new SyntaxError(`${label}: Mode B block must start with 'is(...)'`);
  }
  return { sf, method: member };
}

/** Skip spaces/tabs only (not newlines) in raw source. */
export function skipSpaces(source: string, i: number): number {
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return i;
}

/** Skip all whitespace including newlines. */
export function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

/**
 * If `keywordStart` is immediately preceded by `export` (whitespace only),
 * return a span that includes the export keyword.
 */
export function leadingExportStart(
  source: string,
  keywordStart: number,
): { start: number; exported: boolean } {
  let i = keywordStart;
  while (i > 0 && /[\s\n\r\t]/.test(source[i - 1]!)) i--;
  const kw = "export";
  if (i < kw.length) return { start: keywordStart, exported: false };
  if (source.slice(i - kw.length, i) !== kw) {
    return { start: keywordStart, exported: false };
  }
  const before = i - kw.length - 1;
  if (before >= 0 && /[A-Za-z0-9_$]/.test(source[before]!)) {
    return { start: keywordStart, exported: false };
  }
  return { start: i - kw.length, exported: true };
}

/**
 * Scan balanced `{…}` starting at `i` (must be `{`), respecting strings.
 * Returns index after the closing `}`.
 */
export function scanBalancedBrace(source: string, i: number): number {
  if (source[i] !== "{") {
    throw new SyntaxError(`expected '{' at offset ${i}`);
  }
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let escape = false;
  for (let j = i; j < source.length; j++) {
    const c = source[j]!;
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  throw new SyntaxError(`unclosed '{' starting at offset ${i}`);
}

/**
 * Scan balanced `(…)` starting at `i` (must be `(`).
 * Uses a trivia-skipping scanner over a slice so strings/templates are safe.
 */
export function scanBalancedParen(source: string, openParen: number): number {
  if (source[openParen] !== "(") {
    throw new SyntaxError(`expected '(' at offset ${openParen}`);
  }
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    source,
  );
  scanner.setTextPos(openParen);
  let depth = 0;
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.OpenParenToken) depth++;
    else if (token === ts.SyntaxKind.CloseParenToken) {
      depth--;
      if (depth === 0) return scanner.getTextPos();
    }
    token = scanner.scan();
  }
  throw new SyntaxError(`unbalanced '(' at offset ${openParen}`);
}
