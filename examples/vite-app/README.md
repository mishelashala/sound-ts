<!-- pnpm dev is the dev command -->

# vite-app

Vite expands `.sts` on dev and on build. `dev` and `build` call Vite only (not `sts`).

Import the brand with the `.sts` specifier:

```ts
import { Account } from "./roles.sts";
```

`pnpm dev` is the dev command. `pnpm build` is the production build.
