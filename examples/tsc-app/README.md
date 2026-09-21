# tsc-app

Plain `tsc` app. One command expands `.sts`, then runs `tsc`. If expand fails, `tsc` does not run.

## Scripts

`package.json`:

```json
{
  "scripts": {
    "build": "node scripts/build.mjs"
  }
}
```

`scripts/build.mjs` runs the CLI, then `tsc` only when that process exits 0:

```bash
node ../../packages/cli/dist/cli.js src -o .superset
tsc -p tsconfig.json
```

From this repo, after `pnpm build` at the root:

```bash
pnpm --dir examples/tsc-app build
```

`node ../../packages/cli/dist/cli.js` is `packages/cli/dist/cli.js` (the `sts` / `superset-ts` bin). Output is `examples/tsc-app/.superset`. There is no default shadow cache yet, so the script passes `-o .superset`.

## tsc

`tsconfig.json` does not include `*.sts`.

- `rootDir`: `.superset` (expanded `.ts` only)
- `outDir`: `dist`
- `include`: `.superset/**/*.ts`
- `exclude`: `**/*.sts`, `src`

## Sources

`src/roles.sts`:

```sts
brand type Account = "admin" | "regular";
```

`src/app.ts` imports `Account` from `./roles.js`. Stock `tsc` sees that import only after expand, as `.superset/roles.ts`.

## Fail closed

`pnpm --dir examples/tsc-app test` copies this app to a temp directory, corrupts `roles.sts`, runs `scripts/build.mjs`, and checks for a non-zero exit and no emitted `dist/*.js`.
