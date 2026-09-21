/**
 * Parse one `cast<Target>(expr)` site (scanner on `cast`).
 */

import * as ts from "typescript";
import type { CheckedCastSite } from "../checkedCast.js";
import { scanBalancedParen, skipWs } from "./helpers.js";

export function parseCastAt(
  source: string,
  scanner: ts.Scanner,
): CheckedCastSite {
  const castStart = scanner.getTokenPos();
  scanner.scan(); // <
  if (scanner.getToken() !== ts.SyntaxKind.LessThanToken) {
    throw new SyntaxError(
      `cast: expected type name after 'cast<' (offset ${castStart})`,
    );
  }
  scanner.scan(); // Target
  let target: string;
  if (scanner.getToken() === ts.SyntaxKind.Identifier) {
    target = scanner.getTokenValue();
  } else if (scanner.getToken() === ts.SyntaxKind.StringKeyword) {
    target = "string";
  } else if (scanner.getToken() === ts.SyntaxKind.NumberKeyword) {
    target = "number";
  } else if (scanner.getToken() === ts.SyntaxKind.BooleanKeyword) {
    target = "boolean";
  } else {
    throw new SyntaxError(
      `cast: expected type name after 'cast<' (offset ${castStart})`,
    );
  }
  scanner.scan(); // >
  if (scanner.getToken() !== ts.SyntaxKind.GreaterThanToken) {
    throw new SyntaxError(
      `cast: expected '>' after type name (offset ${castStart})`,
    );
  }
  const afterGt = scanner.getTextPos();
  const openParen = skipWs(source, afterGt);
  if (source[openParen] !== "(") {
    throw new SyntaxError(
      `cast: expected '(' after cast<Target> (offset ${castStart})`,
    );
  }
  const closeEnd = scanBalancedParen(source, openParen);
  const closeParen = closeEnd - 1;

  let exprStart = openParen + 1;
  let exprEnd = closeParen;
  while (exprStart < exprEnd && /[\s\n\r\t]/.test(source[exprStart]!)) {
    exprStart++;
  }
  while (exprEnd > exprStart && /[\s\n\r\t]/.test(source[exprEnd - 1]!)) {
    exprEnd--;
  }
  if (exprStart >= exprEnd) {
    throw new SyntaxError(
      `cast: expected expression inside cast<…>(…) (offset ${castStart})`,
    );
  }

  return {
    start: castStart,
    end: closeEnd,
    expr: source.slice(exprStart, exprEnd),
    target,
  };
}
