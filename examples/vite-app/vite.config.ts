import { defineConfig } from "vite";
import { soundTs } from "@mishelashala/sound-ts-vite";

export default defineConfig({
  plugins: [soundTs()],
});
