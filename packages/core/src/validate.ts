/**
 * `validate type` — runtime validation companions from object types.
 *
 * Parsing: dialect AST frontend (`./ast`). Emitting stays here.
 *
 * Supported field shapes: `string` | `number` | `boolean` | `null`, optional `?`,
 * arrays of those primitives (`string[]`), unions of those (e.g. `string | null`),
 * nested objects whose leaves are those shapes, `Date`, and a `brand type` or
 * `validate type` name (same file, import, or the transform batch).
 * Emits a phantom-branded type (unique symbol) + the same `.is` / `.from`
 * companion shape as refined `brand type`, so stock `tsc` blocks bare
 * object literals from assigning without `.from` / `cast`.
 * Companion-typed fields stay that nominal type: raw values enter through the
 * inner `.from`; `.is` / `.from` here only check (no formatting step).
 */

import { parseSts } from "./ast/index.js";

export type PrimitiveTypeName = "string" | "number" | "boolean";

/**
 * Field member: primitive, null, array of primitives (not `null[]`),
 * `Date`, a nested object, or a brand / validate companion name.
 */
export type ValidateMemberType =
  | { kind: "primitive"; name: PrimitiveTypeName }
  | { kind: "null" }
  | { kind: "array"; element: PrimitiveTypeName }
  | { kind: "date" }
  | { kind: "object"; fields: ValidateField[] }
  | { kind: "ref"; name: string };

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
  /** True when declared as `export validate type` */
  exported: boolean;
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

interface EmitIds {
  n: number;
}

function emitMemberCheck(
  valueExpr: string,
  member: ValidateMemberType,
  ids: EmitIds,
): string {
  switch (member.kind) {
    case "null":
      return `${valueExpr} === null`;
    case "primitive":
      return `typeof ${valueExpr} === "${member.name}"`;
    case "array":
      return (
        `Array.isArray(${valueExpr}) && ` +
        `${valueExpr}.every((__e) => typeof __e === "${member.element}")`
      );
    case "date":
      return `${valueExpr} instanceof Date`;
    case "ref":
      // `as Parameters<…>` typechecks refined brands (`is(s: string)`) and
      // erases, so runtime still calls `.is` with the raw field value.
      return `${member.name}.is(${valueExpr} as Parameters<typeof ${member.name}.is>[0])`;
    case "object":
      return emitObjectCheck(valueExpr, member.fields, ids);
    default: {
      const _exhaustive: never = member;
      return _exhaustive;
    }
  }
}

function emitObjectCheck(
  valueExpr: string,
  fields: readonly ValidateField[],
  ids: EmitIds,
): string {
  const id = ids.n++;
  const raw = `__o${id}`;
  const rec = `__r${id}`;
  const checks = fields.map((f) => emitFieldCheck(rec, f, ids)).join(" && ");
  return (
    `(() => { const ${raw} = ${valueExpr}; ` +
    `if (typeof ${raw} !== "object" || ${raw} === null || Array.isArray(${raw}) || ${raw} instanceof Date) return false; ` +
    `const ${rec} = ${raw} as Record<string, unknown>; ` +
    `return (${checks}); })()`
  );
}

function emitFieldCheck(
  valueVar: string,
  field: ValidateField,
  ids: EmitIds,
): string {
  // Bracket access: hosts with `noPropertyAccessFromIndexSignature` reject
  // `v.field` on `Record<string, unknown>` (used in the generated `is` body).
  const access = `${valueVar}[${JSON.stringify(field.name)}]`;
  const memberChecks = field.type.members
    .map((mem) => `(${emitMemberCheck(access, mem, ids)})`)
    .join(" || ");
  if (field.optional) {
    return `(${access} === undefined || ${memberChecks})`;
  }
  return `(${memberChecks})`;
}

function emitMemberType(member: ValidateMemberType, indent: number): string {
  switch (member.kind) {
    case "null":
      return "null";
    case "primitive":
      return member.name;
    case "array":
      return `${member.element}[]`;
    case "date":
      return "Date";
    case "ref":
      return member.name;
    case "object": {
      const inner = indent + 1;
      const pad = "  ".repeat(inner);
      const close = "  ".repeat(indent);
      const lines = member.fields.map((f) => {
        const opt = f.optional ? "?" : "";
        const typeStr = f.type.members
          .map((m) => emitMemberType(m, inner))
          .join(" | ");
        return `${pad}${f.name}${opt}: ${typeStr};`;
      });
      return `{\n${lines.join("\n")}\n${close}}`;
    }
    default: {
      const _exhaustive: never = member;
      return _exhaustive;
    }
  }
}

function emitObjectShape(decl: ValidateTypeDecl): string {
  const lines = decl.fields.map((f) => {
    const opt = f.optional ? "?" : "";
    const typeStr = f.type.members.map((m) => emitMemberType(m, 1)).join(" | ");
    return `  ${f.name}${opt}: ${typeStr};`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

/**
 * Fail expand when a field names something that is not a brand or validate
 * companion in scope (local, imported, or the transform batch).
 */
export function assertValidateFieldRefs(
  decl: ValidateTypeDecl,
  isKnownCompanion: (name: string) => boolean,
): void {
  const walk = (fields: readonly ValidateField[], prefix: string): void => {
    for (const field of fields) {
      const path = prefix ? `${prefix}.${field.name}` : field.name;
      for (const member of field.type.members) {
        if (member.kind === "ref" && !isKnownCompanion(member.name)) {
          throw new SyntaxError(
            `validate type ${decl.name}: unsupported field type '${member.name}' on '${path}' ` +
              `(no brand type or validate type named '${member.name}' in this file, ` +
              `imported into it, or declared in the transform batch)`,
          );
        }
        if (member.kind === "object") walk(member.fields, path);
      }
    }
  };
  walk(decl.fields, "");
}

/** Phantom-branded type alias so bare objects are not assignable under stock tsc. */
function emitTypeAlias(decl: ValidateTypeDecl): string {
  const brand = `${decl.name}Brand`;
  const shape = emitObjectShape(decl);
  const exp = decl.exported ? "export " : "";
  return [
    `declare const ${brand}: unique symbol;`,
    `${exp}type ${decl.name} = ${shape} & { readonly [${brand}]: true };`,
  ].join("\n");
}

/** Emit plain TS type alias + `.is` / `.from` companion for one validate type. */
export function emitValidateType(decl: ValidateTypeDecl): string {
  const { name, fields, exported } = decl;
  const exp = exported ? "export " : "";
  const ids: EmitIds = { n: 0 };
  const checks = fields
    .map((f) => `    ${emitFieldCheck("v", f, ids)}`)
    .join(" &&\n");
  return [
    emitTypeAlias(decl),
    `${exp}const ${name} = /*#__PURE__*/ (() => {`,
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
