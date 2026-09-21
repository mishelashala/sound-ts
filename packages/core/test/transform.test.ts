import { describe, expect, it } from "vitest";
import {
  transform,
  parseBrandTypes,
  defineLiteralSet,
  LiteralSetError,
  emitBrandType,
} from "../src/index.js";

describe("parseBrandTypes (Mode A literals)", () => {
  it("parses a single brand type", () => {
    const src = `brand type Account = "admin" | "regular";`;
    const { decls } = parseBrandTypes(src);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe("literal");
    expect(decls[0]!.name).toBe("Account");
    if (decls[0]!.kind === "literal") {
      expect(decls[0]!.values).toEqual(["admin", "regular"]);
    }
  });

  it("parses multiple decls and single-member unions", () => {
    const src = `
brand type Status = "ok";
brand type Role = "a" | "b" | "c";
`;
    const { decls } = parseBrandTypes(src);
    expect(decls.map((d) => d.name)).toEqual(["Status", "Role"]);
    expect(decls[0]!.kind).toBe("literal");
    if (decls[0]!.kind === "literal") {
      expect(decls[0]!.values).toEqual(["ok"]);
    }
    if (decls[1]!.kind === "literal") {
      expect(decls[1]!.values).toEqual(["a", "b", "c"]);
    }
  });

  it("rejects duplicate literals", () => {
    expect(() =>
      parseBrandTypes(`brand type Bad = "a" | "a";`),
    ).toThrow(/duplicate/);
  });
});

describe("parseBrandTypes (Mode B refined)", () => {
  it("parses refined brand with custom is", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
`;
    const { decls } = parseBrandTypes(src);
    expect(decls).toHaveLength(1);
    const d = decls[0]!;
    expect(d.kind).toBe("refined");
    expect(d.name).toBe("PositiveInt");
    if (d.kind === "refined") {
      expect(d.baseType).toBe("number");
      expect(d.isParamName).toBe("n");
      expect(d.isParamType).toBe("number");
      expect(d.isBody).toContain("Number.isInteger(n) && n > 0");
    }
  });

  it("rejects Mode B with wrong type predicate name", () => {
    expect(() =>
      parseBrandTypes(`
brand type PositiveInt = number {
  is(n: number): n is Other {
    return n > 0;
  }
}
`),
    ).toThrow(/refine 'PositiveInt'/);
  });
});

describe("parseBrandTypes (brand unions / intersections)", () => {
  it("parses union of already-declared brands", () => {
    const src = `
brand type Admin = "admin";
brand type Regular = "regular";
brand type Staff = Admin | Regular;
`;
    const { decls } = parseBrandTypes(src);
    expect(decls).toHaveLength(3);
    expect(decls[2]!.kind).toBe("union");
    if (decls[2]!.kind === "union") {
      expect(decls[2]!.members).toEqual(["Admin", "Regular"]);
    }
  });

  it("parses intersection of already-declared brands", () => {
    const src = `
brand type User = "u";
brand type Session = "s";
brand type Authed = User & Session;
`;
    const { decls } = parseBrandTypes(src);
    expect(decls[2]!.kind).toBe("intersection");
    if (decls[2]!.kind === "intersection") {
      expect(decls[2]!.members).toEqual(["User", "Session"]);
    }
  });

  it("rejects non-brand members in union", () => {
    expect(() =>
      parseBrandTypes(`brand type Bad = Admin | Regular;`),
    ).toThrow(/not an already-declared brand name/);
  });

  it("rejects open string in brand union", () => {
    expect(() =>
      parseBrandTypes(`
brand type Admin = "admin";
brand type Bad = Admin | string;
`),
    ).toThrow(/'string' is not an already-declared brand name/);
  });

  it("rejects mixing | and &", () => {
    expect(() =>
      parseBrandTypes(`
brand type A = "a";
brand type B = "b";
brand type C = "c";
brand type Bad = A | B & C;
`),
    ).toThrow(/cannot mix/);
  });

  it("rejects forward reference (not already declared)", () => {
    expect(() =>
      parseBrandTypes(`
brand type Staff = Admin | Regular;
brand type Admin = "admin";
brand type Regular = "regular";
`),
    ).toThrow(/not an already-declared brand name/);
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
    expect(decls[0]!.kind).toBe("literal");
    if (decls[0]!.kind === "literal") {
      expect(decls[0]!.values).toEqual(["admin", "regular"]);
    }
    expect(code).toMatch(/name:\s*"Account"/);
    expect(code).toMatch(/values:\s*__values/);
    expect(code).toMatch(/\bis,/);
    expect(code).toMatch(/\bfrom,/);

    const Account = defineLiteralSet("Account", ["admin", "regular"] as const);
    expect(Account.name).toBe("Account");
    expect([...Account.values]).toEqual(["admin", "regular"]);
    expect(Account.is("admin")).toBe(true);
    expect(Account.is("guest")).toBe(false);
    expect(Account.from("regular")).toBe("regular");
    expect(() => Account.from("guest")).toThrow(LiteralSetError);
  });

  it("emitBrandType produces standalone block for literals", () => {
    const block = emitBrandType({
      kind: "literal",
      name: "Color",
      values: ["red", "blue"],
      raw: "",
      start: 0,
      end: 0,
    });
    expect(block).toContain(`type Color = "red" | "blue";`);
    expect(block).toContain("Object.freeze");
  });

  it("Mode B emits type alias + user is + generated from", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toContain(`type PositiveInt = number;`);
    expect(code).toContain(`function is(n: number): n is PositiveInt`);
    expect(code).toContain(`Number.isInteger(n) && n > 0`);
    expect(code).toContain(`function from(value: unknown): PositiveInt`);
    expect(code).toContain(`if (is(value as number)) return value as PositiveInt;`);
    expect(code).not.toContain("brand type");
    expect(code).not.toMatch(/values:/);
  });

  it("union emits type alias + delegated is/from", () => {
    const src = `
brand type Admin = "admin";
brand type Regular = "regular";
brand type Staff = Admin | Regular;
`;
    const { code } = transform(src);
    expect(code).toContain(`type Staff = Admin | Regular;`);
    expect(code).toContain(`return Admin.is(value) || Regular.is(value);`);
    expect(code).toContain(`function from(value: unknown): Staff`);
    expect(code).not.toContain("brand type");
  });

  it("intersection emits && delegation", () => {
    const src = `
brand type User = "u";
brand type Session = "s";
brand type Authed = User & Session;
`;
    const { code } = transform(src);
    expect(code).toContain(`type Authed = User & Session;`);
    expect(code).toContain(`return User.is(value) && Session.is(value);`);
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
