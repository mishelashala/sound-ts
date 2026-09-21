# Superset TS (VS Code)

Thin editor support for the **superset-ts** dialect:

- Registers `.sts` language + TextMate grammar so `brand type` is highlighted
- Injection grammar for `brand type` inside ordinary `.ts` / `.tsx`
- Command **Superset TS: Transform brand type (run CLI)** — shells out to `sts` / `packages/cli`

**Not** a TypeScript fork, custom checker, or full language server. Stock `tsc` / Vite consume **CLI output** only.

Authoring:

```ts
brand type Account = "admin" | "regular";
```

Then run the CLI (or the command above) to expand into a plain type + `Account.is` / `Account.from` runtime companion.
