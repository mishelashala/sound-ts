/**
 * Parse a `.sts` source into a DialectProgram side-table.
 *
 * See ./README.md for the scanner + synthetic-snippet strategy.
 */

import * as ts from "typescript";
import type { BrandTypeDecl } from "../parse.js";
import type { ValidateTypeDecl } from "../validate.js";
import type { CheckedCastSite } from "../checkedCast.js";
import type { DialectProgram } from "./types.js";
import { createTriviaSkippingScanner, isIdent } from "./helpers.js";
import { parseBrandAt, parseBrandEnumAt } from "./parseBrand.js";
import { parseValidateAt } from "./parseValidate.js";
import { parseCastAt } from "./parseCast.js";
import { maskCommentsAndStrings } from "../mask.js";

export type { DialectProgram } from "./types.js";

/**
 * Walk the file with the TypeScript scanner; parse each dialect construct
 * into an explicit side-table entry with real source spans.
 *
 * Discovery runs on a comment/string/template-masked copy so the standalone
 * scanner cannot lose `${…}` template state and swallow the rest of the file.
 * Offsets stay aligned with the original source; payloads parse from `source`.
 */
export function parseSts(source: string): DialectProgram {
  const brands: BrandTypeDecl[] = [];
  const validates: ValidateTypeDecl[] = [];
  const casts: CheckedCastSite[] = [];

  // Mask keeps offsets; scanner sees spaces instead of templates/strings/comments.
  const scanText = maskCommentsAndStrings(source);
  const scanner = createTriviaSkippingScanner(scanText);
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (isIdent(scanner, "brand")) {
      const save = scanner.getTextPos();
      const brandPos = scanner.getTokenPos();
      scanner.scan();
      if (scanner.getToken() === ts.SyntaxKind.TypeKeyword) {
        scanner.setTextPos(brandPos);
        scanner.scan();
        // Parse against original source (spans match masked offsets).
        const decl = parseBrandAt(source, scanner);
        brands.push(decl);
        scanner.setTextPos(decl.end);
        token = scanner.scan();
        continue;
      }
      if (scanner.getToken() === ts.SyntaxKind.EnumKeyword) {
        scanner.setTextPos(brandPos);
        scanner.scan();
        const decl = parseBrandEnumAt(source, scanner);
        brands.push(decl);
        scanner.setTextPos(decl.end);
        token = scanner.scan();
        continue;
      }
      scanner.setTextPos(save);
      token = scanner.scan();
      continue;
    }

    if (isIdent(scanner, "validate")) {
      const save = scanner.getTextPos();
      const validatePos = scanner.getTokenPos();
      scanner.scan();
      if (scanner.getToken() === ts.SyntaxKind.TypeKeyword) {
        scanner.setTextPos(validatePos);
        scanner.scan();
        const decl = parseValidateAt(source, scanner);
        validates.push(decl);
        scanner.setTextPos(decl.end);
        token = scanner.scan();
        continue;
      }
      scanner.setTextPos(save);
      token = scanner.scan();
      continue;
    }

    if (isIdent(scanner, "cast")) {
      const save = scanner.getTextPos();
      const castPos = scanner.getTokenPos();
      scanner.scan();
      if (scanner.getToken() === ts.SyntaxKind.LessThanToken) {
        scanner.setTextPos(castPos);
        scanner.scan();
        const site = parseCastAt(source, scanner);
        casts.push(site);
        scanner.setTextPos(site.end);
        token = scanner.scan();
        continue;
      }
      scanner.setTextPos(save);
      token = scanner.scan();
      continue;
    }

    token = scanner.scan();
  }

  return { source, brands, validates, casts };
}
