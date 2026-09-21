<p align="center">
  <img src="docs/assets/seal.svg" width="64" height="64" alt="superset-ts seal" />
</p>

<h1 align="center">superset-ts</h1>

**Dialect + CLI:** write `brand type`, expand to plain TypeScript types + runtime companions (`Account.is` / `Account.from`) that stock `tsc` / Vite / VS Code already understand.

> **Not a TypeScript fork.** No patched `tsc`, no Microsoft fork to maintain, no custom checker. The CLI rewrites source; bundlers consume **output** only.

Repo: [mishelashala/superset-ts](https://github.com/mishelashala/superset-ts) · docs: [mishelashala.github.io/superset-ts](https://mishelashala.github.io/superset-ts/) · npm: [`@mishelashala/superset-ts-cli`](https://www.npmjs.com/package/@mishelashala/superset-ts-cli) / [`@mishelashala/superset-ts-core`](https://www.npmjs.com/package/@mishelashala/superset-ts-core)

---


## Install

```bash
npm i -g @mishelashala/superset-ts-cli
# bins: sts, superset-ts
```

Library: `@mishelashala/superset-ts-core`.

## Authoring

**Prefer `.sts` files.** Stock TypeScript language service will red-squiggle `brand type` inside ordinary `.ts` / `.tsx` (unknown keywords). The VS Code extension’s TextMate grammar covers `.sts`; injection into `.ts` only helps highlighting, not the checker.

### String literal brands

```sts
brand type Account = "admin" | "regular";
```

Expands to a plain `type Account = …` plus a runtime companion with `.values`, `.is`, `.from`.

### Refined brands

```sts
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
```

Expands to `type PositiveInt = number` plus a companion that keeps your `.is` body and **generates** `.from` (validate via `.is`). Under stock `tsc`, the type alias is still the base (`number`) — the refinement is **runtime-only** (`.is` / `.from`); that is expected, not a fork. No separate `.d.ts` emit — plain `.ts` only.

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

---

## Quickstart (CLI)

```bash
git clone https://github.com/mishelashala/superset-ts.git
cd superset-ts
pnpm install
pnpm build
pnpm test

# expand one file (.sts → .ts, or .ts → .gen.ts by default)
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


## Adoption recipe (not all-or-nothing)

Keep most of the app as normal `.ts` (stock `tsc` / Vite). Add `.sts` only where you want `brand type`.

- Expand in CI (`sts … -o …`), then compile the output as usual.
- Start with one leaf brand file (ids / roles) → grow file by file.
- Pass the **whole `.sts` batch** to `sts` for cross-file `|` / `&`; composing files still `import` companions so emit typechecks under stock `tsc`.

---

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | Parse + transform `brand type` → plain TS + runtime |
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

- **No Microsoft / TypeScript fork** to maintain
- No custom TypeScript checker or language server fantasy
- **No open brands without `is`** (use refined brands; later tip for phantom ID opacity + `.from` — not open-without-`is`)
- **Not** nominal string-literal brands / number-or-bigint literal brands
- Not a full schema / object validation library
- VS Code extension not on Marketplace yet (local install only)
- VS Code extension **not on Marketplace** yet (local install only)
- `defineLiteralSet` is **not** the public authoring API

---

## License

MIT
