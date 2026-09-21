# Dialect AST frontend

How `.sts` maps onto the TypeScript AST plus dialect nodes (roadmap 1.0 / #50–#51).

## Strategy: masked scanner discovery + synthetic TS snippets

Dialect keywords (`brand type`, `validate type`, `cast<>`) are **not** valid TypeScript.
We do **not** feed raw `.sts` straight into `createSourceFile` and expect a clean tree.

Instead:

1. **Mask** comments / strings / templates with `maskCommentsAndStrings` (offset-preserving).
   A bare TypeScript scanner loses `${…}` template state and can swallow the rest of the
   file; masking avoids that without using regex as the dialect grammar.
2. **Discover** dialect constructs with the TypeScript **scanner** (`ts.createScanner`,
   `skipTrivia: true`) on the masked text. Trivia and masked spans never yield a bare
   `brand` / `validate` / `cast` identifier.
3. **Parse** each construct’s payload from the **original** source with the TypeScript
   **parser** on a **synthetic snippet** that *is* valid TS (or nearly so):
   - Literal / union / intersection brand RHS → `type __T = <rhs>`
   - Validate object type → `type __T = <object>`
   - Refined brand `is` method → `class __C { <is method> }`
   - Cast operand → expression text kept with real source spans (target via scanner)
4. **Record** first-class dialect nodes in a **side-table** (`DialectProgram`): brands,
   validates, and casts with `{ start, end }` into the original source. Lowering
   (`emit` / `rewriteCheckedCasts`) walks those nodes — not opaque string rewrites as
   the representation of dialect syntax.

The full-file TS AST (when needed later for soundness) can attach to the same spans;
this package still runs text soundness bans separately (#52).

## Node kinds

| Dialect syntax | Side-table entry | Payload via |
| --- | --- | --- |
| `brand type Name = …` | `BrandTypeDecl` | type / class AST snippets |
| `validate type Name = { … }` | `ValidateTypeDecl` | type-literal AST |
| `cast<Target>(expr)` | `CheckedCastSite` | scanner + balanced `(…)` |

## Public adapters

`parseBrandTypes` / `parseValidateTypes` / `findCheckedCasts` are thin adapters over
`parseSts` so existing callers and fixtures keep working. Prefer `parseSts` for new code.
