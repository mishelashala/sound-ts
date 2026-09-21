import path from "node:path";

/** Gitignored shadow-emit cache. Never a sibling of the source file. */
export const SOUND_TS_CACHE_DIR = ".sound-ts";

export type OutputTarget =
  | { kind: "directory"; inputRoot: string; outputRoot: string }
  | { kind: "file"; outputFile: string };

/**
 * Default cache placement:
 * - Input path is inside the cwd (or is the cwd) → `<cwd>/.sound-ts`
 * - Input path is outside the cwd → `<dirname(input)>/.sound-ts`
 *   (a directory input lands next to that directory; a file lands in
 *   `<file-dir>/.sound-ts/<name>.ts`)
 *
 * Directory inputs are mirrored relative to the input directory.
 * `.sts` becomes `.ts`. A single file uses its basename under the cache,
 * so `roles.sts` becomes `.sound-ts/roles.ts` and never a sibling `roles.ts`.
 * Explicit `-o` replaces the cache (a file path for one file, a directory
 * for a directory input). Output paths are never rewritten to `.js`.
 */
export function resolveOutputTarget(options: {
  input: string;
  isDirectory: boolean;
  cwd: string;
  explicitOutput?: string;
}): OutputTarget {
  const cwd = path.resolve(options.cwd);
  const input = path.resolve(cwd, options.input);

  if (options.explicitOutput !== undefined) {
    const explicit = path.resolve(cwd, options.explicitOutput);
    if (options.isDirectory) {
      return { kind: "directory", inputRoot: input, outputRoot: explicit };
    }
    return { kind: "file", outputFile: explicit };
  }

  const cacheParent = isInside(cwd, input) ? cwd : path.dirname(input);
  const outputRoot = path.join(cacheParent, SOUND_TS_CACHE_DIR);

  if (options.isDirectory) {
    return { kind: "directory", inputRoot: input, outputRoot };
  }

  return {
    kind: "file",
    outputFile: path.join(outputRoot, toTsName(path.basename(input))),
  };
}

/** Mirror one source path under an output directory. `.sts` → `.ts`. */
export function mapOutputPath(inputPath: string, inputRoot: string, outputRoot: string): string {
  const rel = path.relative(inputRoot, inputPath);
  return path.join(outputRoot, toTsName(rel));
}

function toTsName(filename: string): string {
  if (filename.endsWith(".sts")) return filename.slice(0, -4) + ".ts";
  return filename;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
