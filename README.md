# @mishelashala/superset-ts

**Library-first helpers that emit plain valid TypeScript for stock `tsc` / Vite / VS Code — not a TypeScript fork or checker.** Codegen is not shipped yet.

> **Name note:** “superset-ts” can sound like a TypeScript fork. It is **not**. There is no patched `tsc`, no custom language server, and no alternate checker. You import a normal npm library; types and runtime helpers are ordinary TypeScript that the stock toolchain already understands.

Package: `@mishelashala/superset-ts` · repo: [mishelashala/superset-ts](https://github.com/mishelashala/superset-ts) · docs: [mishelashala.github.io/superset-ts](https://mishelashala.github.io/superset-ts/) · **not published to npm yet** (install from git / local path).

---

## What this is / isn’t

| Is | Isn’t |
| --- | --- |
| A small **Mode A** library for closed/finite string literal sets | A fork of TypeScript or `tsc` |
| Runtime helpers (`.values`, `.is`, `.from`) + union typing | A new checker, LSP, or TS language dialect |
| Plain TS that works with stock tooling | Something you must wait for us to publish |
| Library-first today (codegen not shipped yet) | A replacement for Zod / io-ts / etc. for all schemas |

**Mode A (v0):** define a named closed set of string literals once; get a typed union for function params and runtime parse/guard helpers. Happy path needs **no casts**.

---

## Quickstart

```bash
# from git (not on npm yet)
pnpm add github:mishelashala/superset-ts
# or: npm install github:mishelashala/superset-ts
```

Local clone:

```bash
git clone https://github.com/mishelashala/superset-ts.git
cd superset-ts
pnpm install
pnpm test
pnpm build
```

### Define → use in a function param

```ts
import { defineLiteralSet, type InferLiteral } from "@mishelashala/superset-ts";

const AccountRole = defineLiteralSet("AccountRole", ["admin", "regular"] as const);
type AccountRole = InferLiteral<typeof AccountRole>; // "admin" | "regular"

// Call sites stay valid stock TypeScript — no casts on the happy path.
function greet(role: AccountRole): string {
  return role === "admin" ? "hello, admin" : "hello";
}

greet(AccountRole.from("admin")); // ok at compile time + runtime

AccountRole.is("guest");          // false
AccountRole.from("guest");        // throws LiteralSetError
AccountRole.values;               // readonly ["admin", "regular"]
```

`AccountRole.from(x)` returns the narrowed union type. Invalid input fails at **runtime** with `LiteralSetError`. Valid string literals type-check like any other `"admin" | "regular"` union.

---

## API

### `defineLiteralSet(name, values)`

Single Mode A entry point (closed literal set + runtime).

```ts
function defineLiteralSet<
  Name extends string,
  const Values extends readonly [string, ...string[]],
>(name: Name, values: Values): LiteralSet<Name, Values>
```

| Member | Role |
| --- | --- |
| `.name` | Set name used in errors |
| `.values` | Frozen list of allowed strings |
| `.is(x)` | Type guard → `x is Values[number]` |
| `.from(x)` | Parse / narrow, or throw `LiteralSetError` |

### `InferLiteral<typeof SomeSet>`

Extracts the string-literal union for annotations and params.

### `LiteralSetError`

Thrown by `.from` when the value is not in the set. Fields: `setName`, `value`, `allowed`.

Definition-time checks: non-empty name, non-empty values, all strings, no duplicates.

---

## Non-goals (v0)

- No TypeScript fork, plugin, or custom checker
- No npm publish in this scaffold (personal repo only for now)
- No full schema / object validation library
- **Not nominal brands:** v0 is a **closed literal union + runtime**. Sets with the same members are assignable to each other even if differently named (structural / union semantics). [#64364](https://github.com/microsoft/TypeScript/issues/64364)-style nominal Mode A is **out of scope** for this cut.
- Codegen is not shipped yet; this cut is library-first

---

## Publish later

This package is prepared (`package.json` name `@mishelashala/superset-ts`, MIT, exports) but **do not publish** until you choose to. Until then, consumers install from this GitHub repo or a path/workspace link.

---

## License

MIT
