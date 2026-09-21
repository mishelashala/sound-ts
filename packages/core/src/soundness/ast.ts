/**
 * Shared TypeScript AST harness for soundness bans.
 *
 * `.sts` dialect headers (`brand type` / `validate type`) are not valid TS.
 * Before `createSourceFile`, blank the `brand` / `validate` keyword with
 * same-length spaces so offsets still map to the original source. Dialect
 * `type` keyword offsets are recorded so structural-alias checks can skip
 * those decls. `cast<T>(…)` is already valid TS (generic call) and needs no
 * rewrite. Mode B refinement blocks may leave parse errors; recovered nodes
 * for later bans are still visited.
 */

import * as ts from "typescript";
import { maskCommentsAndStrings } from "../parse.js";

export type SoundnessAst = {
  /** Original author source (diagnostics / slices) */
  source: string;
  /** Text fed to `createSourceFile` (dialect keywords blanked) */
  parseText: string;
  sf: ts.SourceFile;
  filename?: string;
  /** Start offset of `type` in each `brand type` / `validate type` header */
  dialectTypeOffsets: ReadonlySet<number>;
};

/**
 * Blank `brand` / `validate` before `type` outside comments/strings.
 * Length-preserving so AST spans match `source`.
 */
export function prepareDialectForTsAst(source: string): {
  parseText: string;
  dialectTypeOffsets: Set<number>;
} {
  const scan = maskCommentsAndStrings(source);
  const out = source.split("");
  const dialectTypeOffsets = new Set<number>();
  const re = /\b(brand|validate)(\s+)(type)\b|\b(brand)(\s+)(enum)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    const kw = m[1] ?? m[4]!;
    const ws = m[2] ?? m[5]!;
    for (let i = 0; i < kw.length; i++) {
      out[m.index + i] = " ";
    }
    if (m[3] === "type") {
      dialectTypeOffsets.add(m.index + kw.length + ws.length);
    }
  }
  return { parseText: out.join(""), dialectTypeOffsets };
}

export function createSoundnessAst(
  source: string,
  filename?: string,
): SoundnessAst {
  const { parseText, dialectTypeOffsets } = prepareDialectForTsAst(source);
  const sf = ts.createSourceFile(
    filename ?? "soundness.sts",
    parseText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  return filename === undefined
    ? { source, parseText, sf, dialectTypeOffsets }
    : { source, parseText, sf, filename, dialectTypeOffsets };
}

export function formatLoc(
  filename: string | undefined,
  source: string,
  index: number,
): { prefix: string; where: string } {
  if (filename === undefined) {
    return { prefix: "", where: `offset ${index}` };
  }
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return {
    prefix: `${filename}:${line}:${col}: `,
    where: `${filename}:${line}:${col}`,
  };
}

export function walkAst(sf: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const go = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, go);
  };
  go(sf);
}

/** True when this type-alias `type` keyword was introduced by dialect syntax. */
export function isDialectTypeAlias(
  node: ts.TypeAliasDeclaration,
  sf: ts.SourceFile,
  dialectTypeOffsets: ReadonlySet<number>,
): boolean {
  const typeKw = node
    .getChildren(sf)
    .find((c) => c.kind === ts.SyntaxKind.TypeKeyword);
  const start = typeKw?.getStart(sf) ?? node.getStart(sf);
  return dialectTypeOffsets.has(start);
}
