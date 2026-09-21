<p align="center">
  <img src="docs/assets/seal.svg" width="64" height="64" alt="sound-ts seal" />
</p>

<h1 align="center">sound-ts</h1>

**Type soundness for TypeScript, inspired by F# types.**

> **Not a TypeScript fork.** No patched `tsc`, no Microsoft fork to maintain, no custom checker. The CLI rewrites source; bundlers consume **output** only.

Repo: [mishelashala/sound-ts](https://github.com/mishelashala/sound-ts) · docs: [mishelashala.github.io/sound-ts](https://mishelashala.github.io/sound-ts/) · npm: [`@mishelashala/sound-ts-cli`](https://www.npmjs.com/package/@mishelashala/sound-ts-cli) / [`@mishelashala/sound-ts-core`](https://www.npmjs.com/package/@mishelashala/sound-ts-core)

---



## Soundness (project goal)

TypeScript’s contract is **type safety with erased types** — no runtime companions from the type layer. Sound-TS aims for **F#-style soundness**: opaque / branded (phantom) types plus runtime companions so values enter through checked paths.

**Where we claim soundness today** (`0.x`)

- `brand type` string-literal brands — member literals stay assignable; a phantom arm keeps two brands with the same members distinct. Outbound to `string` works; outbound to the bare literal union via `.toPrimitive`
- `brand type` refined brands — phantom `unique symbol` emit; bare base not assignable under stock `tsc`
- `validate type` — same phantom + `.is` / `.from`
- `cast<Target>(expr)` — checked entry path (primitive checks or companion `.from`)
- On `.sts`: reject `as` / `any` / `!` / wide types, no bare structural aliases, methods emit as readonly function properties ([#36](https://github.com/mishelashala/sound-ts/issues/36)–[#38](https://github.com/mishelashala/sound-ts/issues/38), [#40](https://github.com/mishelashala/sound-ts/issues/40)–[#42](https://github.com/mishelashala/sound-ts/issues/42))

**1.0 slice (delivered on `.sts`)** — AST + symbols close more holes before emit. Ordinary `.ts` stays stock TypeScript. Matrix: [`SOUNDNESS_1_0.md`](packages/core/src/soundness/SOUNDNESS_1_0.md).

- FFI: author `x is Brand` / `asserts x is Brand` rejected — entry via `cast<>` / `.from`
- Honest Mode B `is` shapes (empty / ignored param / always-`true` rejected)
- Mutation of companions / dialect-annotated bindings rejected
- Conservative generics: `Partial` / `Required` on brands rejected; `Readonly` allowed
- Still deferred (see design note): proving `is` correctness, unannotated mutation, full variance, ambient FFI

Outbound widen from a `validate type` to the naked field structure remains a stock `tsc` hole until a later design closes it.

Gate: new dialect surface should **close a soundness hole**, not paper over one.

---

## Install

```bash
npm i -g @mishelashala/sound-ts-cli
# bins: sts, sound-ts
```

Library: `@mishelashala/sound-ts-core`.

## Authoring

**Prefer `.sts` files.** Stock TypeScript language service will red-squiggle dialect keywords (`brand type`, `validate type`, `cast`) inside ordinary `.ts` / `.tsx`. The VS Code extension’s TextMate grammar covers `.sts`; injection into `.ts` only helps highlighting, not the checker.

### String literal brands

```sts
brand type Account = "admin" | "regular";
```

Expands to the member literals **plus** a phantom arm, plus a runtime companion with `.values`, `.is`, `.from`, `.toPrimitive`:

```ts
declare const AccountBrand: unique symbol;
type Account =
  | "admin"
  | "regular"
  | (string & { readonly [AccountBrand]: true });
```

Under stock `tsc`, `setRole("admin")` is OK, widened `string` is not, and a second brand with the same members is not assignable to `Account`. A value of type `Account` is assignable to `string`, not back to `"admin" | "regular"`.

### Refined brands

```sts
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
```

Expands to a **phantom unique-symbol brand** plus a companion that keeps your `.is` body and **generates** `.from` (validate via `.is`):

```ts
declare const PositiveIntBrand: unique symbol;
type PositiveInt = number & { readonly [PositiveIntBrand]: true };
// companions: .is is a type predicate; .from / cast<> return PositiveInt
```

Under stock `tsc`, bare `number` is **not** assignable to `PositiveInt` — enter via `.from` / `cast<PositiveInt>(…)`. Runtime checks still matter at boundaries; the brand alone is not enough. No separate `.d.ts` emit — plain `.ts` only.

### Brand unions / intersections

Members must be **known brand names** from the transform input (same file or another `.sts` on the CLI batch) — no open `string` / arbitrary types. Unknown brands and cycles error clearly at transform time.

```sts
// a.sts — declare
brand type Admin = "admin";
brand type Regular = "regular";

export { Admin, Regular };
```

```sts
// b.sts — compose across files
import { Admin, Regular } from "./a.js";

brand type Staff = Admin | Regular;
```

Same-file composition still works (`User & Session`, etc.). Pass the directory (or both files) to `sts` so the project brand map sees every declaration; then point `tsc` at the expanded output.

```ts
// after sts transform — stock TypeScript
type Account = "admin" | "regular";
const Account = /* … runtime companion … */;

function greet(role: Account): string {
  return role === "admin" ? "hello, admin" : "hello";
}

greet(Account.from("admin")); // ok
Account.is("guest");          // false
Account.from("guest");        // throws
```

### Validate type

Object types with primitive fields → phantom-branded type + same `.is` / `.from` companions (bare object literals are not assignable under stock `tsc` — use `.from` / `cast<>`):

```sts
validate type User = { id: string; age: number };

User.is(data);
User.from(data); // throws on mismatch; returns User
```

**Supported field shapes:** `string` | `number` | `boolean` | `null`, optional `?`, arrays of primitives (`string[]`), and unions of those (e.g. `string | null`). Nested objects, generics, `Date`, imported aliases as field types, etc. error clearly at transform time.

### Checked casts (`cast<>`)

```sts
const n = cast<number>(raw);  // inline typeof check; throws on mismatch
const u = cast<User>(raw);    // User.from(raw) when User is a brand/validate companion in the batch
```

Targets: primitives or known companions from the CLI batch. Unknown targets error at transform time.

---

## Quickstart (CLI)

```bash
git clone https://github.com/mishelashala/sound-ts.git
cd sound-ts
pnpm install
pnpm build
pnpm test

# expand one file into .sound-ts/ (roles.sts → .sound-ts/roles.ts, not a sibling .ts)
pnpm --filter @mishelashala/sound-ts-cli exec sts path/to/file.sts
# or after linking / running dist:
node packages/cli/dist/cli.js path/to/file.sts -o path/to/out.ts

# expand a directory
node packages/cli/dist/cli.js ./src -o ./out
```

Point `tsc` / Vite at **`./out`** (the transformed files), not the dialect sources.

Binaries after build: `sound-ts` / `sts` → `packages/cli/dist/cli.js`.

### Parser notes

Remaining scanner edges: regex literals; nested `${}` inside templates (the whole template is skipped).

---


## Adoption / roadmap

Keep most of the app as normal `.ts` (stock `tsc` / Vite). Add `.sts` only where you want `brand type`, `validate type`, or `cast`. VS Code already highlights `.sts`, so “just add a file” isn’t red-squiggle hell.

**Today — two-step compilation** (expand, then stock build):

```
.sts  --sts -o …-->  plain .ts  --tsc/nest-->  .js in normal build out
```

- `sts` never emits `.js`
- Default output → `<cwd>/.sound-ts/` (gitignored; input outside the cwd caches next to that input) or `-o` you choose
- Stock Nest / `tsc` still owns `dist/`
- Don’t point `tsc` at raw `.sts`
- Whole `.sts` batch on each `sts` run for cross-file `|` / `&` and `cast` companions
- Enter refined / validate types via `.from` or `cast<>` — bare bases are not assignable under stock `tsc`

### Drop-in build

`examples/tsc-app` is a plain `tsc` app. One command expands `.sts`, then runs `tsc`. If expand fails, `tsc` does not run.

`package.json`:

```json
{
  "scripts": {
    "build": "node scripts/build.mjs"
  }
}
```

`scripts/build.mjs` runs this, and runs `tsc` only when expand exits 0:

```bash
node ../../packages/cli/dist/cli.js src -o .sound-ts
tsc -p tsconfig.json
```

`tsconfig.json` sets `rootDir` to `.sound-ts` and `outDir` to `dist`. `include` is `.sound-ts/**/*.ts`. It does not include `*.sts`.

```bash
pnpm --dir examples/tsc-app build
```

### Vite

`examples/vite-app` expands `.sts` inside Vite. `dev` and `build` do not call `sts`.

```ts
import { soundTs } from "@mishelashala/sound-ts-vite";
```

```ts
import { Account } from "./roles.sts";
```

```bash
pnpm --dir examples/vite-app build
```

**0.x (delivered)** — tooling + surface soundness on `.sts`. Checkboxes stay checked as history. Ordinary `.ts` stays stock TypeScript.

*Seamless integration* ([roadmap v1](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v1)):

- [x] [Shadow emit](https://github.com/mishelashala/sound-ts/issues/27) — `sts` writes a gitignored cache, never a sibling `.ts`. CI fails if that output is committed.
- [x] [Bidirectional resolve](https://github.com/mishelashala/sound-ts/issues/28) — `.ts` and `.sts` import each other. Import paths stay as the author wrote them.
- [x] [Drop-in build script](https://github.com/mishelashala/sound-ts/issues/29) — one `package.json` script expands, then runs `tsc`. Expand failure stops the build.
- [x] [Loader](https://github.com/mishelashala/sound-ts/issues/30) — Vite expands `.sts` on dev and build, so you stop calling `sts` by hand.

*Soundness on `.sts`* ([roadmap v2](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v2)):

- [x] [Reject `as`](https://github.com/mishelashala/sound-ts/issues/36) — a type assertion in `.sts` fails expand. `as const` and `cast<>` stay. `as` is not rewritten into `cast`.
- [x] [Reject `any`](https://github.com/mishelashala/sound-ts/issues/37) — `any` in `.sts` fails expand. `unknown` stays. `any` is not rewritten to `unknown`.
- [x] [No structural aliases](https://github.com/mishelashala/sound-ts/issues/38) — a bare object alias in `.sts` fails expand. `validate type` stays nominal. Outbound widen to the naked structure stays a stock `tsc` hole.
- [x] [Method parameters](https://github.com/mishelashala/sound-ts/issues/40) — a method in `.sts` emits as a readonly function property, so stock `strictFunctionTypes` checks parameters contravariantly.
- [x] [Reject `!`](https://github.com/mishelashala/sound-ts/issues/41) — `value!` and `prop!: Type` in `.sts` fail expand. `!==` stays. `!` is not deleted.
- [x] [Reject `Object`, `{}`, `Function`](https://github.com/mishelashala/sound-ts/issues/42) — those types in `.sts` fail expand. An empty object literal stays. They are not rewritten to `unknown`.

**1.0.0 — complete soundness** — [roadmap 1.0](https://github.com/mishelashala/sound-ts/issues?q=roadmap+1.0). AST frontend, dialect nodes, AST bans, symbols, and the initial 1.0 rule slice are delivered. Stock `tsc` stays the backend on expand output. Deferred holes live in [`SOUNDNESS_1_0.md`](packages/core/src/soundness/SOUNDNESS_1_0.md).

- [x] [AST frontend with parity](https://github.com/mishelashala/sound-ts/issues/50) — TypeScript parser/AST replaces the regex frontend; fixtures expand equivalently.
- [x] [Dialect AST nodes](https://github.com/mishelashala/sound-ts/issues/51) — `brand type` / `validate type` / `cast<>` are explicit nodes (or a stable side-table).
- [x] [AST soundness visitors](https://github.com/mishelashala/sound-ts/issues/52) — move 0.x bans off masked-string scans onto AST visitors.
- [x] [Scopes and symbols](https://github.com/mishelashala/sound-ts/issues/53) — cross-file Sound-TS symbols for brands / companions / cast targets.
- [x] [Complete soundness rules](https://github.com/mishelashala/sound-ts/issues/54) — 1.0 reject/accept matrix (boundaries, predicates, mutation, generics subset) on the AST + symbol layer.

---

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | Parse + transform `brand type` / `validate type` / `cast<>` → plain TS + runtime |
| `packages/cli` | One-command expand (`sts` / `sound-ts`) |
| `packages/vite` | Vite plugin `soundTs()`: expand `.sts` on dev and build |
| `packages/vscode` | Thin extension: highlight `brand type`, optional CLI command |

---

## What about `defineLiteralSet`?

**Not the product API.** Authors write `brand type`. `defineLiteralSet` is an **internal** emit/runtime helper (optional emit target for string literal brands). Do not import it in app code — use the dialect + CLI.

## Method emit

`.sts` methods still use `method()` syntax. Expand rewrites them to **readonly function properties** so stock `strictFunctionTypes` applies. Class methods become readonly instance properties (not on the prototype); `this` inside is lexical.

---

## VS Code

`packages/vscode` registers `.sts`, TextMate highlighting for `brand type` (including injection into `.ts`), and a command that shells out to the CLI. No full custom checker — prefer authoring in **`.sts`** so stock `tsc` doesn’t red-squiggle the dialect.

**Local-only for now.** The extension is not on the VS Code Marketplace yet — install from this repo (e.g. “Install from VSIX…” or open `packages/vscode` for development). Marketplace publish comes later.

---

## Non-goals (this cut)

See also: [FAQ: Why not TypeScript?](https://mishelashala.github.io/sound-ts/#faq) (why a dialect vs stock TS) · [Soundness](#soundness-project-goal).

- **No Microsoft / TypeScript fork** to maintain
- **No custom TypeScript language server in 0.x** — stock `tsc` runs on expand output; 1.0 adds a Sound-TS semantic phase *before* emit, still not a Microsoft fork
- **No open brands without `is`** (use refined brands with a custom `.is`)
- Refined brands and `validate type` are **nominally opaque** under stock `tsc` (phantom unique-symbol brands) — not structural aliases of their bases. Enter via `.from` / `cast<>`.
- String literal brands are the member literals **or** a phantom arm (nominal under stock `tsc`; member literals still assign). They do not flow back to the bare literal union. Number/bigint literal brands not supported yet.
- **0.x delivered** surface bans and tooling ([roadmap v1](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v1) / [v2](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v2)). Outbound widen from a `validate type` to the naked structure remains a stock `tsc` hole until a later design closes it.
- **1.0 roadmap issues #50–#54 delivered** (AST + symbols + initial rule slice). Deferred items: [`SOUNDNESS_1_0.md`](packages/core/src/soundness/SOUNDNESS_1_0.md). Package version may still be `0.x` until a `1.0.0` release cut.
- Not a full schema library — `validate type` covers simple object shapes only (no nested objects, generics, `Date`, …)
- VS Code extension **not on Marketplace** yet (local install only)
- `defineLiteralSet` is **not** the public authoring API

---

## License

MIT
