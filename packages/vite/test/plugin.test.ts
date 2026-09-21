import { describe, expect, it } from "vitest";
import { supersetTs } from "../src/index.js";

async function runTransform(code: string, id: string): Promise<string> {
  const plugin = supersetTs();
  const hook = plugin.transform;
  if (typeof hook !== "function") {
    throw new Error("supersetTs transform hook must be a function");
  }
  const result = await hook.call({} as never, code, id);
  if (typeof result === "string") return result;
  return result?.code ?? "";
}

describe("supersetTs", () => {
  it("expands brand type to plain TypeScript", async () => {
    const code = await runTransform(
      `brand type Account = "admin" | "regular";`,
      "roles.sts",
    );
    expect(code).toContain("type Account");
    expect(code).not.toContain("brand type");
  });

  it("rejects invalid dialect", async () => {
    await expect(
      runTransform(`brand type Bad = "a" | "a";`, "bad.sts"),
    ).rejects.toThrow();
  });
});
