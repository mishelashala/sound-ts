/**
 * `sts build` / `sts watch`: expand `.sts`, then run stock `tsc` so JS lands in
 * the project's `outDir`. Expanded sources live under `os.tmpdir()` for that
 * run. Not a TypeScript fork and not a language server.
 */
import { spawnSync } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { transformProject } from "@mishelashala/sound-ts-core";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".sound-ts"]);

interface ProjectLayout {
  projectDir: string;
  configPath: string;
  compilerOptions: Record<string, unknown>;
  sourceRoot: string;
  outDir: string;
}

export async function buildProject(projectDir: string): Promise<number> {
  let layout: ProjectLayout;
  try {
    layout = await loadProject(projectDir);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  let files: string[];
  try {
    files = await collectInputs(layout.sourceRoot, layout.outDir);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  if (files.length === 0) {
    console.error("No .ts / .tsx / .sts files found.");
    return 1;
  }

  const sources = await Promise.all(
    files.map(async (filename) => ({
      filename,
      source: await readFile(filename, "utf8"),
    })),
  );

  let transformed;
  try {
    transformed = transformProject(sources);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const cache = await mkdtemp(path.join(tmpdir(), "sts-build-"));
  try {
    const emitRoot = path.join(cache, "emit");
    await mkdir(emitRoot, { recursive: true });
    let expanded = 0;
    for (const result of transformed.files) {
      const rel = path.relative(layout.sourceRoot, result.filename);
      const dest = path.join(emitRoot, toTsName(rel));
      await mkdir(path.dirname(dest), { recursive: true });
      if (isUnchangedPlainScript(result.filename, result.changed)) {
        await copyFile(result.filename, dest);
      } else {
        await writeFile(dest, result.code, "utf8");
        expanded++;
      }
    }

    await writePackageType(layout.projectDir, cache);
    await linkNodeModules(layout.projectDir, cache);

    const compilerOptions = { ...layout.compilerOptions };
    absolutizeProjectPaths(compilerOptions, layout.projectDir);
    compilerOptions.rootDir = "emit";
    compilerOptions.outDir = layout.outDir;
    compilerOptions.noEmit = false;
    const generated = {
      compilerOptions,
      include: ["emit/**/*.ts", "emit/**/*.tsx"],
    };
    const tempConfig = path.join(cache, "tsconfig.json");
    await writeFile(tempConfig, JSON.stringify(generated, null, 2), "utf8");

    const tscJs = resolveTscJs();
    const run = spawnSync(
      process.execPath,
      [tscJs, "-p", tempConfig, "--pretty", "false"],
      { cwd: layout.projectDir, stdio: "inherit" },
    );
    if (run.error) {
      console.error(run.error.message);
      return 1;
    }
    if (run.signal) return 1;
    const status = run.status ?? 1;
    if (status === 0) {
      const relOut = path.relative(layout.projectDir, layout.outDir) || layout.outDir;
      console.log(`sts build: ok → ${relOut} (${expanded} expanded)`);
    }
    return status;
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

export async function watchProject(projectDir: string): Promise<number> {
  let layout: ProjectLayout;
  try {
    layout = await loadProject(projectDir);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const rootStat = await stat(layout.sourceRoot).catch(() => null);
  if (!rootStat?.isDirectory()) {
    console.error(`Source root not found: ${layout.sourceRoot}`);
    return 1;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const runBuild = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const code = await buildProject(layout.projectDir);
      if (code !== 0) console.error("sts watch: rebuild failed");
    } finally {
      running = false;
      if (again) {
        again = false;
        await runBuild();
      }
    }
  };

  const schedule = (filename: string): void => {
    if (!isInputFile(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void runBuild();
    }, 100);
  };

  const watcher = watchTree(layout.sourceRoot, layout.outDir, schedule);
  await runBuild();
  const shown = path.relative(layout.projectDir, layout.sourceRoot) || ".";
  console.log(`sts watch: watching ${shown}`);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (timer) clearTimeout(timer);
      watcher.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function loadProject(projectDir: string): Promise<ProjectLayout> {
  const project = path.resolve(projectDir);
  const configPath = path.join(project, "tsconfig.json");
  if (!existsSync(configPath)) {
    throw new Error(`No tsconfig.json in ${project}`);
  }
  const compilerOptions = rawCompilerOptions(configPath);
  return {
    projectDir: project,
    configPath,
    compilerOptions,
    sourceRoot: resolveSourceRoot(project, compilerOptions),
    outDir: resolveOutDir(project, compilerOptions),
  };
}

function rawCompilerOptions(configPath: string, seen = new Set<string>()): Record<string, unknown> {
  const abs = path.resolve(configPath);
  if (seen.has(abs)) throw new Error(`tsconfig cycle: ${abs}`);
  seen.add(abs);
  const read = ts.readConfigFile(abs, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const cfg = (read.config ?? {}) as {
    extends?: string | string[];
    compilerOptions?: Record<string, unknown>;
  };
  const exts = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
  let merged: Record<string, unknown> = {};
  for (const spec of exts) {
    merged = { ...merged, ...rawCompilerOptions(resolveExtends(spec, path.dirname(abs)), seen) };
  }
  return { ...merged, ...(cfg.compilerOptions ?? {}) };
}

function resolveExtends(spec: string, fromDir: string): string {
  if (spec.startsWith(".") || path.isAbsolute(spec)) {
    const direct = path.resolve(fromDir, spec);
    if (existsSync(direct)) return direct;
    if (existsSync(`${direct}.json`)) return `${direct}.json`;
    throw new Error(`Cannot resolve tsconfig extends: ${spec}`);
  }
  const require = createRequire(path.join(fromDir, "tsconfig.json"));
  const candidates = spec.endsWith(".json")
    ? [spec]
    : [spec, `${spec}.json`, `${spec}/tsconfig.json`];
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`Cannot resolve tsconfig extends: ${spec}`);
}

function resolveSourceRoot(projectDir: string, options: Record<string, unknown>): string {
  const rootDir = options.rootDir;
  if (typeof rootDir === "string" && rootDir.length > 0) {
    return path.resolve(projectDir, rootDir);
  }
  return projectDir;
}

const PROJECT_PATH_OPTIONS = ["baseUrl", "declarationDir", "outFile", "tsBuildInfoFile"] as const;

function absolutizeProjectPaths(options: Record<string, unknown>, projectDir: string): void {
  for (const key of PROJECT_PATH_OPTIONS) {
    const value = options[key];
    if (typeof value === "string" && value.length > 0 && !path.isAbsolute(value)) {
      options[key] = path.resolve(projectDir, value);
    }
  }
  if (Array.isArray(options.rootDirs)) {
    options.rootDirs = options.rootDirs.map((entry) =>
      typeof entry === "string" && !path.isAbsolute(entry) ? path.resolve(projectDir, entry) : entry,
    );
  }
}

function resolveOutDir(projectDir: string, options: Record<string, unknown>): string {
  const outDir = options.outDir;
  if (typeof outDir === "string" && outDir.length > 0) {
    return path.resolve(projectDir, outDir);
  }
  return path.join(projectDir, "dist");
}

async function collectInputs(root: string, outDir: string): Promise<string[]> {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Source root not found: ${root}`);
  }
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDir(dir, ent.name, outDir)) continue;
        await walk(full);
      } else if (ent.isFile() && isInputFile(ent.name)) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out;
}

function skipDir(parent: string, name: string, outDir: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  return path.resolve(parent, name) === path.resolve(outDir);
}

function isInputFile(filename: string): boolean {
  const base = path.basename(filename);
  if (base.endsWith(".d.ts")) return false;
  return base.endsWith(".ts") || base.endsWith(".tsx") || base.endsWith(".sts");
}

function toTsName(filename: string): string {
  if (filename.endsWith(".sts")) return filename.slice(0, -4) + ".ts";
  return filename;
}

function isUnchangedPlainScript(filename: string, changed: boolean): boolean {
  if (changed) return false;
  return filename.endsWith(".ts") || filename.endsWith(".tsx");
}

async function writePackageType(projectDir: string, cacheDir: string): Promise<void> {
  const pkgPath = path.join(projectDir, "package.json");
  const body: { private: boolean; type?: string } = { private: true };
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { type?: unknown };
    if (pkg.type === "module" || pkg.type === "commonjs") body.type = pkg.type;
  }
  await writeFile(path.join(cacheDir, "package.json"), JSON.stringify(body), "utf8");
}

async function linkNodeModules(projectDir: string, cacheDir: string): Promise<void> {
  const found = findNodeModules(projectDir);
  if (!found) return;
  await symlink(found, path.join(cacheDir, "node_modules"), "dir");
}

function findNodeModules(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveTscJs(): string {
  const fromEnv = process.env.SOUND_TS_TSC;
  if (typeof fromEnv === "string" && fromEnv.length > 0 && existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  const require = createRequire(import.meta.url);
  return require.resolve("typescript/lib/tsc.js");
}

function watchTree(
  root: string,
  outDir: string,
  onFile: (file: string) => void,
): { close(): void } {
  const watchers: FSWatcher[] = [];
  const armed = new Set<string>();

  const arm = (dir: string): void => {
    const resolved = path.resolve(dir);
    if (armed.has(resolved)) return;
    armed.add(resolved);
    let watcher: FSWatcher;
    try {
      watcher = watch(resolved, (_event, filename) => {
        if (!filename) return;
        const full = path.resolve(resolved, filename.toString());
        void stat(full)
          .then((info) => {
            if (info.isDirectory()) {
              if (!skipDir(path.dirname(full), path.basename(full), outDir)) arm(full);
              return;
            }
            onFile(full);
          })
          .catch(() => {
            onFile(full);
          });
      });
    } catch (err) {
      console.error((err as Error).message);
      return;
    }
    watchers.push(watcher);
    void readdir(resolved, { withFileTypes: true })
      .then((ents) => {
        for (const ent of ents) {
          if (ent.isDirectory() && !skipDir(resolved, ent.name, outDir)) {
            arm(path.join(resolved, ent.name));
          }
        }
      })
      .catch(() => {});
  };

  arm(root);
  return {
    close() {
      for (const w of watchers) w.close();
    },
  };
}
