import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(fixture, "../..");
const cli = path.join(repoRoot, "packages/cli/dist/cli.js");

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

async function copyApp(dir) {
  await cp(path.join(fixture, "src"), path.join(dir, "src"), { recursive: true });
  await cp(path.join(fixture, "package.json"), path.join(dir, "package.json"));
  await cp(path.join(fixture, "tsconfig.json"), path.join(dir, "tsconfig.json"));
}

function cliEnv() {
  return {
    ...process.env,
    SOUND_TS_CLI: cli,
  };
}

test("sts build emits dist js and does not write .sound-ts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sts-tsc-app-"));
  try {
    await copyApp(dir);
    const result = await run(process.execPath, [cli, "build"], {
      cwd: dir,
      env: cliEnv(),
    });
    assert.equal(result.status, 0, result.stderr);
    await access(path.join(dir, "dist", "app.js"));
    await access(path.join(dir, "dist", "roles.js"));
    await assert.rejects(access(path.join(dir, ".sound-ts")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("broken .sts fails sts build before js is emitted", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sts-tsc-app-"));
  try {
    await copyApp(dir);

    const stsPath = path.join(dir, "src", "roles.sts");
    const original = await readFile(stsPath, "utf8");
    assert.match(original, /brand type Account = "admin" \| "regular"/);
    await writeFile(stsPath, 'brand type Account = "admin" | "admin";\n', "utf8");

    const result = await run(process.execPath, [cli, "build"], {
      cwd: dir,
      env: cliEnv(),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate/);
    await assert.rejects(access(path.join(dir, "dist", "app.js")));
    await assert.rejects(access(path.join(dir, "dist", "roles.js")));
    await assert.rejects(access(path.join(dir, ".sound-ts", "roles.ts")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sts watch rebuilds when an .sts input changes", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sts-tsc-app-"));
  await copyApp(dir);
  const child = spawn(process.execPath, [cli, "watch"], {
    cwd: dir,
    env: cliEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  try {
    await waitFor(() => stdout.includes("sts watch: watching"), () => stderr);
    const before = stdout.split("sts build: ok").length;
    await writeFile(
      path.join(dir, "src", "roles.sts"),
      'brand type Account = "admin" | "regular";\n\nexport { Account };\nexport const marker = 1;\n',
      "utf8",
    );
    await waitFor(() => stdout.split("sts build: ok").length > before, () => stderr);
    const built = await readFile(path.join(dir, "dist", "roles.js"), "utf8");
    assert.match(built, /marker/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

function waitFor(pred, stderr) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) {
        resolve();
        return;
      }
      if (Date.now() - start > 20_000) {
        reject(new Error(`timed out\nstdout so far\nstderr: ${stderr()}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
