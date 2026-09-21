import { describe, expect, it } from "vitest";
import { parseSts } from "../src/ast/index.js";

describe("parseSts dialect side-table", () => {
  it("collects brand, validate, and cast as first-class nodes with spans", () => {
    const src = `
brand type Account = "admin" | "regular";
validate type User = { id: string };
const a = cast<Account>(raw);
`;
    const program = parseSts(src);
    expect(program.brands).toHaveLength(1);
    expect(program.brands[0]!.kind).toBe("literal");
    expect(program.brands[0]!.name).toBe("Account");
    expect(src.slice(program.brands[0]!.start, program.brands[0]!.end)).toContain(
      "brand type Account",
    );

    expect(program.validates).toHaveLength(1);
    expect(program.validates[0]!.name).toBe("User");
    expect(src.slice(program.validates[0]!.start, program.validates[0]!.end)).toContain(
      "validate type User",
    );

    expect(program.casts).toHaveLength(1);
    expect(program.casts[0]!.target).toBe("Account");
    expect(program.casts[0]!.expr).toBe("raw");
    expect(src.slice(program.casts[0]!.start, program.casts[0]!.end)).toBe(
      "cast<Account>(raw)",
    );
  });

  it("ignores dialect keywords inside strings and comments", () => {
    const src = `
// brand type Ghost = "nope";
const s = "validate type Ghost = { x: string }";
brand type Live = "yes";
`;
    const program = parseSts(src);
    expect(program.brands.map((b) => b.name)).toEqual(["Live"]);
    expect(program.validates).toHaveLength(0);
  });

  it("accepts leading-pipe multiline literal unions", () => {
    const src = `
export brand type Env =
  | "sandbox"
  | "production";
`;
    const program = parseSts(src);
    expect(program.brands).toHaveLength(1);
    const brand = program.brands[0]!;
    expect(brand.kind).toBe("literal");
    if (brand.kind === "literal") {
      expect(brand.values).toEqual(["sandbox", "production"]);
    }
    expect(brand.exported).toBe(true);
  });

  it("parses number literal unions including negatives", () => {
    const src = `
export brand type Days = 7 | 30 | 90;
brand type Offset = | -1 | 0 | 1;
`;
    const program = parseSts(src);
    const days = program.brands[0]!;
    const offset = program.brands[1]!;
    expect(days.kind).toBe("literal");
    expect(offset.kind).toBe("literal");
    if (days.kind === "literal") {
      expect(days.primitive).toBe("number");
      expect(days.values).toEqual([7, 30, 90]);
    }
    if (offset.kind === "literal") {
      expect(offset.values).toEqual([-1, 0, 1]);
    }
  });
});
