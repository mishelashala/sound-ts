/**
 * `validate type` — runtime validation companions from object types.
 *
 * Supported field shapes: `string` | `number` | `boolean`, optional `?`,
 * arrays of those primitives (`string[]`), and unions of those.
 * Emits a phantom-branded type (unique symbol) + the same `.is` / `.from`
 * companion shape as refined `brand type`, so stock `tsc` blocks bare
 * object literals from assigning without `.from` / `cast`.
 */

import { maskCommentsAndStrings } from "./parse.js";

export type PrimitiveTypeName = "string" | "number" | "boolean";

export type ValidateMemberType =
  | { kind: "primitive"; name: PrimitiveTypeName }
  | { kind: "array"; element: PrimitiveTypeName };

export interface ValidateFieldType {
  members: ValidateMemberType[];
}

export interface ValidateField {
  name: string;
  optional: boolean;
  type: ValidateFieldType;
}

export interface ValidateTypeDecl {
  kind: "validate";
  name: string;
  fields: ValidateField[];
  raw: string;
  start: number;
  end: number;
}

export interface ValidateParseResult {
  decls: ValidateTypeDecl[];
}

const IDENT = /[A-Za-z_$][\w$]*/;
const PRIMITIVES = new Set<PrimitiveTypeName>(["string", "number", "boolean"]);

function skipWs(source: string, i: number): number {
  while (i < source.length && /[\s\n\r\t]/.test(source[i]!)) i++;
  return i;
}

function matchIdent(
  source: string,
  i: number,
): { ident: string; end: number } | null {
  const m = source.slice(i).match(new RegExp("^" + IDENT.source));
  if (!m) return null;
  return { ident: m[0], end: i + m[0].length };
}

function scanBalancedBrace(source: string, i: number): number {
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

function unsupportedFieldType(name: string, field: string, got: string): never {
  throw new SyntaxError(
    `validate type ${name}: unsupported field type '${got}' on '${field}' ` +
      `(allows string | number | boolean, optional ?, arrays of those, and unions of those)`,
  );
}

function parseMemberType(
  source: string,
  i: number,
  typeName: string,
  fieldName: string,
): { member: ValidateMemberType; end: number } {
  const id = matchIdent(source, i);
  if (!id) {
    unsupportedFieldType(typeName, fieldName, source[i] ?? "EOF");
  }
  if (!PRIMITIVES.has(id.ident as PrimitiveTypeName)) {
    unsupportedFieldType(typeName, fieldName, id.ident);
  }
  const prim = id.ident as PrimitiveTypeName;
  let pos = skipWs(source, id.end);
  if (source[pos] === "[" && source[pos + 1] === "]") {
    return {
      member: { kind: "array", element: prim },
      end: pos + 2,
    };
  }
  // Reject Array<…>, generics, nested objects starting after ident, etc.
  if (source[pos] === "<") {
    unsupportedFieldType(typeName, fieldName, `${prim}<…>`);
  }
  return { member: { kind: "primitive", name: prim }, end: id.end };
}

function parseFieldType(
  source: string,
  i: number,
  typeName: string,
  fieldName: string,
): { type: ValidateFieldType; end: number } {
  const members: ValidateMemberType[] = [];
  let pos = skipWs(source, i);
  for (;;) {
    // Nested object / paren groups are unsupported
    if (source[pos] === "{" || source[pos] === "(") {
      unsupportedFieldType(typeName, fieldName, source[pos]!);
    }
    const parsed = parseMemberType(source, pos, typeName, fieldName);
    members.push(parsed.member);
    pos = skipWs(source, parsed.end);
    if (source[pos] === "|") {
      pos = skipWs(source, pos + 1);
      continue;
    }
    break;
  }
  if (members.length === 0) {
    unsupportedFieldType(typeName, fieldName, "empty");
  }
  return { type: { members }, end: pos };
}

function parseObjectFields(
  source: string,
  braceStart: number,
  typeName: string,
): { fields: ValidateField[]; end: number } {
  const braceEnd = scanBalancedBrace(source, braceStart);
  const inner = source.slice(braceStart + 1, braceEnd - 1);
  const fields: ValidateField[] = [];
  let i = skipWs(inner, 0);
  while (i < inner.length) {
    const nameTok = matchIdent(inner, i);
    if (!nameTok) {
      throw new SyntaxError(
        `validate type ${typeName}: expected field name in object type`,
      );
    }
    let pos = skipWs(inner, nameTok.end);
    let optional = false;
    if (inner[pos] === "?") {
      optional = true;
      pos = skipWs(inner, pos + 1);
    }
    if (inner[pos] !== ":") {
      throw new SyntaxError(
        `validate type ${typeName}: expected ':' after field '${nameTok.ident}'`,
      );
    }
    pos = skipWs(inner, pos + 1);
    const fieldType = parseFieldType(inner, pos, typeName, nameTok.ident);
    fields.push({
      name: nameTok.ident,
      optional,
      type: fieldType.type,
    });
    pos = skipWs(inner, fieldType.end);
    if (inner[pos] === ";" || inner[pos] === ",") {
      pos = skipWs(inner, pos + 1);
    }
    i = pos;
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
  return { fields, end: braceEnd };
}

/**
 * Find all `validate type` declarations in source text.
 * Scans a comment/string-masked copy; parses spans from the original source.
 */
export function parseValidateTypes(source: string): ValidateParseResult {
  const decls: ValidateTypeDecl[] = [];
  const scan = maskCommentsAndStrings(source);
  const headerRe = /\bvalidate\s+type\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m: RegExpExecArray | null;

  while ((m = headerRe.exec(scan)) !== null) {
    const name = m[1]!;
    const declStart = m.index;
    const afterEq = m.index + m[0].length;
    let i = skipWs(source, afterEq);
    if (source[i] !== "{") {
      throw new SyntaxError(
        `validate type ${name}: requires an object type '{ … }' after '=' ` +
          `(got '${source[i] ?? "EOF"}')`,
      );
    }
    const { fields, end: braceEnd } = parseObjectFields(source, i, name);
    let end = skipWs(source, braceEnd);
    if (source[end] === ";") end++;
    decls.push({
      kind: "validate",
      name,
      fields,
      raw: source.slice(declStart, end),
      start: declStart,
      end,
    });
    headerRe.lastIndex = end;
  }

  return { decls };
}

function emitMemberCheck(valueExpr: string, member: ValidateMemberType): string {
  if (member.kind === "primitive") {
    return `typeof ${valueExpr} === "${member.name}"`;
  }
  return (
    `Array.isArray(${valueExpr}) && ` +
    `${valueExpr}.every((__e) => typeof __e === "${member.element}")`
  );
}

function emitFieldCheck(valueVar: string, field: ValidateField): string {
  const access = `${valueVar}.${field.name}`;
  const memberChecks = field.type.members
    .map((mem) => `(${emitMemberCheck(access, mem)})`)
    .join(" || ");
  if (field.optional) {
    return `(${access} === undefined || ${memberChecks})`;
  }
  return `(${memberChecks})`;
}

function emitObjectShape(decl: ValidateTypeDecl): string {
  const lines = decl.fields.map((f) => {
    const opt = f.optional ? "?" : "";
    const typeStr = f.type.members
      .map((m) =>
        m.kind === "primitive" ? m.name : `${m.element}[]`,
      )
      .join(" | ");
    return `  ${f.name}${opt}: ${typeStr};`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

/** Phantom-branded type alias so bare objects are not assignable under stock tsc. */
function emitTypeAlias(decl: ValidateTypeDecl): string {
  const brand = `${decl.name}Brand`;
  const shape = emitObjectShape(decl);
  return [
    `declare const ${brand}: unique symbol;`,
    `type ${decl.name} = ${shape} & { readonly [${brand}]: true };`,
  ].join("\n");
}

/** Emit plain TS type alias + `.is` / `.from` companion for one validate type. */
export function emitValidateType(decl: ValidateTypeDecl): string {
  const { name, fields } = decl;
  const checks = fields
    .map((f) => `    ${emitFieldCheck("v", f)}`)
    .join(" &&\n");
  return [
    emitTypeAlias(decl),
    `const ${name} = /*#__PURE__*/ (() => {`,
    `  function is(value: unknown): value is ${name} {`,
    `    if (typeof value !== "object" || value === null) return false;`,
    `    const v = value as Record<string, unknown>;`,
    `    return (`,
    checks,
    `    );`,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value)) return value as ${name};`,
    `    const preview = typeof value === "string" ? JSON.stringify(value) : \`typeof \${typeof value}\`;`,
    `    throw new Error(\`Invalid ${name}: \${preview}\`);`,
    `  }`,
    `  return Object.freeze({`,
    `    name: "${name}" as const,`,
    `    is,`,
    `    from,`,
    `  });`,
    `})();`,
  ].join("\n");
}
