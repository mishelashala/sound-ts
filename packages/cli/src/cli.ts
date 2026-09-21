#!/usr/bin/env node
/**
 * superset-ts / sts — expand brand type / validate type / cast<> into plain TypeScript
 * that stock tsc / Vite consume. Not a TypeScript fork.
 */
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { transformProject } from "@mishelashala/superset-ts-core";
import { mapOutputPath, resolveOutputTarget, SUPERSET_CACHE_DIR } from "./outputPath.js";

const VERSION = "0.3.2";

function usage(): string {
  return `superset-ts / sts — brand type / validate type / cast<> → plain TS + runtime companions

Usage:
  sts <input> [-o <output>]
  sts transform <input> [-o <output>]
  sts --help
  sts --version

Input may be a .ts / .tsx / .sts file or a directory (recurses *.ts, *.tsx, *.sts).
sts never emits .js. Re-running sts overwrites files in the output.

Default output is a gitignored .superset/ cache:
  - Input inside the cwd (or the cwd itself) → <cwd>/.superset/
  - Input outside the cwd → <dirname(input)>/.superset/
    (a directory is cached next to that directory; a file is cached in
    <file-dir>/.superset/<name>.ts)
Directory inputs are mirrored under the cache: .sts files expand to .ts, and
unchanged .ts / .tsx files are copied beside that output. Import specifiers
are not rewritten.
A single file roles.sts becomes .superset/roles.ts, not a sibling roles.ts.
Explicit -o overrides the cache (output file for one input, directory for a directory).

When multiple files are transformed together, brand and validate names are
collected across the whole batch so \`brand type Staff = Admin | Regular\` and
\`cast<User>(raw)\` can reference companions declared in other input files.
Point stock tsc / Vite at the **output** only.
`;
}

interface Args {
  input?: string;
  output?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, version: false };
  const rest = [...argv];
  if (rest[0] === "transform") {
    rest.shift();
  }
  while (rest.length > 0) {
    const tok = rest.shift()!;
    if (tok === "-h" || tok === "--help") {
      args.help = true;
    } else if (tok === "-v" || tok === "--version") {
      args.version = true;
    } else if (tok === "-o" || tok === "--out" || tok === "--output") {
      const next = rest.shift();
      if (!next) throw new Error("Missing value for -o");
      args.output = next;
    } else if (!tok.startsWith("-") && !args.input) {
      args.input = tok;
    } else {
      throw new Error(`Unknown argument: ${tok}`);
    }
  }
  return args;
}

function isSourceFile(file: string): boolean {
  return file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".sts");
}

/** Plain scripts stay byte-for-byte. `.sts` is expanded (even when unchanged). */
function isUnchangedPlainScript(filename: string, changed: boolean): boolean {
  if (changed) return false;
  return filename.endsWith(".ts") || filename.endsWith(".tsx");
}

async function collectFiles(input: string): Promise<string[]> {
  const s = await stat(input);
  if (s.isFile()) {
    return [input];
  }
  const out: string[] = [];
  async function walk(dir: string) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" ||
          ent.name === "dist" ||
          ent.name === ".git" ||
          ent.name === SUPERSET_CACHE_DIR
        ) {
          continue;
        }
        await walk(p);
      } else if (ent.isFile() && isSourceFile(ent.name)) {
        out.push(p);
      }
    }
  }
  await walk(input);
  return out;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (args.help || (!args.input && !args.version)) {
    console.log(usage());
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }

  const input = path.resolve(args.input!);
  const inputStat = await stat(input).catch(() => null);
  if (!inputStat) {
    console.error(`Input not found: ${input}`);
    process.exitCode = 1;
    return;
  }

  const target = resolveOutputTarget({
    input,
    isDirectory: inputStat.isDirectory(),
    cwd: process.cwd(),
    ...(args.output !== undefined ? { explicitOutput: args.output } : {}),
  });

  const files = await collectFiles(input);
  if (files.length === 0) {
    console.error("No .ts / .tsx / .sts files found.");
    process.exitCode = 1;
    return;
  }

  // Whole-program pass: read all inputs, build project brand map, then emit.
  const sources = await Promise.all(
    files.map(async (filename) => ({
      filename,
      source: await readFile(filename, "utf8"),
    })),
  );

  let project;
  try {
    project = transformProject(sources);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  let totalDecls = 0;
  let changedFiles = 0;

  if (target.kind === "file") {
    const result = project.files[0]!;
    const outFile = target.outputFile;
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, result.code, "utf8");
    totalDecls = result.decls.length + result.validateDecls.length;
    if (result.changed) changedFiles++;
    const n = result.decls.length + result.validateDecls.length;
    console.log(
      `Wrote ${path.relative(process.cwd(), outFile)} (${n} dialect decl${n === 1 ? "" : "s"})`,
    );
  } else {
    const outputRoot = target.outputRoot;
    await mkdir(outputRoot, { recursive: true });
    // Emit in dependency-first brand order grouped by file appearance in brandOrder,
    // falling back to input order for files with no brands.
    const fileByName = new Map(project.files.map((f) => [f.filename, f]));
    const emitted = new Set<string>();
    const orderedFiles: typeof project.files = [];
    for (const brandName of project.brandOrder) {
      const entry = project.brandMap.get(brandName);
      const fn = entry?.filename;
      if (fn && !emitted.has(fn)) {
        const f = fileByName.get(fn);
        if (f) {
          orderedFiles.push(f);
          emitted.add(fn);
        }
      }
    }
    for (const f of project.files) {
      if (!emitted.has(f.filename)) orderedFiles.push(f);
    }

    let mirrored = 0;
    for (const result of orderedFiles) {
      const outFile = mapOutputPath(result.filename, target.inputRoot, outputRoot);
      await mkdir(path.dirname(outFile), { recursive: true });
      // Copy unchanged .ts/.tsx so stock tsc on the output tree resolves
      // `./roles.js` (brand lives in .sts) and `./app.js` (plain .ts) as written.
      if (isUnchangedPlainScript(result.filename, result.changed)) {
        await copyFile(result.filename, outFile);
        mirrored++;
      } else {
        await writeFile(outFile, result.code, "utf8");
      }
      totalDecls += result.decls.length + result.validateDecls.length;
      if (result.changed) changedFiles++;
    }
    console.log(
      `Transformed ${files.length} file(s) → ${path.relative(process.cwd(), outputRoot)} ` +
        `(${changedFiles} changed, ${mirrored} mirrored, ${totalDecls} dialect decl${totalDecls === 1 ? "" : "s"})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
