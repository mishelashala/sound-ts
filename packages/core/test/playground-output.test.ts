import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { transform } from "../src/index.js";

/** Same sample preloaded in docs/playground.html. */
const SAMPLE = `brand type Account = "admin" | "regular";

const admin = Account.from("admin");
`;

describe("playground output", () => {
  it("transform expands the nominal string-literal brand", () => {
    const { code } = transform(SAMPLE);
    expect(code).toContain("type Account");
    expect(code).not.toContain("brand type");
  });

  it("transpileModule erases the type and keeps the from companion", () => {
    const { code } = transform(SAMPLE);
    const js = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    expect(js).not.toContain("brand type");
    expect(js).not.toContain("type Account");
    expect(js).toContain("from");
  });
});
