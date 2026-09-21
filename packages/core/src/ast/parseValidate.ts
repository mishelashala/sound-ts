/**
 * Parse one `validate type` declaration (scanner on `validate`).
 */

import * as ts from "typescript";
import type {
  PrimitiveTypeName,
  ValidateField,
  ValidateMemberType,
  ValidateTypeDecl,
} from "../validate.js";
import {
  parseTypeSnippet,
  scanBalancedBrace,
  skipWs,
} from "./helpers.js";

const PRIMITIVES = new Set<PrimitiveTypeName>(["string", "number", "boolean"]);

function unsupportedFieldType(name: string, field: string, got: string): never {
  throw new SyntaxError(
    `validate type ${name}: unsupported field type '${got}' on '${field}' ` +
      `(allows string | number | boolean, optional ?, arrays of those, and unions of those)`,
  );
}

function primitiveFromType(
  t: ts.TypeNode,
  typeName: string,
  fieldName: string,
): PrimitiveTypeName {
  if (t.kind === ts.SyntaxKind.StringKeyword) return "string";
  if (t.kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (t.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const id = t.typeName.text;
    if (PRIMITIVES.has(id as PrimitiveTypeName)) {
      if (t.typeArguments && t.typeArguments.length > 0) {
        unsupportedFieldType(typeName, fieldName, `${id}<…>`);
      }
      return id as PrimitiveTypeName;
    }
    unsupportedFieldType(typeName, fieldName, id);
  }
  if (ts.isArrayTypeNode(t)) {
    // handled by caller
  }
  unsupportedFieldType(typeName, fieldName, t.getText?.() ?? String(t.kind));
}

function memberFromType(
  t: ts.TypeNode,
  typeName: string,
  fieldName: string,
): ValidateMemberType {
  if (ts.isArrayTypeNode(t)) {
    const el = primitiveFromType(t.elementType, typeName, fieldName);
    return { kind: "array", element: el };
  }
  // Reject Array<…> as type reference
  if (
    ts.isTypeReferenceNode(t) &&
    ts.isIdentifier(t.typeName) &&
    t.typeName.text === "Array"
  ) {
    unsupportedFieldType(typeName, fieldName, "Array");
  }
  if (ts.isTypeLiteralNode(t) || ts.isParenthesizedTypeNode(t)) {
    unsupportedFieldType(
      typeName,
      fieldName,
      ts.isTypeLiteralNode(t) ? "{" : "(",
    );
  }
  const prim = primitiveFromType(t, typeName, fieldName);
  return { kind: "primitive", name: prim };
}

function fieldTypeFromType(
  t: ts.TypeNode,
  typeName: string,
  fieldName: string,
): ValidateMemberType[] {
  if (ts.isUnionTypeNode(t)) {
    return t.types.map((eng) => memberFromType(eng, typeName, fieldName));
  }
  return [memberFromType(t, typeName, fieldName)];
}

function fieldsFromObjectType(
  type: ts.TypeNode,
  typeName: string,
): ValidateField[] {
  if (!ts.isTypeLiteralNode(type)) {
    throw new SyntaxError(
      `validate type ${typeName}: requires an object type '{ … }' after '=' ` +
        `(got '${type.getText?.() ?? "?"}')`,
    );
  }
  const fields: ValidateField[] = [];
  for (const member of type.members) {
    if (!ts.isPropertySignature(member) || !member.name) {
      throw new SyntaxError(
        `validate type ${typeName}: expected field name in object type`,
      );
    }
    if (!ts.isIdentifier(member.name)) {
      throw new SyntaxError(
        `validate type ${typeName}: expected field name in object type`,
      );
    }
    if (!member.type) {
      throw new SyntaxError(
        `validate type ${typeName}: expected ':' after field '${member.name.text}'`,
      );
    }
    const optional = member.questionToken !== undefined;
    const members = fieldTypeFromType(member.type, typeName, member.name.text);
    fields.push({
      name: member.name.text,
      optional,
      type: { members },
    });
  }
  if (fields.length === 0) {
    throw new SyntaxError(
      `validate type ${typeName}: object type must declare at least one field`,
    );
  }
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) {
      throw new SyntaxError(
        `validate type ${typeName}: duplicate field '${f.name}'`,
      );
    }
    seen.add(f.name);
  }
  return fields;
}

export function parseValidateAt(
  source: string,
  scanner: ts.Scanner,
): ValidateTypeDecl {
  const declStart = scanner.getTokenPos();
  scanner.scan(); // type
  if (scanner.getToken() !== ts.SyntaxKind.TypeKeyword) {
    throw new SyntaxError(`expected 'type' after 'validate'`);
  }
  scanner.scan(); // name
  if (scanner.getToken() !== ts.SyntaxKind.Identifier) {
    throw new SyntaxError(`validate type: expected name`);
  }
  const name = scanner.getTokenValue();
  scanner.scan(); // =
  if (scanner.getToken() !== ts.SyntaxKind.EqualsToken) {
    throw new SyntaxError(`validate type ${name}: expected '='`);
  }
  const rhsStart = skipWs(source, scanner.getTextPos());
  if (source[rhsStart] !== "{") {
    throw new SyntaxError(
      `validate type ${name}: requires an object type '{ … }' after '=' ` +
        `(got '${source[rhsStart] ?? "EOF"}')`,
    );
  }
  const braceEnd = scanBalancedBrace(source, rhsStart);
  const objectText = source.slice(rhsStart, braceEnd);
  const typeNode = parseTypeSnippet(objectText, `validate type ${name}`);
  const fields = fieldsFromObjectType(typeNode, name);

  let end = skipWs(source, braceEnd);
  if (source[end] === ";") end++;

  return {
    kind: "validate",
    name,
    fields,
    raw: source.slice(declStart, end),
    start: declStart,
    end,
  };
}
