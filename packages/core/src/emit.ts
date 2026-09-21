import type { BrandTypeDecl } from "./parse.js";

export interface EmitOptions {
  /**
   * When true, emit a call to an injected `defineLiteralSet` helper
   * (internal emit target). Default false: self-contained companion
   * with zero runtime dependency on this package.
   */
  useInternalHelper?: boolean;
}

function emitSelfContained(decl: BrandTypeDecl): string {
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

function emitWithHelper(decl: BrandTypeDecl): string {
  const { name, values } = decl;
  const litList = values.map((v) => JSON.stringify(v)).join(", ");
  const union = values.map((v) => JSON.stringify(v)).join(" | ");
  return [
    `type ${name} = ${union};`,
    `const ${name} = defineLiteralSet("${name}", [${litList}] as const);`,
  ].join("\n");
}

/** Emit plain TS for one `brand type` declaration. */
export function emitBrandType(
  decl: BrandTypeDecl,
  options: EmitOptions = {},
): string {
  return options.useInternalHelper
    ? emitWithHelper(decl)
    : emitSelfContained(decl);
}

/**
 * Replace every `brand type` decl in `source` with emitted plain TS.
 * Declarations are replaced from last to first so offsets stay valid.
 */
export function transformSource(
  source: string,
  decls: BrandTypeDecl[],
  options: EmitOptions = {},
): string {
  if (decls.length === 0) {
    return source;
  }
  const ordered = [...decls].sort((a, b) => b.start - a.start);
  let out = source;
  for (const decl of ordered) {
    const replacement = emitBrandType(decl, options);
    out = out.slice(0, decl.start) + replacement + out.slice(decl.end);
  }
  return out;
}
