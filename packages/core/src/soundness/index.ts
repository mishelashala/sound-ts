import { assertNoAny } from "./rejectAny.js";

/**
 * Dialect soundness gates run before expand. Each check throws SyntaxError
 * on violation; nothing is rewritten away.
 */
export function runSoundnessChecks(
  source: string,
  filename?: string,
): void {
  assertNoAny(source, filename);
}

export { assertNoAny } from "./rejectAny.js";
