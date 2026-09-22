# Sound-TS 1.0 soundness contract (initial slice)

Rules that need **program structure** (DialectProgram + `DialectProjectSymbols` +
TypeScript AST). Stock `tsc` remains the backend checker on **expand output**.
These gates run **before** emit and **fail closed** (throw `SyntaxError`); they
never rewrite a hole into a lie.

Companion to 0.x bans in this folder (`any`, `as`, `!`, wide types, bare
structural aliases), which still run first.

## Reject / accept matrix

| Area | Accept | Reject (this slice) |
| --- | --- | --- |
| **Unsafe boundary / FFI** | `cast<Brand>(…)`, `Brand.from(…)`, generated companion `.is` / `.from` after expand | Author-written type predicates / assertion predicates that refine **to a dialect companion name** (`x is User`, `asserts x is User`) outside dialect emit |
| **Honest type predicates** | Mode B `is` bodies that mention the parameter and are not trivially `return true` | Empty `is` bodies; bodies that never reference the `is` parameter; bodies whose only return is literal `true` |
| **Mutation / aliasing** | Reading fields; rebinding locals; `Object.freeze`d companions as emitted | Assigning to companion members (`User.is = …`, `User.from = …`, `User.values = …`); property writes on bindings **annotated** with a dialect companion type (`u: User; u.id = …`) |
| **Generics / variance** | `ReadonlyArray<Brand>`, `Readonly<Brand>`, brands as ordinary type arguments to author types we do not special-case | `Partial<Brand>` and `Required<Brand>` where `Brand` is a dialect companion (optionalizes / remaps the phantom brand arm) |
| **Outbound widen** | Literal brand → `string` / `number`; `Name.toPrimitive(value)` → the bare literal union; field reads on a validate type (`user.id`); a fresh object literal annotated with the field structure | A binding annotated with the **full naked field structure** of a `validate type`, when the initializer or a later `=` is that validate value (`.from`, `cast<>`, or a binding that holds it). A binding annotated with the **bare literal union** of a literal brand, when the initializer or a later `=` is that brand. `.toPrimitive` is the literal-brand unwrap. The visitor does not rewrite the value |

Gate: each reject **closes a visible hole**. We do not invent a cast rewrite or
weaken emit to silence stock `tsc`.

## What this slice closes

1. **Lying predicates** — stock TS treats `function f(x: unknown): x is User`
   as proof. After `as` / `any` bans, that was the main FFI punch-through into
   brands without `cast` / `.from`.
2. **Vacuous Mode B `is`** — a refined brand whose `is` always returns `true`
   (or ignores its input) would mint a companion that “proves” anything.
3. **Post-construction punches** — mutating `User.from` / fields of a
   `User`-annotated binding undermines invariants the brand claimed at
   construction.
4. **`Partial` / `Required` on brands** — mapped utilities make the phantom
   brand property optional (or rewrite the shape), reopening structural entry.
5. **Outbound widen** — a validate-type value is not its naked field
   structure, and a literal brand is not its bare literal union, unless the
   author unwraps a literal brand with `.toPrimitive`. Wide `string` /
   `number` assignability stays.

### Outbound widen: the visitor is the gate

Stock `tsc` accepts `Fields & { readonly [Brand]: true }` as `Fields`. A
phantom intersection cannot close `validate type` → naked object and still
keep `user.id`. Probed alternatives (class private fields, private unique
symbols, abstract-class intersections) still assign to the naked object;
a union with a brand-only arm rejects the assignment and breaks field reads.
Literal-brand emit is unchanged: the phantom **union** arm already makes
stock `tsc` reject `"a" | "b"` / `0 | 1`. `.toPrimitive` is that conversion.

`assertNoOutboundWiden` runs before emit and throws `SyntaxError`. It does
not rewrite the value into a lie. The stock-`tsc` fixture on validate types
records that the naked-object assignment still typechecks, so this visitor
— not emit — is the gate.

## Deferred (not this PR)

- Proving Mode B / validate `is` bodies correct (SMT, abstract interp, etc.)
- Mutation without an explicit brand type annotation (needs checker flow)
- Outbound widen through return position, call arguments, or a structural
  supertype that is not the full naked field structure (needs checker flow)
- Full variance for user generics, `Array`/`Map`/`Set` write-through, method
  bivariance beyond existing method→property emit
- Ambient / `declare` FFI surfaces, package `paths`, node_modules resolution
- Editor LSP; forking Microsoft/TypeScript; replacing stock `tsc` for `.ts`

## Pipeline

```text
.sts
  → runSoundnessChecks (0.x AST bans)
  → parseSts + buildProjectSymbols
  → runSoundness1Checks (this matrix; needs symbols)
  → emit + cast rewrite → stock tsc
```

## Versioning

Breaking relative to 0.x is allowed on the road to `1.0.0`. Public
`runSoundnessChecks` stays the 0.x entry; `runSoundness1Checks` is additive.
