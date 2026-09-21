import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  transform,
  transformProject,
  parseBrandTypes,
  parseValidateTypes,
  defineLiteralSet,
  LiteralSetError,
  emitBrandType,
  buildBrandMap,
  resolveBrandRefs,
} from "../src/index.js";

/** Compile a snippet with stock tsc; return formatted diagnostic messages. */
function typecheckOk(source: string): string[] {
  const file = "snippet.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError) => {
    if (name === file) {
      return ts.createSourceFile(file, source, languageVersion, true);
    }
    return orig(name, languageVersion, onError);
  };
  host.writeFile = () => {};
  const program = ts.createProgram([file], options, host);
  const diags = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];
  return diags.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  );
}

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
  it("parses union of brand names (resolution deferred)", () => {
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

  it("parses intersection of brand names", () => {
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

  it("parses forward references within a file (resolved later)", () => {
    const src = `
brand type Staff = Admin | Regular;
brand type Admin = "admin";
brand type Regular = "regular";
`;
    const { decls } = parseBrandTypes(src);
    expect(decls[0]!.kind).toBe("union");
    if (decls[0]!.kind === "union") {
      expect(decls[0]!.members).toEqual(["Admin", "Regular"]);
    }
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
});

describe("brand map resolution", () => {
  it("rejects unknown brand members at transform time", () => {
    expect(() => transform(`brand type Bad = Admin | Regular;`)).toThrow(
      /not a known brand name/,
    );
  });

  it("rejects open string in brand union", () => {
    expect(() =>
      transform(`
brand type Admin = "admin";
brand type Bad = Admin | string;
`),
    ).toThrow(/'string' is not a known brand name/);
  });

  it("allows forward reference within a single file", () => {
    const { code, changed } = transform(`
brand type Staff = Admin | Regular;
brand type Admin = "admin";
brand type Regular = "regular";
`);
    expect(changed).toBe(true);
    expect(code).toContain(`type Staff = Admin | Regular;`);
    expect(code).toContain(`return Admin.is(value) || Regular.is(value);`);
  });

  it("detects cycles among combined brands", () => {
    expect(() =>
      transform(`
brand type A = B | C;
brand type B = A | C;
brand type C = "c";
`),
    ).toThrow(/brand type cycle detected/);
  });

  it("detects self-referential cycles", () => {
    expect(() =>
      transform(`
brand type A = "a";
brand type Bad = Bad | A;
`),
    ).toThrow(/brand type cycle detected/);
  });

  it("rejects duplicate brand names in the project map", () => {
    const a = parseBrandTypes(`brand type Admin = "admin";`).decls;
    const b = parseBrandTypes(`brand type Admin = "other";`).decls;
    expect(() =>
      buildBrandMap([
        { filename: "a.sts", decls: a },
        { filename: "b.sts", decls: b },
      ]),
    ).toThrow(/duplicate declaration/);
  });
});

describe("transformProject (cross-file brand refs)", () => {
  it("resolves union members declared in another file", () => {
    const result = transformProject([
      {
        filename: "a.sts",
        source: `
brand type Admin = "admin";
brand type Regular = "regular";

export { Admin, Regular };
`,
      },
      {
        filename: "b.sts",
        source: `
import { Admin, Regular } from "./a.js";

brand type Staff = Admin | Regular;
`,
      },
    ]);

    expect(result.brandMap.has("Admin")).toBe(true);
    expect(result.brandMap.has("Regular")).toBe(true);
    expect(result.brandMap.has("Staff")).toBe(true);

    const b = result.files.find((f) => f.filename === "b.sts")!;
    expect(b.changed).toBe(true);
    expect(b.code).toContain(`type Staff = Admin | Regular;`);
    expect(b.code).toContain(`return Admin.is(value) || Regular.is(value);`);
    expect(b.code).not.toContain("brand type");

    const a = result.files.find((f) => f.filename === "a.sts")!;
    expect(a.code).toContain(`type Admin = "admin";`);
    expect(a.code).toContain(`export { Admin, Regular };`);
  });

  it("resolves intersection members across files", () => {
    const result = transformProject([
      {
        filename: "ids.sts",
        source: `
brand type User = "u";
brand type Session = "s";
export { User, Session };
`,
      },
      {
        filename: "authed.sts",
        source: `
import { User, Session } from "./ids.js";
brand type Authed = User & Session;
`,
      },
    ]);
    const authed = result.files.find((f) => f.filename === "authed.sts")!;
    expect(authed.code).toContain(`type Authed = User & Session;`);
    expect(authed.code).toContain(
      `return User.is(value) && Session.is(value);`,
    );
  });

  it("errors on unknown brand across the project batch", () => {
    expect(() =>
      transformProject([
        {
          filename: "a.sts",
          source: `brand type Admin = "admin";\n`,
        },
        {
          filename: "b.sts",
          source: `brand type Staff = Admin | Missing;\n`,
        },
      ]),
    ).toThrow(/'Missing' is not a known brand name/);
  });

  it("errors on cross-file cycles", () => {
    expect(() =>
      transformProject([
        {
          filename: "a.sts",
          source: `
brand type A = B | C;
brand type C = "c";
`,
        },
        {
          filename: "b.sts",
          source: `brand type B = A | C;\n`,
        },
      ]),
    ).toThrow(/brand type cycle detected/);
  });

  it("orders brands dependencies-first", () => {
    const result = transformProject([
      {
        filename: "b.sts",
        source: `brand type Staff = Admin | Regular;\n`,
      },
      {
        filename: "a.sts",
        source: `
brand type Admin = "admin";
brand type Regular = "regular";
`,
      },
    ]);
    const adminIdx = result.brandOrder.indexOf("Admin");
    const regularIdx = result.brandOrder.indexOf("Regular");
    const staffIdx = result.brandOrder.indexOf("Staff");
    expect(adminIdx).toBeGreaterThanOrEqual(0);
    expect(regularIdx).toBeGreaterThanOrEqual(0);
    expect(staffIdx).toBeGreaterThan(adminIdx);
    expect(staffIdx).toBeGreaterThan(regularIdx);
  });

  it("resolveBrandRefs alone rejects unknown members", () => {
    const decls = parseBrandTypes(`brand type Bad = Ghost;`).decls;
    const map = buildBrandMap([{ filename: "x.sts", decls }]);
    expect(() => resolveBrandRefs(map)).toThrow(/not a known brand name/);
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

  it("Mode B emits phantom unique-symbol brand + user is + generated from", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toContain(`declare const PositiveIntBrand: unique symbol;`);
    expect(code).toContain(
      `type PositiveInt = number & { readonly [PositiveIntBrand]: true };`,
    );
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

describe("comment / string safe scan", () => {
  it("ignores brand type inside // line comment", () => {
    const src = `// brand type Ghost = "nope";
brand type Live = "yes";
`;
    const { decls } = parseBrandTypes(src);
    expect(decls.map((d) => d.name)).toEqual(["Live"]);
  });

  it("ignores brand type inside /* block comment */", () => {
    const src = `/* brand type Ghost = "nope"; */
brand type Live = "yes";
`;
    const { decls } = parseBrandTypes(src);
    expect(decls.map((d) => d.name)).toEqual(["Live"]);
  });

  it("still expands a live decl after a comment", () => {
    const src = `// note
brand type Account = "admin" | "regular";
`;
    const result = transform(src);
    expect(result.changed).toBe(true);
    expect(result.decls).toHaveLength(1);
    expect(result.code).toContain(`type Account = "admin" | "regular";`);
    expect(result.code).toContain("// note");
    expect(result.code).not.toContain("brand type");
  });

  it("leaves a string containing brand type Foo = ... unchanged", () => {
    const src = `const s = "brand type Foo = \\"x\\"";
`;
    const result = transform(src);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(src);
    expect(parseBrandTypes(src).decls).toHaveLength(0);
  });

  it("ignores brand type inside a template literal", () => {
    const src =
      "const s = `brand type Foo = \"x\"`;\nbrand type Live = \"yes\";\n";
    const { decls } = parseBrandTypes(src);
    expect(decls.map((d) => d.name)).toEqual(["Live"]);
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

describe("validate type", () => {
  it("parses object type with primitive fields", () => {
    const src = `validate type User = { id: string; age: number };`;
    const { decls } = parseValidateTypes(src);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.name).toBe("User");
    expect(decls[0]!.fields).toEqual([
      {
        name: "id",
        optional: false,
        type: { members: [{ kind: "primitive", name: "string" }] },
      },
      {
        name: "age",
        optional: false,
        type: { members: [{ kind: "primitive", name: "number" }] },
      },
    ]);
  });

  it("parses optional, arrays, and unions", () => {
    const src = `
validate type Flags = {
  active?: boolean;
  tags: string[];
  id: string | number;
};
`;
    const { decls } = parseValidateTypes(src);
    expect(decls[0]!.fields.map((f) => f.name)).toEqual([
      "active",
      "tags",
      "id",
    ]);
    expect(decls[0]!.fields[0]!.optional).toBe(true);
    expect(decls[0]!.fields[1]!.type.members[0]).toEqual({
      kind: "array",
      element: "string",
    });
    expect(decls[0]!.fields[2]!.type.members).toEqual([
      { kind: "primitive", name: "string" },
      { kind: "primitive", name: "number" },
    ]);
  });

  it("emits phantom unique-symbol brand + is/from companion", () => {
    const src = `validate type User = { id: string; age: number };\n`;
    const result = transform(src);
    expect(result.changed).toBe(true);
    expect(result.validateDecls).toHaveLength(1);
    expect(result.code).toContain(`declare const UserBrand: unique symbol;`);
    expect(result.code).toContain(`type User = {`);
    expect(result.code).toContain(`id: string;`);
    expect(result.code).toContain(`age: number;`);
    expect(result.code).toContain(`} & { readonly [UserBrand]: true };`);
    expect(result.code).toContain(`const User =`);
    expect(result.code).toContain(`function is(value: unknown): value is User`);
    expect(result.code).toContain(`function from(value: unknown): User`);
    expect(result.code).toContain(`if (is(value)) return value as User;`);
    expect(result.code).toContain(`typeof v.id === "string"`);
    expect(result.code).toContain(`typeof v.age === "number"`);
    expect(result.code).not.toContain("validate type");
  });

  it("rejects nested object field types", () => {
    expect(() =>
      parseValidateTypes(
        `validate type Bad = { nested: { x: string } };`,
      ),
    ).toThrow(/unsupported field type/);
  });

  it("rejects Date and other non-primitive idents", () => {
    expect(() =>
      parseValidateTypes(`validate type Bad = { when: Date };`),
    ).toThrow(/unsupported field type 'Date'/);
  });

  it("rejects non-object top-level types", () => {
    expect(() =>
      parseValidateTypes(`validate type Bad = string;`),
    ).toThrow(/requires an object type/);
  });

  it("rejects generics on field types", () => {
    expect(() =>
      parseValidateTypes(`validate type Bad = { xs: Array<string> };`),
    ).toThrow(/unsupported field type/);
  });
});

describe("checked casts (cast<>)", () => {
  it("rewrites cast<number> to inline typeof check", () => {
    const src = `const n = cast<number>(raw);\n`;
    const result = transform(src);
    expect(result.changed).toBe(true);
    expect(result.code).not.toContain("cast<");
    expect(result.code).toContain(`typeof __v === "number"`);
    expect(result.code).toContain(`Checked cast to number failed`);
    expect(result.code).toContain("(raw)");
  });

  it("rewrites cast<string> and cast<boolean>", () => {
    const src = `
const s = cast<string>(raw);
const b = cast<boolean>(flag);
`;
    const { code } = transform(src);
    expect(code).toContain(`typeof __v === "string"`);
    expect(code).toContain(`typeof __v === "boolean"`);
    expect(code).not.toContain("cast<");
  });

  it("delegates cast<User> to User.from when validate companion exists", () => {
    const src = `
validate type User = { id: string; age: number };
const u = cast<User>(raw);
`;
    const { code } = transform(src);
    expect(code).toContain(`User.from(raw)`);
    expect(code).not.toContain("cast<");
    expect(code).toContain(`const User =`);
  });

  it("delegates cast<Account> to brand companion .from", () => {
    const src = `
brand type Account = "admin" | "regular";
const a = cast<Account>(raw);
`;
    const { code } = transform(src);
    expect(code).toContain(`Account.from(raw)`);
    expect(code).not.toContain("cast<");
  });

  it("errors on unknown cast target", () => {
    expect(() => transform(`const x = cast<Ghost>(raw);\n`)).toThrow(
      /not a primitive or known companion/,
    );
  });

  it("resolves cast<User> across multi-file batch", () => {
    const result = transformProject([
      {
        filename: "user.sts",
        source: `validate type User = { id: string; age: number };\nexport { User };\n`,
      },
      {
        filename: "main.sts",
        source: `
import { User } from "./user.js";
const u = cast<User>(raw);
`,
      },
    ]);
    const main = result.files.find((f) => f.filename === "main.sts")!;
    expect(main.changed).toBe(true);
    expect(main.code).toContain(`User.from(raw)`);
    expect(main.code).not.toContain("cast<");
    expect(result.companionNames.has("User")).toBe(true);
  });

  it("ignores cast inside comments and strings", () => {
    const src = `
// const x = cast<number>(raw);
const s = "cast<number>(raw)";
const n = cast<number>(raw);
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toContain(`// const x = cast<number>(raw);`);
    expect(code).toContain(`"cast<number>(raw)"`);
    expect(code.match(/Checked cast to number failed/g)?.length).toBe(1);
  });
});

describe("phantom brands under stock tsc", () => {
  it("string-literal brands still emit closed unions (no unique symbol)", () => {
    const src = `brand type Account = "admin" | "regular";\n`;
    const { code } = transform(src);
    expect(code).toContain(`type Account = "admin" | "regular";`);
    expect(code).not.toContain("AccountBrand");
    expect(code).not.toContain("unique symbol");
  });

  it("refined .from / cast return the branded type", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
const n = cast<PositiveInt>(raw);
`;
    const { code } = transform(src);
    expect(code).toContain(`function from(value: unknown): PositiveInt`);
    expect(code).toContain(`PositiveInt.from(raw)`);
    expect(code).toContain(
      `type PositiveInt = number & { readonly [PositiveIntBrand]: true };`,
    );
  });

  it("bare number is not assignable to refined brand (tsc)", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
`;
    const { code } = transform(src);
    const check = `${code}

declare function take(n: PositiveInt): void;
// @ts-expect-error bare number must not assign to PositiveInt
take(1);
take(PositiveInt.from(1));
`;
    expect(typecheckOk(check)).toEqual([]);
  });

  it("bare object is not assignable to validate brand (tsc)", () => {
    const src = `validate type User = { id: string; age: number };\n`;
    const { code } = transform(src);
    const check = `${code}

declare function take(u: User): void;
// @ts-expect-error bare object must not assign to User
take({ id: "a", age: 1 });
take(User.from({ id: "a", age: 1 }));
`;
    expect(typecheckOk(check)).toEqual([]);
  });
});
