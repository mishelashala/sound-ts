# superset-ts

**Dialect + CLI:** write `brand type`, expand to plain TypeScript types + runtime companions (`Account.is` / `Account.from`) that stock `tsc` / Vite / VS Code already understand.

> **Not a TypeScript fork.** No patched `tsc`, no Microsoft fork to maintain, no custom checker in v0. The CLI rewrites source; bundlers consume **output** only.

Repo: [mishelashala/superset-ts](https://github.com/mishelashala/superset-ts) · docs: [mishelashala.github.io/superset-ts](https://mishelashala.github.io/superset-ts/) · **not published to npm**

---

## Authoring (phase 1)

```ts
brand type Account = "admin" | "regular";
```

String literal unions only in this cut. The CLI expands that into:

- a plain `type Account = "admin" | "regular"`
- a runtime companion `Account` with `.values`, `.is`, `.from` — usable from JS

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

---

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | Parse + transform `brand type` → plain TS + runtime |
| `packages/cli` | One-command expand (`sts` / `superset-ts`) |
| `packages/vscode` | Thin extension: highlight `brand type`, optional CLI command |

---

## What about `defineLiteralSet`?

**Not the product API.** Authors write `brand type`. `defineLiteralSet` is an **internal** emit/runtime helper (optional emit target). Do not import it in app code — use the dialect + CLI.

---

## VS Code

`packages/vscode` registers `.sts`, TextMate highlighting for `brand type` (including injection into `.ts`), and a command that shells out to the CLI. No full custom checker in v0 — dialect shouldn’t be totally red-squiggled; transform story stays CLI-based.

---

## Non-goals (v0)

- **No Microsoft / TypeScript fork** to maintain
- No custom TypeScript checker or language server fantasy
- Phase 1: **string literal unions only** (`brand type Name = "a" \| "b"`)
- Not nominal brands — closed literal union + runtime (structural)
- Not a full schema / object validation library
- **No npm publish** in this cut
- `defineLiteralSet` is **not** the public authoring API

---

## License

MIT
