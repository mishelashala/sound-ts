import { defineConfig } from "vite";
import { supersetTs } from "@mishelashala/superset-ts-vite";

export default defineConfig({
  plugins: [supersetTs()],
});
