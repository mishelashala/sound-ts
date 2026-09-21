/**
 * @mishelashala/superset-ts — Mode A: closed string literal sets.
 *
 * This is a library (plus optional helpers), not a TypeScript compiler fork.
 * Output is plain valid TypeScript that stock `tsc` / Vite / VS Code understand.
 */
export {
  defineLiteralSet,
  type LiteralSet,
  type InferLiteral,
} from "./defineLiteralSet.js";
export { LiteralSetError } from "./errors.js";
