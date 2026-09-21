import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapOutputPath, resolveOutputTarget } from "../src/outputPath.js";

describe("shadow emit output paths", () => {
  it("maps a directory input into <cwd>/.sound-ts and mirrors the tree", () => {
    const cwd = path.resolve("/proj");
    const input = path.join(cwd, "src");
    const target = resolveOutputTarget({ input, isDirectory: true, cwd });

    expect(target.kind).toBe("directory");
    if (target.kind !== "directory") return;

    expect(target.outputRoot).toBe(path.join(cwd, ".sound-ts"));
    const out = mapOutputPath(
      path.join(input, "db", "roles.sts"),
      target.inputRoot,
      target.outputRoot,
    );
    expect(out).toBe(path.join(cwd, ".sound-ts", "db", "roles.ts"));
    expect(out.endsWith(".js")).toBe(false);
  });

  it("does not map roles.sts to a sibling roles.ts", () => {
    const cwd = path.resolve("/proj");
    const input = path.join(cwd, "roles.sts");
    const target = resolveOutputTarget({ input, isDirectory: false, cwd });

    expect(target.kind).toBe("file");
    if (target.kind !== "file") return;

    expect(target.outputFile).toBe(path.join(cwd, ".sound-ts", "roles.ts"));
    expect(target.outputFile).not.toBe(path.join(cwd, "roles.ts"));
    expect(path.dirname(target.outputFile)).not.toBe(path.dirname(input));
  });

  it("places the cache next to a directory input that is outside the cwd", () => {
    const cwd = path.resolve("/work");
    const input = path.resolve("/data/app/src");
    const target = resolveOutputTarget({ input, isDirectory: true, cwd });

    expect(target.kind).toBe("directory");
    if (target.kind !== "directory") return;

    expect(target.outputRoot).toBe(path.resolve("/data/app/.sound-ts"));
    expect(
      mapOutputPath(path.join(input, "roles.sts"), target.inputRoot, target.outputRoot),
    ).toBe(path.resolve("/data/app/.sound-ts/roles.ts"));
  });

  it("writes a single file outside the cwd into that file's .sound-ts directory", () => {
    const cwd = path.resolve("/work");
    const input = path.resolve("/data/app/roles.sts");
    const target = resolveOutputTarget({ input, isDirectory: false, cwd });

    expect(target.kind).toBe("file");
    if (target.kind !== "file") return;

    expect(target.outputFile).toBe(path.resolve("/data/app/.sound-ts/roles.ts"));
    expect(target.outputFile).not.toBe(path.resolve("/data/app/roles.ts"));
  });

  it("lets explicit -o override the default cache", () => {
    const cwd = path.resolve("/proj");
    const dir = resolveOutputTarget({
      input: path.join(cwd, "src"),
      isDirectory: true,
      cwd,
      explicitOutput: "custom-out",
    });
    expect(dir.kind).toBe("directory");
    if (dir.kind === "directory") {
      expect(dir.outputRoot).toBe(path.join(cwd, "custom-out"));
    }

    const file = resolveOutputTarget({
      input: path.join(cwd, "roles.sts"),
      isDirectory: false,
      cwd,
      explicitOutput: path.join("out", "roles.ts"),
    });
    expect(file.kind).toBe("file");
    if (file.kind === "file") {
      expect(file.outputFile).toBe(path.join(cwd, "out", "roles.ts"));
    }
  });
});
