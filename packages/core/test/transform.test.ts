import { describe, expect, it } from "vitest";
import {
  transform,
  parseBrandTypes,
  defineLiteralSet,
  LiteralSetError,
  emitBrandType,
} from "../src/index.js";

describe("parseBrandTypes", () => {
  it("parses a single brand type", () => {
    const src = `brand type Account = "admin" | "regular";`;
    const { decls } = parseBrandTypes(src);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.name).toBe("Account");
    expect(decls[0]!.values).toEqual(["admin", "regular"]);
  });

  it("parses multiple decls and single-member unions", () => {
    const src = `
brand type Status = "ok";
brand type Role = "a" | "b" | "c";
`;
    const { decls } = parseBrandTypes(src);
    expect(decls.map((d) => d.name)).toEqual(["Status", "Role"]);
    expect(decls[0]!.values).toEqual(["ok"]);
    expect(decls[1]!.values).toEqual(["a", "b", "c"]);
  });

  it("rejects duplicate literals", () => {
    expect(() =>
      parseBrandTypes(`brand type Bad = "a" | "a";`),
    ).toThrow(/duplicate/);
  });
});

describe("transform", () => {
  it("expands brand type into type + runtime companion", () => {
    const src = `brand type Account = "admin" | "regular";\n`;
    const result = transform(src);
    expect(result.changed).toBe(true);
    expect(result.decls).toHaveLength(1);
    expect(result.code).toContain(`type Account = "admin" | "regular";`);
    expect(result.code).toContain(`const Account =`);
    expect(result.code).toContain(`function is(value: unknown): value is Account`);
    expect(result.code).toContain(`function from(value: unknown): Account`);
    expect(result.code).not.toContain("brand type");
  });

  it("leaves source unchanged when no brand type present", () => {
    const src = `export type X = string;\n`;
    const result = transform(src);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(src);
  });

  it("preserves surrounding code", () => {
    const src = `import { foo } from "./foo.js";\n\nbrand type Account = "admin" | "regular";\n\nexport function greet(a: Account) {\n  return a;\n}\n`;
    const result = transform(src);
    expect(result.code).toContain(`import { foo } from "./foo.js";`);
    expect(result.code).toContain(`export function greet(a: Account)`);
    expect(result.code).toContain(`type Account = "admin" | "regular";`);
    expect(result.code).not.toContain("brand type");
  });

  it("can emit via internal defineLiteralSet helper", () => {
    const src = `brand type Account = "admin" | "regular";`;
    const result = transform(src, { useInternalHelper: true });
    expect(result.code).toContain(
      `const Account = defineLiteralSet("Account", ["admin", "regular"] as const);`,
    );
    expect(result.code).toContain(`type Account = "admin" | "regular";`);
  });

  it("emitted companion shape matches defineLiteralSet runtime", () => {
    const src = `brand type Account = "admin" | "regular";`;
    const { decls, code } = transform(src);
    expect(decls[0]!.values).toEqual(["admin", "regular"]);
    expect(code).toMatch(/name:\s*"Account"/);
    expect(code).toMatch(/values:\s*__values/);
    expect(code).toMatch(/\bis,/);
    expect(code).toMatch(/\bfrom,/);

    // Runtime behavior is defined by the internal companion builder
    // (same shape the self-contained emit implements).
    const Account = defineLiteralSet("Account", ["admin", "regular"] as const);
    expect(Account.name).toBe("Account");
    expect([...Account.values]).toEqual(["admin", "regular"]);
    expect(Account.is("admin")).toBe(true);
    expect(Account.is("guest")).toBe(false);
    expect(Account.from("regular")).toBe("regular");
    expect(() => Account.from("guest")).toThrow(LiteralSetError);
  });

  it("emitBrandType produces standalone block", () => {
    const block = emitBrandType({
      name: "Color",
      values: ["red", "blue"],
      raw: "",
      start: 0,
      end: 0,
    });
    expect(block).toContain(`type Color = "red" | "blue";`);
    expect(block).toContain("Object.freeze");
  });
});

describe("defineLiteralSet (internal)", () => {
  it("still builds the companion shape used as emit target", () => {
    const Account = defineLiteralSet("Account", ["admin", "regular"] as const);
    expect(Account.from("admin")).toBe("admin");
    expect(Account.is("guest")).toBe(false);
    expect(() => Account.from("x")).toThrow(LiteralSetError);
  });
});
