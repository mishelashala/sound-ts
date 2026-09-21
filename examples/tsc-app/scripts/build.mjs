import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBin(envValue, relativePath) {
  if (envValue && existsSync(envValue)) return path.resolve(envValue);
  return path.resolve(appRoot, relativePath);
}

const cli = resolveBin(
  process.env.SOUND_TS_CLI,
  "../../packages/cli/dist/cli.js",
);
const tsc = resolveBin(
  process.env.SOUND_TS_TSC,
  "../../node_modules/typescript/lib/tsc.js",
);

function run(bin, args) {
  if (!existsSync(bin)) {
    console.error(`Missing ${bin}`);
    return 1;
  }
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: appRoot,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  if (result.signal) return 1;
  return result.status ?? 1;
}

const expandStatus = run(cli, [
  path.join(appRoot, "src"),
  "-o",
  path.join(appRoot, ".sound-ts"),
]);
if (expandStatus !== 0) {
  process.exit(expandStatus);
}

process.exit(run(tsc, ["-p", path.join(appRoot, "tsconfig.json")]));
