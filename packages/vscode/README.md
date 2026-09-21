# Superset TS (VS Code)

Thin editor support for the **superset-ts** dialect:

- Registers `.sts` language + TextMate grammar so `brand type` is highlighted
- Injection grammar for `brand type` inside ordinary `.ts` / `.tsx` (highlight only)
- Command **Superset TS: Transform brand type (run CLI)** — shells out to `sts` / `packages/cli`

**Not** a TypeScript fork, custom checker, or full language server. Stock `tsc` / Vite consume **CLI output** only.

## Authoring: prefer `.sts`

Stock TypeScript language service will red-squiggle `brand type` inside `.ts` / `.tsx`. Prefer **`.sts`** — TextMate covers that language id. Injection into `.ts` improves highlighting but does not silence the checker.

```sts
brand type Account = "admin" | "regular";
```

Then run the CLI (or the command above) to expand into a plain type + `Account.is` / `Account.from` runtime companion.

## Install (local-only)

**Not on the VS Code Marketplace yet.** Until publish:

1. Clone [mishelashala/superset-ts](https://github.com/mishelashala/superset-ts)
2. In VS Code: **Extensions → … → Install from VSIX…** after packaging, **or** open `packages/vscode` and use **Developer: Install Extension from Location…** / F5 for Extension Development Host

Marketplace listing comes later. The package is also unpublished on npm (see root README).
