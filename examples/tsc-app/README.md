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
node ../../packages/cli/dist/cli.js src -o .sound-ts
tsc -p tsconfig.json
```

From this repo, after `pnpm build` at the root:

```bash
pnpm --dir examples/tsc-app build
```

`node ../../packages/cli/dist/cli.js` is `packages/cli/dist/cli.js` (the `sts` / `sound-ts` bin). Output is `examples/tsc-app/.sound-ts`. There is no default shadow cache yet, so the script passes `-o .sound-ts`.

## tsc

`tsconfig.json` does not include `*.sts`.

- `rootDir`: `.sound-ts` (expanded `.ts` only)
- `outDir`: `dist`
- `include`: `.sound-ts/**/*.ts`
- `exclude`: `**/*.sts`, `src`

## Sources

`src/roles.sts`:

```sts
brand type Account = "admin" | "regular";
```

`src/app.ts` imports `Account` from `./roles.js`. Stock `tsc` sees that import only after expand, as `.sound-ts/roles.ts`.

## Fail closed

`pnpm --dir examples/tsc-app test` copies this app to a temp directory, corrupts `roles.sts`, runs `scripts/build.mjs`, and checks for a non-zero exit and no emitted `dist/*.js`.
