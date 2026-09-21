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
  leadingExportStart,
  parseTypeSnippet,
  scanBalancedBrace,
  skipWs,
} from "./helpers.js";

const PRIMITIVES = new Set<PrimitiveTypeName>(["string", "number", "boolean"]);

const ALLOWED_FIELD_SHAPES =
  "allows string | number | boolean | null, optional ?, arrays of primitives, " +
  "unions of those, nested objects, Date, and brand type or validate type names";

function unsupportedFieldType(name: string, field: string, got: string): never {
  throw new SyntaxError(
    `validate type ${name}: unsupported field type '${got}' on '${field}' ` +
      `(${ALLOWED_FIELD_SHAPES})`,
  );
}

function isNullType(t: ts.TypeNode): boolean {
  return (
    t.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

function isPrimitiveTypeNode(t: ts.TypeNode): boolean {
  if (t.kind === ts.SyntaxKind.StringKeyword) return true;
  if (t.kind === ts.SyntaxKind.NumberKeyword) return true;
  if (t.kind === ts.SyntaxKind.BooleanKeyword) return true;
  if (
    ts.isTypeReferenceNode(t) &&
    ts.isIdentifier(t.typeName) &&
    (!t.typeArguments || t.typeArguments.length === 0) &&
    PRIMITIVES.has(t.typeName.text as PrimitiveTypeName)
  ) {
    return true;
  }
  return false;
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
  if (ts.isParenthesizedTypeNode(t)) {
    return memberFromType(t.type, typeName, fieldName);
  }
  // TS represents `null` in type position as LiteralType(NullKeyword)
  if (isNullType(t)) {
    return { kind: "null" };
  }
  if (ts.isArrayTypeNode(t)) {
    const el = t.elementType;
    if (isNullType(el)) {
      unsupportedFieldType(typeName, fieldName, "null[]");
    }
    if (!isPrimitiveTypeNode(el)) {
      unsupportedFieldType(typeName, fieldName, t.getText());
    }
    const prim = primitiveFromType(el, typeName, fieldName);
    return { kind: "array", element: prim };
  }
  if (ts.isTypeLiteralNode(t)) {
    return { kind: "object", fields: fieldsFromObjectType(t, typeName) };
  }
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    if (t.typeArguments && t.typeArguments.length > 0) {
      unsupportedFieldType(typeName, fieldName, t.getText());
    }
    const id = t.typeName.text;
    if (id === "Date") return { kind: "date" };
    if (PRIMITIVES.has(id as PrimitiveTypeName)) {
      return { kind: "primitive", name: id as PrimitiveTypeName };
    }
    return { kind: "ref", name: id };
  }
  if (
    t.kind === ts.SyntaxKind.StringKeyword ||
    t.kind === ts.SyntaxKind.NumberKeyword ||
    t.kind === ts.SyntaxKind.BooleanKeyword
  ) {
    const prim = primitiveFromType(t, typeName, fieldName);
    return { kind: "primitive", name: prim };
  }
  unsupportedFieldType(typeName, fieldName, t.getText());
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
  const validateTokenStart = scanner.getTokenPos();
  const { start: declStart, exported } = leadingExportStart(
    source,
    validateTokenStart,
  );
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
    exported,
  };
}
