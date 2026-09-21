/**
 * Vite plugin: treat `.sts` as a module and expand
 * `brand type` / `validate type` / `cast<>` with the core transform.
 * Vite then compiles the plain TypeScript. Invalid dialect throws.
 *
 * Import with the `.sts` specifier: `import { Account } from "./roles.sts"`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform as transformSts } from "@mishelashala/superset-ts-core";
import type { Plugin } from "vite";

/** Query flag so the module id ends in `.ts` (Vite's TS compile) without colliding with real files. */
const MARK = "superset-ts";

function splitQuery(id: string): { file: string; query: string } {
  const q = id.indexOf("?");
  if (q === -1) return { file: id, query: "" };
  return { file: id.slice(0, q), query: id.slice(q + 1) };
}

function hasMark(query: string): boolean {
  return query.split("&").some((part) => part === MARK || part.startsWith(`${MARK}=`));
}

function isRawSts(id: string): boolean {
  const { file } = splitQuery(id);
  return file.endsWith(".sts");
}

function markedModuleId(stsFile: string, query: string): string {
  const parts = query.split("&").filter((part) => part.length > 0);
  if (!hasMark(parts.join("&"))) parts.push(MARK);
  return `${stsFile}.ts?${parts.join("&")}`;
}

/** Real `.sts` path for an id this plugin minted (`file.sts.ts?superset-ts`). */
function sourceStsFromMarked(id: string): string | null {
  const { file, query } = splitQuery(id);
  if (!hasMark(query) || !file.endsWith(".sts.ts")) return null;
  return file.slice(0, -".ts".length);
}

function stsFilename(id: string): string | null {
  return sourceStsFromMarked(id) ?? (isRawSts(id) ? splitQuery(id).file : null);
}

function expand(code: string, filename: string): string {
  return transformSts(code, { filename }).code;
}

export function supersetTs(): Plugin {
  return {
    name: "superset-ts",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!isRawSts(source) || source.includes("node_modules")) return null;

      const resolved = await this.resolve(source, importer, {
        ...(options ?? {}),
        skipSelf: true,
      });

      let stsFile: string | null = null;
      let query = "";
      if (resolved && !resolved.external) {
        const parts = splitQuery(resolved.id);
        if (parts.file.endsWith(".sts")) {
          stsFile = parts.file;
          query = parts.query;
        }
      }

      if (!stsFile && importer) {
        const spec = splitQuery(source);
        const from = splitQuery(importer).file;
        const candidate = path.isAbsolute(spec.file)
          ? spec.file
          : path.resolve(path.dirname(from), spec.file);
        if (candidate.endsWith(".sts") && existsSync(candidate)) {
          stsFile = candidate;
          query = spec.query;
        }
      }

      if (!stsFile) return null;
      return markedModuleId(stsFile, query);
    },

    async load(id) {
      const file = sourceStsFromMarked(id);
      if (!file) return null;
      this.addWatchFile(file);
      return readFile(file, "utf8");
    },

    async transform(code, id) {
      const filename = stsFilename(id);
      if (!filename || filename.includes("node_modules")) return null;
      return { code: expand(code, filename), map: null };
    },
  };
}
