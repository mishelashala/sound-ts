import type {
  BrandTypeDecl,
  CombinedBrandDecl,
  LiteralBrandDecl,
  RefinedBrandDecl,
} from "./parse.js";
import {
  emitValidateType,
  type ValidateTypeDecl,
} from "./validate.js";

export interface EmitOptions {
  /**
   * When true, emit a call to an injected `defineLiteralSet` helper
   * (internal emit target). Default false: self-contained companion
   * with zero runtime dependency on this package.
   * Only applies to kind: "literal" declarations.
   */
  useInternalHelper?: boolean;
}

/**
 * Finite literals stay assignable (`setRole("admin")`). The phantom arm keeps
 * two brands with the same members distinct under stock `tsc`.
 * Outbound to `string` works; outbound to the bare literal union uses
 * companion `.toPrimitive(value)`.
 */
function emitLiteralNominalType(
  name: string,
  union: string,
  primitive: "string" | "number",
  exported: boolean,
): string {
  const brand = `${name}Brand`;
  const exp = exported ? "export " : "";
  return [
    `declare const ${brand}: unique symbol;`,
    `${exp}type ${name} = ${union} | (${primitive} & { readonly [${brand}]: true });`,
  ].join("\n");
}

function emitLiteralToken(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/** Property key for a Mode A `Values` member (quote when not a JS identifier). */
function emitValuesMemberKey(literal: string | number): string {
  if (typeof literal === "number") {
    return /^\d+(\.\d+)?$/.test(String(literal))
      ? String(literal)
      : JSON.stringify(literal);
  }
  return /^[A-Za-z_$][\w$]*$/.test(literal) ? literal : JSON.stringify(literal);
}

/** Nested `Values` map: known members without going through `.from(...)`. */
function emitValuesConst(
  brandName: string,
  values: readonly (string | number)[],
): string {
  const entries = values.map((v) => {
    const key = emitValuesMemberKey(v);
    return `    ${key}: ${emitLiteralToken(v)} as ${brandName},`;
  });
  return [
    `  const Values = Object.freeze({`,
    ...entries,
    `  });`,
  ].join("\n");
}

function emitLiteralSelfContained(decl: LiteralBrandDecl): string {
  const { name, values, exported, primitive } = decl;
  const litList = values.map((v) => emitLiteralToken(v)).join(", ");
  const union = values.map((v) => emitLiteralToken(v)).join(" | ");
  const exp = exported ? "export " : "";
  const typeofCheck = primitive === "number" ? "number" : "string";

  return [
    emitLiteralNominalType(name, union, primitive, exported),
    `${exp}const ${name} = /*#__PURE__*/ (() => {`,
    `  const __values = Object.freeze([${litList}] as const);`,
    `  const __set = new Set<${typeofCheck}>(__values);`,
    `  type __Literal = (typeof __values)[number];`,
    `  function is(value: unknown): value is ${name} {`,
    `    return typeof value === "${typeofCheck}" && __set.has(value);`,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value)) return value;`,
    `    const preview = typeof value === "string" || typeof value === "number" ? JSON.stringify(value) : \`typeof \${typeof value}\`;`,
    `    throw new Error(\`Invalid ${name}: \${preview} is not one of [\${__values.map((v) => JSON.stringify(v)).join(", ")}]\`);`,
    `  }`,
    `  function toPrimitive(value: ${name}): __Literal {`,
    `    for (const v of __values) {`,
    `      if (value === v) return v;`,
    `    }`,
    `    throw new Error(\`Invalid ${name} primitive: \${JSON.stringify(value)}\`);`,
    `  }`,
    emitValuesConst(name, values),
    `  return Object.freeze({`,
    `    name: "${name}" as const,`,
    `    values: __values,`,
    `    Values,`,
    `    is,`,
    `    from,`,
    `    toPrimitive,`,
    `  });`,
    `})();`,
  ].join("\n");
}

function emitLiteralWithHelper(decl: LiteralBrandDecl): string {
  if (decl.primitive === "number") {
    return emitLiteralSelfContained(decl);
  }
  const { name, values, exported } = decl;
  const litList = values.map((v) => emitLiteralToken(v)).join(", ");
  const union = values.map((v) => emitLiteralToken(v)).join(" | ");
  const exp = exported ? "export " : "";
  return [
    emitLiteralNominalType(name, union, "string", exported),
    `${exp}const ${name} = defineLiteralSet("${name}", [${litList}] as const);`,
  ].join("\n");
}

/**
 * Phantom brand marker so stock `tsc` treats the refined type as nominally opaque
 * (bare `number` / base is not assignable). Runtime entry remains `.is` / `.from`.
 */
export function emitPhantomBrandAlias(
  name: string,
  baseType: string,
  exported = false,
): string {
  const brand = `${name}Brand`;
  const exp = exported ? "export " : "";
  return [
    `declare const ${brand}: unique symbol;`,
    `${exp}type ${name} = ${baseType} & { readonly [${brand}]: true };`,
  ].join("\n");
}

/**
 * Mode B: phantom-branded type + companion with user `.is` body and generated `.from`.
 */
function emitRefined(decl: RefinedBrandDecl): string {
  const { name, baseType, isParamName, isParamType, isBody, exported } = decl;
  const exp = exported ? "export " : "";
  // Dedent user body, then indent to companion scope
  const rawLines = isBody.split("\n");
  const nonEmpty = rawLines.filter((l) => l.trim().length > 0);
  const minIndent = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => (l.match(/^\s*/)?.[0].length ?? 0)))
    : 0;
  const indentedBody = rawLines
    .map((line) => {
      if (line.trim() === "") return "";
      return "    " + line.slice(minIndent);
    })
    .join("\n");

  return [
    emitPhantomBrandAlias(name, baseType, exported),
    `${exp}const ${name} = /*#__PURE__*/ (() => {`,
    `  function is(${isParamName}: ${isParamType}): ${isParamName} is ${name} {`,
    indentedBody,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value as ${isParamType})) return value as ${name};`,
    `    const preview = typeof value === "string" || typeof value === "number" ? JSON.stringify(value) : \`typeof \${typeof value}\`;`,
    `    throw new Error(\`Invalid ${name}: \${preview}\`);`,
    `  }`,
    `  function toPrimitive(value: ${name}): ${baseType} {`,
    `    return value;`,
    `  }`,
    `  return Object.freeze({`,
    `    name: "${name}" as const,`,
    `    is,`,
    `    from,`,
    `    toPrimitive,`,
    `  });`,
    `})();`,
  ].join("\n");
}

/**
 * Brand-only union or intersection: type alias + companion that
 * delegates `.is` to member brands (`||` / `&&`).
 */
function emitCombined(decl: CombinedBrandDecl): string {
  const { name, members, kind, exported } = decl;
  const exp = exported ? "export " : "";
  const typeExpr =
    kind === "intersection" ? members.join(" & ") : members.join(" | ");
  const isExpr =
    kind === "intersection"
      ? members.map((m) => `${m}.is(value)`).join(" && ")
      : members.map((m) => `${m}.is(value)`).join(" || ");

  return [
    `${exp}type ${name} = ${typeExpr};`,
    `${exp}const ${name} = /*#__PURE__*/ (() => {`,
    `  function is(value: unknown): value is ${name} {`,
    `    return ${isExpr};`,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value)) return value;`,
    `    const preview = typeof value === "string" || typeof value === "number" ? JSON.stringify(value) : \`typeof \${typeof value}\`;`,
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

/** Emit plain TS for one `brand type` declaration. */
export function emitBrandType(
  decl: BrandTypeDecl,
  options: EmitOptions = {},
): string {
  switch (decl.kind) {
    case "literal":
      return options.useInternalHelper
        ? emitLiteralWithHelper(decl)
        : emitLiteralSelfContained(decl);
    case "refined":
      return emitRefined(decl);
    case "union":
    case "intersection":
      return emitCombined(decl);
    default: {
      const _exhaustive: never = decl;
      return _exhaustive;
    }
  }
}

export type EmitDecl = BrandTypeDecl | ValidateTypeDecl;

/**
 * Replace every `brand type` / `validate type` decl in `source` with emitted
 * plain TS. Declarations are replaced from last to first so offsets stay valid.
 */
export function transformSource(
  source: string,
  decls: EmitDecl[],
  options: EmitOptions = {},
): string {
  if (decls.length === 0) {
    return source;
  }
  const ordered = [...decls].sort((a, b) => b.start - a.start);
  let out = source;
  for (const decl of ordered) {
    const replacement =
      decl.kind === "validate"
        ? emitValidateType(decl)
        : emitBrandType(decl, options);
    out = out.slice(0, decl.start) + replacement + out.slice(decl.end);
  }
  return out;
}
