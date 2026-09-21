import { assertNoAny } from "./rejectAny.js";
import { assertNoStructuralAliases } from "./rejectStructuralAlias.js";
import { assertNoWideTypes } from "./rejectWideTypes.js";

export type SoundnessCheckOptions = {
  /** Optional filename for diagnostics */
  filename?: string;
};

/**
 * Dialect soundness gates run before expand. Each check throws SyntaxError
 * on violation; nothing is rewritten away.
 */
export function runSoundnessChecks(
  source: string,
  filename?: string,
): void {
  assertNoAny(source, filename);
  assertNoStructuralAliases(source, filename);
  assertNoWideTypes(source, filename);
}

export { assertNoAny } from "./rejectAny.js";
export { assertNoStructuralAliases } from "./rejectStructuralAlias.js";
export { assertNoWideTypes } from "./rejectWideTypes.js";
