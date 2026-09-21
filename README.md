<p align="center">
  <img src="docs/assets/seal.svg" width="64" height="64" alt="superset-ts seal" />
</p>

<h1 align="center">superset-ts</h1>

**Type soundness for TypeScript, inspired by F# types.**

> **Not a TypeScript fork.** No patched `tsc`, no Microsoft fork to maintain, no custom checker. The CLI rewrites source; bundlers consume **output** only.

Repo: [mishelashala/superset-ts](https://github.com/mishelashala/superset-ts) · docs: [mishelashala.github.io/superset-ts](https://mishelashala.github.io/superset-ts/) · npm: [`@mishelashala/superset-ts-cli`](https://www.npmjs.com/package/@mishelashala/superset-ts-cli) / [`@mishelashala/superset-ts-core`](https://www.npmjs.com/package/@mishelashala/superset-ts-core)

---



## Soundness (project goal)

TypeScript’s contract is **type safety with erased types** — no runtime companions from the type layer. Superset-TS aims for **F#-style soundness**: opaque / branded (phantom) types plus runtime companions so values enter through checked paths.

**Where we claim soundness today**

- `brand type` string-literal brands — member literals stay assignable; a phantom arm keeps two brands with the same members distinct. Outbound to `string` works; outbound to the bare literal union does not
- `brand type` refined brands — phantom `unique symbol` emit; bare base not assignable under stock `tsc`
- `validate type` — same phantom + `.is` / `.from`
- `cast<Target>(expr)` — checked entry path (primitive checks or companion `.from`)

**Where we still lean on stock TS unsoundness** (honest Non-goals)

- assertions / `as` (stock TS)
- `any` / `unknown` misuse
- structural widen on non-branded types

Gate: new dialect surface should **close a soundness hole**, not paper over one.

---

## Install

```bash
npm i -g @mishelashala/superset-ts-cli
# bins: sts, superset-ts
```

Library: `@mishelashala/superset-ts-core`.

## Authoring

**Prefer `.sts` files.** Stock TypeScript language service will red-squiggle dialect keywords (`brand type`, `validate type`, `cast`) inside ordinary `.ts` / `.tsx`. The VS Code extension’s TextMate grammar covers `.sts`; injection into `.ts` only helps highlighting, not the checker.

### String literal brands

```sts
brand type Account = "admin" | "regular";
```

Expands to the member literals **plus** a phantom arm, plus a runtime companion with `.values`, `.is`, `.from`:

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

**Supported field shapes:** `string` | `number` | `boolean`, optional `?`, arrays of those (`string[]`), and unions of those. Nested objects, generics, `Date`, imported aliases as field types, etc. error clearly at transform time.

### Checked casts (`cast<>`)

```sts
const n = cast<number>(raw);  // inline typeof check; throws on mismatch
const u = cast<User>(raw);    // User.from(raw) when User is a brand/validate companion in the batch
```

Targets: primitives or known companions from the CLI batch. Unknown targets error at transform time.

---

## Quickstart (CLI)

```bash
git clone https://github.com/mishelashala/superset-ts.git
cd superset-ts
pnpm install
pnpm build
pnpm test

# expand one file into .superset/ (roles.sts → .superset/roles.ts, not a sibling .ts)
pnpm --filter @mishelashala/superset-ts-cli exec sts path/to/file.sts
# or after linking / running dist:
node packages/cli/dist/cli.js path/to/file.sts -o path/to/out.ts

# expand a directory
node packages/cli/dist/cli.js ./src -o ./out
```

Point `tsc` / Vite at **`./out`** (the transformed files), not the dialect sources.

Binaries after build: `superset-ts` / `sts` → `packages/cli/dist/cli.js`.

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
- Default output → `<cwd>/.superset/` (gitignored; input outside the cwd caches next to that input) or `-o` you choose
- Stock Nest / `tsc` still owns `dist/`
- Don’t point `tsc` at raw `.sts`
- Whole `.sts` batch on each `sts` run for cross-file `|` / `&` and `cast` companions
- Enter refined / validate types via `.from` or `cast<>` — bare bases are not assignable under stock `tsc`

**Seamless integration** — [roadmap v1](https://github.com/mishelashala/superset-ts/issues?q=roadmap+v1). Check a box in this list only when that issue is delivered.

- [ ] [Shadow emit](https://github.com/mishelashala/superset-ts/issues/27) — `sts` writes a gitignored cache, never a sibling `.ts`. CI fails if that output is committed.
- [ ] [Bidirectional resolve](https://github.com/mishelashala/superset-ts/issues/28) — `.ts` and `.sts` import each other. Import paths stay as the author wrote them.
- [ ] [Drop-in build script](https://github.com/mishelashala/superset-ts/issues/29) — one `package.json` script expands, then runs `tsc`. Expand failure stops the build.
- [ ] [Loader](https://github.com/mishelashala/superset-ts/issues/30) — Vite expands `.sts` on dev and build, so you stop calling `sts` by hand.

---

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | Parse + transform `brand type` / `validate type` / `cast<>` → plain TS + runtime |
| `packages/cli` | One-command expand (`sts` / `superset-ts`) |
| `packages/vscode` | Thin extension: highlight `brand type`, optional CLI command |

---

## What about `defineLiteralSet`?

**Not the product API.** Authors write `brand type`. `defineLiteralSet` is an **internal** emit/runtime helper (optional emit target for string literal brands). Do not import it in app code — use the dialect + CLI.

---

## VS Code

`packages/vscode` registers `.sts`, TextMate highlighting for `brand type` (including injection into `.ts`), and a command that shells out to the CLI. No full custom checker — prefer authoring in **`.sts`** so stock `tsc` doesn’t red-squiggle the dialect.

**Local-only for now.** The extension is not on the VS Code Marketplace yet — install from this repo (e.g. “Install from VSIX…” or open `packages/vscode` for development). Marketplace publish comes later.

---

## Non-goals (this cut)

See also: [FAQ: Why not TypeScript?](https://mishelashala.github.io/superset-ts/#faq) (why a dialect vs stock TS) · [Soundness](#soundness-project-goal).

- **No Microsoft / TypeScript fork** to maintain
- **No custom TypeScript checker or language server** — stock `tsc` runs on expand output only.
- **No open brands without `is`** (use refined brands with a custom `.is`)
- Refined brands and `validate type` are **nominally opaque** under stock `tsc` (phantom unique-symbol brands) — not structural aliases of their bases. Enter via `.from` / `cast<>`.
- String literal brands are the member literals **or** a phantom arm (nominal under stock `tsc`; member literals still assign). They do not flow back to the bare literal union. Number/bigint literal brands not supported yet.
- We do **not** patch stock `as` / assertions, `any` / `unknown` misuse, or structural widen on non-branded types — those remain TS holes outside the dialect surface.
- Not a full schema library — `validate type` covers simple object shapes only (no nested objects, generics, `Date`, …)
- VS Code extension **not on Marketplace** yet (local install only)
- `defineLiteralSet` is **not** the public authoring API

---

## License

MIT
