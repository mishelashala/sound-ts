import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(fixture, "../..");

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

test("broken .sts fails the build before tsc emits js", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sts-tsc-app-"));
  try {
    await cp(path.join(fixture, "src"), path.join(dir, "src"), { recursive: true });
    await cp(path.join(fixture, "scripts"), path.join(dir, "scripts"), { recursive: true });
    await cp(path.join(fixture, "package.json"), path.join(dir, "package.json"));
    await cp(path.join(fixture, "tsconfig.json"), path.join(dir, "tsconfig.json"));

    const stsPath = path.join(dir, "src", "roles.sts");
    const original = await readFile(stsPath, "utf8");
    assert.match(original, /brand type Account = "admin" \| "regular"/);
    await writeFile(stsPath, 'brand type Account = "admin" | "admin";\n', "utf8");

    const result = await run(process.execPath, [path.join(dir, "scripts", "build.mjs")], {
      cwd: dir,
      env: {
        ...process.env,
        SUPERSET_TS_CLI: path.join(repoRoot, "packages/cli/dist/cli.js"),
        SUPERSET_TS_TSC: path.join(repoRoot, "node_modules/typescript/lib/tsc.js"),
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate/);
    await assert.rejects(access(path.join(dir, "dist", "app.js")));
    await assert.rejects(access(path.join(dir, "dist", "roles.js")));
    await assert.rejects(access(path.join(dir, ".superset", "roles.ts")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
