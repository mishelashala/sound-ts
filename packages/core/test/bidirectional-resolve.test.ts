import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** `.ts` imports a brand that lives in `.sts`. Specifier stays `./roles.js`. */
const appTs = `import { Account } from "./roles.js";

export function loadAdmin() {
  return Account.from("admin");
}
`;

/**
 * `.sts` imports a plain `.ts` module. Specifier stays `./app.js`.
 * `export { Account }` re-exports the expanded value and type.
 */
const rolesSts = `import { loadAdmin } from "./app.js";

brand type Account = "admin" | "regular";

export { Account };

export const admin = loadAdmin();
`;

/** Unchanged `.tsx` must be copied next to the expanded `.sts` output. */
const widgetTsx = `export const widgetName = "account";
`;

let srcDir: string;
let outDir: string;

beforeAll(() => {
  execFileSync(
    "pnpm",
    ["--filter", "@mishelashala/superset-ts-cli...", "run", "build"],
    { cwd: repoRoot, stdio: "pipe", timeout: 120_000 },
  );
}, 120_000);

afterAll(async () => {
  if (srcDir) await rm(srcDir, { recursive: true, force: true });
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

it("mirrors plain scripts so stock tsc resolves .ts ↔ .sts imports", async () => {
  expect(appTs).not.toMatch(/\.sts|\.superset/);
  expect(rolesSts).not.toMatch(/\.sts|\.superset/);

  srcDir = await mkdtemp(path.join(tmpdir(), "sts-bidi-src-"));
  outDir = await mkdtemp(path.join(tmpdir(), "sts-bidi-out-"));
  await writeFile(path.join(srcDir, "app.ts"), appTs, "utf8");
  await writeFile(path.join(srcDir, "roles.sts"), rolesSts, "utf8");
  await writeFile(path.join(srcDir, "widget.tsx"), widgetTsx, "utf8");

  execFileSync(
    process.execPath,
    [path.join(repoRoot, "packages/cli/dist/cli.js"), srcDir, "-o", outDir],
    { cwd: repoRoot, stdio: "pipe", timeout: 30_000 },
  );

  const outApp = await readFile(path.join(outDir, "app.ts"), "utf8");
  const outRoles = await readFile(path.join(outDir, "roles.ts"), "utf8");
  const outWidget = await readFile(path.join(outDir, "widget.tsx"), "utf8");

  expect(outApp).toBe(appTs);
  expect(outApp).toContain(`from "./roles.js"`);
  expect(outRoles).toContain(`from "./app.js"`);
  expect(outRoles).not.toContain("brand type");
  expect(outRoles).toContain("export { Account }");
  expect(outWidget).toBe(widgetTsx);

  execFileSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--noEmit",
      "--strict",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "esnext",
      "--pretty",
      "false",
      path.join(outDir, "app.ts"),
      path.join(outDir, "roles.ts"),
      path.join(outDir, "widget.tsx"),
    ],
    { cwd: repoRoot, stdio: "pipe", timeout: 60_000 },
  );
});
