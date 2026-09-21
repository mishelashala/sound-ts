# @mishelashala/sound-ts-vite

Vite plugin. Export: `soundTs()`.

Expands `.sts` (`brand type`, `validate type`, `cast<>`) to plain TypeScript during `vite` dev and `vite build`. Vite compiles that TypeScript. Invalid `.sts` throws and fails the build. No `sts` CLI step.

```ts
import { defineConfig } from "vite";
import { soundTs } from "@mishelashala/sound-ts-vite";

export default defineConfig({
  plugins: [soundTs()],
});
```

Import the dialect file with the `.sts` specifier:

```ts
import { Account } from "./roles.sts";
```

Example: `examples/vite-app`.
