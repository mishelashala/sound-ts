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

function emitLiteralSelfContained(decl: LiteralBrandDecl): string {
  const { name, values } = decl;
  const litList = values.map((v) => JSON.stringify(v)).join(", ");
  const union = values.map((v) => JSON.stringify(v)).join(" | ");

  return [
    `type ${name} = ${union};`,
    `const ${name} = /*#__PURE__*/ (() => {`,
    `  const __values = Object.freeze([${litList}] as const);`,
    `  const __set = new Set<string>(__values);`,
    `  function is(value: unknown): value is ${name} {`,
    `    return typeof value === "string" && __set.has(value);`,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value)) return value;`,
    `    const preview = typeof value === "string" ? JSON.stringify(value) : \`typeof \${typeof value}\`;`,
    `    throw new Error(\`Invalid ${name}: \${preview} is not one of [\${__values.map((v) => JSON.stringify(v)).join(", ")}]\`);`,
    `  }`,
    `  return Object.freeze({`,
    `    name: "${name}" as const,`,
    `    values: __values,`,
    `    is,`,
    `    from,`,
    `  });`,
    `})();`,
  ].join("\n");
}

function emitLiteralWithHelper(decl: LiteralBrandDecl): string {
  const { name, values } = decl;
  const litList = values.map((v) => JSON.stringify(v)).join(", ");
  const union = values.map((v) => JSON.stringify(v)).join(" | ");
  return [
    `type ${name} = ${union};`,
    `const ${name} = defineLiteralSet("${name}", [${litList}] as const);`,
  ].join("\n");
}

/**
 * Phantom brand marker so stock `tsc` treats the refined type as nominally opaque
 * (bare `number` / base is not assignable). Runtime entry remains `.is` / `.from`.
 */
export function emitPhantomBrandAlias(name: string, baseType: string): string {
  const brand = `${name}Brand`;
  return [
    `declare const ${brand}: unique symbol;`,
    `type ${name} = ${baseType} & { readonly [${brand}]: true };`,
  ].join("\n");
}

/**
 * Mode B: phantom-branded type + companion with user `.is` body and generated `.from`.
 */
function emitRefined(decl: RefinedBrandDecl): string {
  const { name, baseType, isParamName, isParamType, isBody } = decl;
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
    emitPhantomBrandAlias(name, baseType),
    `const ${name} = /*#__PURE__*/ (() => {`,
    `  function is(${isParamName}: ${isParamType}): ${isParamName} is ${name} {`,
    indentedBody,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value as ${isParamType})) return value as ${name};`,
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

/**
 * Brand-only union or intersection: type alias + companion that
 * delegates `.is` to member brands (`||` / `&&`).
 */
function emitCombined(decl: CombinedBrandDecl): string {
  const { name, members, kind } = decl;
  const typeExpr =
    kind === "intersection" ? members.join(" & ") : members.join(" | ");
  const isExpr =
    kind === "intersection"
      ? members.map((m) => `${m}.is(value)`).join(" && ")
      : members.map((m) => `${m}.is(value)`).join(" || ");

  return [
    `type ${name} = ${typeExpr};`,
    `const ${name} = /*#__PURE__*/ (() => {`,
    `  function is(value: unknown): value is ${name} {`,
    `    return ${isExpr};`,
    `  }`,
    `  function from(value: unknown): ${name} {`,
    `    if (is(value)) return value;`,
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
