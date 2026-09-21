<p align="center">
  <img src="docs/logo.png" width="64" height="64" alt="sound-ts" />
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

### Entry contract

Unknown input enters with `.from`. `.from` always runs the check and throws on failure. A known string member is `Brand.Values.member`. A known number member is `Brand.Values[n]`. There is no `fromTrusted`, `fromPersisted`, or other companion method that skips `is`.

The brand does not format. `toFixed`, slugify, and similar stay in a normal function that calls `.from`. A label stays a normal function over `.toPrimitive`, not a method on the companion.

Invalid data at a source is fixed at that source. The brand still rejects it. Vacuous Mode B `is` bodies (empty, ignores the argument, or `return true`) stay rejected. That check does not prove the body is logically correct.

### String literal brands

```sts
brand type Account = "admin" | "regular";
```

Expands to the member literals **plus** a phantom arm, plus a runtime companion with `.values`, `.Values`, `.is`, `.from`, `.toPrimitive`:

- `Account.from(raw)` — unknown / external input
- `Account.Values.admin` — known member constant (no string typo)
- `Account.values` — readonly array (Joi / iteration)

Under stock `tsc`, `setRole("admin")` is OK, widened `string` is not, and a second brand with the same members is not assignable to `Account`. A value of type `Account` is assignable to `string`, not back to `"admin" | "regular"`.

See the [playground](https://mishelashala.github.io/sound-ts/playground.html) for expanded TypeScript / JavaScript.

### Refined brands

```sts
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
```

Expands to a **phantom unique-symbol brand** plus a companion that keeps your `.is` body and **generates** `.from` (validate via `.is`) and `.toPrimitive` (identity back to the base type).

Under stock `tsc`, bare `number` is **not** assignable to `PositiveInt` — enter via `.from` / `cast<PositiveInt>(…)`. Runtime checks still matter at boundaries; the brand alone is not enough. No separate `.d.ts` emit — plain `.ts` only. Expanded output: [playground](https://mishelashala.github.io/sound-ts/playground.html).

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

Same-file composition still works (`User & Session`, etc.). Pass the directory (or both files) to `sts` so the project brand map sees every declaration; then point `tsc` at the expanded output. For the expanded TypeScript / JavaScript shape, use the [playground](https://mishelashala.github.io/sound-ts/playground.html).

### Validate type

Object types with primitive fields → phantom-branded type + same `.is` / `.from` companions (bare object literals are not assignable under stock `tsc` — use `.from` / `cast<>`):

```sts
validate type User = { id: string; age: number };

User.is(data);
User.from(data); // throws on mismatch; returns User
```

**Supported field shapes:** `string` | `number` | `boolean` | `null`, optional `?`, arrays of those primitives (`string[]`), unions of those (e.g. `string | null`), nested objects of those leaves, `Date`, and a `brand type` or `validate type` name from the same file, an import, or the `sts` batch. A brand field is still that nominal type: put a value in it with the inner `.from`, or store a value that is already that brand. `.from` checks the shape at runtime and does not format the value. Generics (`Partial`, `Required`, `Array<…>`), function types, and other shapes error at expand and name the unsupported type.

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

# Node app — one compiler step (project directory contains tsconfig.json)
node packages/cli/dist/cli.js build examples/tsc-app
node packages/cli/dist/cli.js watch examples/tsc-app
```

`sts <input>` writes plain TS and does not emit JS. Point stock `tsc` / Vite at that output when you expand by hand. A Node app stops at `sts build`: stock `tsc` runs inside `sts` and JS is written to `outDir`.

Binaries after build: `sound-ts` / `sts` → `packages/cli/dist/cli.js`.

### Parser notes

Remaining scanner edges: regex literals; nested `${}` inside templates (the whole template is skipped).

---


## Adoption / roadmap

Keep most of the app as normal `.ts` (stock `tsc` / Vite). Add `.sts` only where you want `brand type`, `validate type`, or `cast`. VS Code already highlights `.sts`, so “just add a file” isn’t red-squiggle hell.

**Node — one `sts` command:**

```
.sts + .ts  --sts build-->  .js in the project's outDir
```

- `sts build [project]` expands `.sts`, typechecks with stock `tsc`, and writes JS to `outDir` (`dist` in `examples/tsc-app`)
- `sts watch [project]` or `sts build --watch` rebuilds when `.sts` or `.ts` inputs change
- Expand failure exits non-zero and does not emit JS from that run
- `tsconfig.json` keeps the app's own `rootDir` and `include`. It does not point at a `.sound-ts` directory
- Files stock `tsc` reads are written under the OS temp directory for that run
- `sts <input>` / `sts transform` still expands to plain TS only (default `<cwd>/.sound-ts/`, or `-o`)
- Whole `.sts` batch on each run for cross-file `|` / `&` and `cast` companions
- Enter refined / validate types via `.from` or `cast<>` — bare bases are not assignable under stock `tsc`

### Drop-in build

`examples/tsc-app` is a Node app. `build` and `dev` call `sts` only.

`package.json`:

```json
{
  "scripts": {
    "build": "sts build",
    "dev": "sts watch"
  }
}
```

`tsconfig.json` sets `rootDir` to `src` and `outDir` to `dist`. `include` is `src`. It does not mention `.sound-ts`.

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
- [x] [One command, no project cache, watch](https://github.com/mishelashala/sound-ts/issues/71) — `sts build` / `sts watch` is the Node compiler step. Expanded TS for stock `tsc` stays in the OS temp directory. The app `tsconfig.json` does not point at `.sound-ts`.
- [x] [`.from` is the only door](https://github.com/mishelashala/sound-ts/issues/75) — unknown input enters with `.from` (always checks). Known members are `Brand.Values.member` or `Brand.Values[n]`. No unchecked constructor. Formatting and labels stay normal functions. See [Entry contract](#entry-contract).

---

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | Parse + transform `brand type` / `validate type` / `cast<>` → plain TS + runtime |
| `packages/cli` | `sts build` / `sts watch`, and expand to plain TS (`sts` / `sound-ts`) |
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
- String and number literal brands are the member literals **or** a phantom arm (nominal under stock `tsc`; member literals still assign). They do not flow back to the bare literal union. Bigint literal brands are not supported yet.
- **0.x delivered** surface bans and tooling ([roadmap v1](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v1) / [v2](https://github.com/mishelashala/sound-ts/issues?q=roadmap+v2)). Outbound widen from a `validate type` to the naked structure remains a stock `tsc` hole until a later design closes it.
- **1.0 roadmap issues #50–#54 delivered** (AST + symbols + initial rule slice). Deferred items: [`SOUNDNESS_1_0.md`](packages/core/src/soundness/SOUNDNESS_1_0.md). Package version may still be `0.x` until a `1.0.0` release cut.
- Not a full schema library — `validate type` accepts nested objects, `Date`, and brand / validate field names. Generics (`Partial`, `Required`), function fields, and formatting inside `.from` stay out.
- VS Code extension **not on Marketplace** yet (local install only)
- `defineLiteralSet` is **not** the public authoring API

---

## License

MIT
