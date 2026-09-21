/**
 * Browser shim for `import … from "typescript"`.
 * playground.html loads the pinned typescript CDN into `globalThis.ts`.
 * Do not bundle the compiler into docs/playground.js.
 */
const ts = globalThis.ts;
if (!ts) {
  throw new Error(
    "The TypeScript compiler did not load. Load the pinned typescript CDN script before playground.js.",
  );
}

export default ts;
export const createSourceFile = (...args) => ts.createSourceFile(...args);
export const forEachChild = (...args) => ts.forEachChild(...args);
export const isMethodDeclaration = (...args) => ts.isMethodDeclaration(...args);
export const isMethodSignature = (...args) => ts.isMethodSignature(...args);
export const isClassDeclaration = (...args) => ts.isClassDeclaration(...args);
export const isClassExpression = (...args) => ts.isClassExpression(...args);
export const isObjectLiteralExpression = (...args) =>
  ts.isObjectLiteralExpression(...args);
export const isConstructorDeclaration = (...args) =>
  ts.isConstructorDeclaration(...args);
export const isDecorator = (...args) => ts.isDecorator(...args);
export const ScriptTarget = ts.ScriptTarget;
export const ScriptKind = ts.ScriptKind;
export const SyntaxKind = ts.SyntaxKind;
