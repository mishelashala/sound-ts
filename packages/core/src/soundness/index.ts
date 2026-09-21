/**
 * Dialect soundness gates run before expand. Each check throws SyntaxError
 * on violation; nothing is rewritten away.
 *
 * Parsing strategy (#52): bans use the official `typescript` package
 * (`createSourceFile` + visitors), same pattern as `emitMethods.ts`.
 * `.sts` may contain `brand type` / `validate type` (invalid TS). Before
 * parse, those leading keywords are blanked with same-length spaces so
 * offsets still map to the original source; dialect `type` offsets are
 * recorded so structural-alias checks skip them. `cast<T>(…)` is already
 * a valid generic call and needs no rewrite. See `ast.ts`.
 *
 * 1.0 rules (#54) need project symbols — see `runSoundness1Checks` and
 * `SOUNDNESS_1_0.md`. Wired from `transform` / `transformProject` after
 * `buildProjectSymbols`.
 */

import { assertNoAny } from "./rejectAny.js";
import { assertNoNonNullAssertions } from "./rejectNonNull.js";
import { assertNoStructuralAliases } from "./rejectStructuralAlias.js";
import { assertNoTypeAssertions } from "./rejectAs.js";
import { assertNoWideTypes } from "./rejectWideTypes.js";

export type SoundnessCheckOptions = {
  /** Optional filename for diagnostics */
  filename?: string;
};

/**
 * 0.x dialect soundness gates (AST bans). Each check throws SyntaxError
 * on violation; nothing is rewritten away.
 */
export function runSoundnessChecks(
  source: string,
  filename?: string,
): void {
  assertNoAny(source, filename);
  assertNoStructuralAliases(source, filename);
  assertNoWideTypes(source, filename);
  assertNoTypeAssertions(source, filename);
  assertNoNonNullAssertions(source, filename);
}

export { assertNoAny } from "./rejectAny.js";
export { assertNoNonNullAssertions } from "./rejectNonNull.js";
export { assertNoStructuralAliases } from "./rejectStructuralAlias.js";
export { assertNoTypeAssertions } from "./rejectAs.js";
export { assertNoWideTypes } from "./rejectWideTypes.js";

export {
  runSoundness1Checks,
  assertNoBrandTypePredicates,
  assertHonestRefinedPredicates,
  assertNoBrandMutation,
  assertBrandGenericSubset,
  type Soundness1CheckOptions,
} from "./soundness1.js";
