# tsc-app

Node app. `build` and `dev` call `sts` only. `sts` expands `.sts`, typechecks, and emits JS into `dist`. If expand fails, no JS is emitted.

## Scripts

`package.json`:

```json
{
  "scripts": {
    "build": "sts build",
    "dev": "sts watch"
  }
}
```

From this repo, after `pnpm build` at the root:

```bash
pnpm --dir examples/tsc-app build
pnpm --dir examples/tsc-app dev
```

`sts` is `packages/cli/dist/cli.js` (the `sts` / `sound-ts` bin). `dev` is `sts watch`: a change to `.sts` or `.ts` rebuilds.

## tsc

`tsconfig.json` does not mention `.sound-ts`.

- `rootDir`: `src`
- `outDir`: `dist`
- `include`: `src`

Stock `tsc` runs inside `sts`. Expanded `.ts` for that run is written under the OS temp directory, not in this app.

## Sources

`src/roles.sts`:

```sts
brand type Account = "admin" | "regular";
```

`src/app.ts` imports `Account` from `./roles.js`.

## Fail closed

`pnpm --dir examples/tsc-app test` copies this app to a temp directory, corrupts `roles.sts`, runs `sts build`, and checks for a non-zero exit and no emitted `dist/*.js`.
