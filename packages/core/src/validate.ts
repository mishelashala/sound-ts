/**
 * `validate type` — runtime validation companions from object types.
 *
 * Parsing: dialect AST frontend (`./ast`). Emitting stays here.
 *
 * Supported field shapes: `string` | `number` | `boolean`, optional `?`,
 * arrays of those primitives (`string[]`), and unions of those.
 * Emits a phantom-branded type (unique symbol) + the same `.is` / `.from`
 * companion shape as refined `brand type`, so stock `tsc` blocks bare
 * object literals from assigning without `.from` / `cast`.
 */

import { parseSts } from "./ast/index.js";

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

/**
 * Find all `validate type` declarations via the dialect AST frontend.
 */
export function parseValidateTypes(source: string): ValidateParseResult {
  return { decls: parseSts(source).validates };
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
