/**
 * Sound-TS 1.0 complete-soundness rules (roadmap #54).
 *
 * Requires DialectProjectSymbols. See SOUNDNESS_1_0.md for the reject/accept
 * matrix and deferred work.
 */

import type { DialectProjectSymbols } from "../symbols/types.js";
import { assertBrandGenericSubset } from "./rejectBrandGenericPartial.js";
import { assertNoBrandMutation } from "./rejectBrandMutation.js";
import { assertNoBrandTypePredicates } from "./rejectBrandTypePredicates.js";
import { assertNoOutboundWiden } from "./rejectOutboundWiden.js";
import { assertHonestRefinedPredicates } from "./rejectDishonestRefinedIs.js";

export type Soundness1CheckOptions = {
  filename?: string;
  symbols: DialectProjectSymbols;
};

/**
 * Run the initial 1.0 soundness contract for one file against project symbols.
 * Throws SyntaxError on violation; does not rewrite.
 */
export function runSoundness1Checks(
  source: string,
  options: Soundness1CheckOptions,
): void {
  const { symbols, filename } = options;
  assertNoBrandTypePredicates(source, symbols, filename);
  assertHonestRefinedPredicates(symbols, filename);
  assertNoBrandMutation(source, symbols, filename);
  assertBrandGenericSubset(source, symbols, filename);
  assertNoOutboundWiden(source, symbols, filename);
}

export { assertNoBrandTypePredicates } from "./rejectBrandTypePredicates.js";
export { assertHonestRefinedPredicates } from "./rejectDishonestRefinedIs.js";
export { assertNoBrandMutation } from "./rejectBrandMutation.js";
export { assertBrandGenericSubset } from "./rejectBrandGenericPartial.js";
export { assertNoOutboundWiden } from "./rejectOutboundWiden.js";
