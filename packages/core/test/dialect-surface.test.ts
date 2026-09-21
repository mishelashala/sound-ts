import { describe, expect, it } from "vitest";
import { transform, transformProject, isDialectSurface } from "../src/index.js";

describe("isDialectSurface", () => {
  it("treats .sts and stdin as dialect", () => {
    expect(isDialectSurface("roles.sts")).toBe(true);
    expect(isDialectSurface("Roles.STS")).toBe(true);
    expect(isDialectSurface(undefined)).toBe(true);
    expect(isDialectSurface("<stdin>")).toBe(true);
  });

  it("treats plain TypeScript as non-dialect", () => {
    expect(isDialectSurface("app.ts")).toBe(false);
    expect(isDialectSurface("app.tsx")).toBe(false);
  });
});

describe("plain .ts passthrough (gradual adoption)", () => {
  it("does not reject as / any / methods on mirrored .ts", () => {
    const source = `
export function f(x: any): string {
  return (x as string).toUpperCase();
}
export class C {
  method(n: number): number { return n; }
}
`;
    const result = transform(source, { filename: "legacy.ts" });
    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
  });

  it("transformProject mirrors .ts and expands .sts", () => {
    const legacy = `export const x = 1 as any;\n`;
    const dialect = `brand type Env = "sandbox" | "production";\n`;
    const project = transformProject([
      { filename: "legacy.ts", source: legacy },
      { filename: "env.sts", source: dialect },
    ]);
    const plain = project.files.find((f) => f.filename === "legacy.ts")!;
    const sts = project.files.find((f) => f.filename === "env.sts")!;
    expect(plain.changed).toBe(false);
    expect(plain.code).toBe(legacy);
    expect(sts.changed).toBe(true);
    expect(sts.code).toContain("EnvBrand");
    expect(sts.code).toContain("sandbox");
  });

  it("preserves export on brand type and companion", () => {
    const result = transform(
      `export brand type Env = "sandbox" | "production";\n`,
      { filename: "env.sts" },
    );
    expect(result.code).toContain("export type Env =");
    expect(result.code).toContain("export const Env =");
    expect(result.code).not.toMatch(/export declare const EnvBrand/);
  });
});
