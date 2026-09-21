#!/usr/bin/env node
/**
 * superset-ts / sts — expand `brand type` dialect into plain TypeScript
 * that stock tsc / Vite consume. Not a TypeScript fork.
 */
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { transformProject } from "@mishelashala/superset-ts-core";

const VERSION = "0.3.2";

function usage(): string {
  return `superset-ts / sts — brand type → plain TS + runtime companions

Usage:
  sts <input> [-o <output>]
  sts transform <input> [-o <output>]
  sts --help
  sts --version

Input may be a .ts / .sts file or a directory (recurses *.ts, *.sts).
Output defaults to <input> with .sts → .ts, or <dir>.out/ for directories.

When multiple files are transformed together, brand names are collected across
the whole batch so \`brand type Staff = Admin | Regular\` can reference brands
declared in other input files. Point stock tsc / Vite at the **output** only.
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
  return file.endsWith(".ts") || file.endsWith(".sts");
}

function mapOutputPath(inputPath: string, inputRoot: string, outputRoot: string): string {
  const rel = path.relative(inputRoot, inputPath);
  const mapped = rel.endsWith(".sts") ? rel.slice(0, -4) + ".ts" : rel;
  return path.join(outputRoot, mapped);
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
        if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") {
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

  let outputRoot: string;
  if (args.output) {
    outputRoot = path.resolve(args.output);
  } else if (inputStat.isDirectory()) {
    outputRoot = input + ".out";
  } else {
    // single file: default beside input, .sts → .ts, else overwrite caution → .gen.ts
    if (input.endsWith(".sts")) {
      outputRoot = input.slice(0, -4) + ".ts";
    } else {
      const dir = path.dirname(input);
      const base = path.basename(input, path.extname(input));
      outputRoot = path.join(dir, base + ".gen.ts");
    }
  }

  const files = await collectFiles(input);
  if (files.length === 0) {
    console.error("No .ts / .sts files found.");
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

  if (inputStat.isFile()) {
    const result = project.files[0]!;
    const outFile = outputRoot;
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, result.code, "utf8");
    totalDecls = result.decls.length;
    if (result.changed) changedFiles++;
    console.log(
      `Wrote ${path.relative(process.cwd(), outFile)} (${result.decls.length} brand type${result.decls.length === 1 ? "" : "s"})`,
    );
  } else {
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

    for (const result of orderedFiles) {
      const outFile = mapOutputPath(result.filename, input, outputRoot);
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(outFile, result.code, "utf8");
      totalDecls += result.decls.length;
      if (result.changed) changedFiles++;
    }
    console.log(
      `Transformed ${files.length} file(s) → ${path.relative(process.cwd(), outputRoot)} ` +
        `(${changedFiles} changed, ${totalDecls} brand type${totalDecls === 1 ? "" : "s"})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
