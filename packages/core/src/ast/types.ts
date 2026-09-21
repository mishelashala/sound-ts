/**
 * First-class dialect nodes / side-table attached to original source spans.
 * Lowering walks these; they are the source of truth for brand / validate / cast.
 */

import type { BrandTypeDecl } from "../parse.js";
import type { ValidateTypeDecl } from "../validate.js";
import type { CheckedCastSite } from "../checkedCast.js";

/** Side-table for one `.sts` file after the AST frontend runs. */
export interface DialectProgram {
  /** Original source text */
  source: string;
  /** `brand type` declarations in source order */
  brands: BrandTypeDecl[];
  /** `validate type` declarations in source order */
  validates: ValidateTypeDecl[];
  /** `cast<Target>(expr)` sites in source order */
  casts: CheckedCastSite[];
}
