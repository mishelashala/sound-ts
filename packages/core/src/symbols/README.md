# Dialect scopes and symbols

How Sound-TS names brands, validate types, and companions across a
`transformProject` batch (roadmap 1.0 / #53).

## Why

Emit already expands each `brand type` / `validate type` into a **dual**
(type alias + runtime companion object). Complete-soundness rules (#54+) need
to say “this brand,” “this companion,” and “this import” without re-scanning
source text for names.

Symbols attach identity to the existing **DialectProgram** side-table and the
same file graph the CLI already feeds to `transformProject`. This is not a
`tsc` replacement and not an editor language server.

## Model

| Concept | Meaning |
| --- | --- |
| **DialectSymbol** | One dialect name: `kind` is `brand` or `validate`, plus declaring file + decl node. `companionName` is the value-side binding after emit (same identifier as the type today). |
| **FileScope** | Per-file locals from that file’s `DialectProgram`, plus stock TS **import bindings**. |
| **ImportBinding** | `import { X }` / `import { X as Y }` from a relative specifier. When the specifier resolves to another batch file that declares `X`, `symbol` points at that `DialectSymbol`. |
| **DialectProjectSymbols** | All scopes + a flat `byName` index for the batch. |

Batch visibility matches today’s maps: `|` / `&` members and `cast` targets
resolve against **any** companion declared in the transform input. Imports are
recorded so later rules can tell “used via import” vs “batch-visible only”;
they are not required for dialect composition.

## Pipeline

```text
.sts files
  → parseSts → DialectProgram (brands / validates / casts)
  → buildProjectSymbols → FileScope + DialectSymbol (+ linked imports)
  → resolveBrandMemberSymbols / cast via lookupSymbol
  → emit (companions) → stock TS imports unchanged
```

`brandMap` / `validateMap` remain on `transformProject` results as derived
views (`brandMapFromSymbols` / `validateMapFromSymbols`) so existing callers
stay stable.

## Not in this layer

- Full module resolution (package.json, `paths`, node_modules)
- Type checker semantics
- New authoring syntax
