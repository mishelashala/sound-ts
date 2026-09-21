/**
 * Sound-TS 1.0 soundness rules (#54) — fixtures per reject/accept matrix.
 * See packages/core/src/soundness/SOUNDNESS_1_0.md.
 */

import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  transform,
  transformProject,
  runSoundness1Checks,
  buildProjectSymbols,
  parseSts,
} from "../src/index.js";

/** Compile one expanded snippet with stock tsc --strict. */
function typecheckOk(source: string): string[] {
  const file = "snippet.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === file) {
      return ts.createSourceFile(file, source, languageVersion, true);
    }
    return orig(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.writeFile = () => {};
  const program = ts.createProgram([file], options, host);
  const diags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("soundness 1.0: brand type predicates (FFI)", () => {
  it("rejects author type predicate refining a brand", () => {
    const src = `
brand type Account = "admin" | "regular";
function isAccount(x: unknown): x is Account {
  return true;
}
`;
    expect(() => transform(src)).toThrow(/type predicate refining dialect companion 'Account'/);
    expect(() => transform(src)).toThrow(/cast<>|\.from/);
  });

  it("rejects assertion predicate refining a validate type", () => {
    const src = `
validate type User = { id: string };
function assertUser(x: unknown): asserts x is User {
  if (typeof x !== "object") throw new Error("no");
}
`;
    expect(() => transform(src)).toThrow(/assertion predicate refining dialect companion 'User'/);
  });

  it("allows cast<> and .from entry", () => {
    const src = `
brand type Account = "admin" | "regular";
const raw: unknown = "admin";
const a = cast<Account>(raw);
const b = Account.from(raw);
`;
    const { code } = transform(src);
    expect(code).toContain(`Account.from(raw)`);
    expect(code).not.toContain("cast<");
  });

  it("rejects predicate to imported companion across files", () => {
    expect(() =>
      transformProject([
        {
          filename: "account.sts",
          source: `brand type Account = "admin" | "regular";\n`,
        },
        {
          filename: "main.sts",
          source: `
import { Account } from "./account.js";
function isAccount(x: unknown): x is Account {
  return typeof x === "string";
}
`,
        },
      ]),
    ).toThrow(/type predicate refining dialect companion 'Account'/);
  });
});

describe("soundness 1.0: honest Mode B is bodies", () => {
  it("rejects is() that always returns true", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    void n;
    return true;
  }
}
`;
    expect(() => transform(src)).toThrow(/always returns true/);
    expect(() => transform(src)).toThrow(/not proof/);
  });

  it("rejects is() that ignores the parameter", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return typeof window !== "undefined";
  }
}
`;
    expect(() => transform(src)).toThrow(/does not use parameter 'n'/);
  });

  it("accepts a real refined check", () => {
    const src = `
brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}
const x = PositiveInt.from(1);
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toContain(`Number.isInteger(n) && n > 0`);
    expect(code).toContain(`PositiveInt.from(1)`);
  });
});

describe("soundness 1.0: mutation / aliasing", () => {
  it("rejects assigning companion .from", () => {
    const src = `
brand type Account = "admin" | "regular";
Account.from = (_v: unknown) => "admin";
`;
    expect(() => transform(src)).toThrow(/companion member 'Account\.from'/);
  });

  it("rejects delete on companion .is", () => {
    const src = `
brand type Account = "admin" | "regular";
delete Account.is;
`;
    expect(() => transform(src)).toThrow(/companion member 'Account\.is'/);
  });

  it("rejects property write on brand-annotated binding", () => {
    const src = `
validate type User = { id: string };
const u: User = User.from({ id: "a" });
u.id = "b";
`;
    expect(() => transform(src)).toThrow(/property 'u\.id' on dialect-typed binding/);
  });

  it("allows reading fields after .from", () => {
    const src = `
validate type User = { id: string };
const u = User.from({ id: "a" });
const id = u.id;
`;
    const { code } = transform(src);
    expect(code).toContain(`const id = u.id`);
  });
});

describe("soundness 1.0: generics subset (Partial / Required)", () => {
  it("rejects Partial<Brand>", () => {
    const src = `
validate type User = { id: string };
type Loose = Partial<User>;
`;
    expect(() => transform(src)).toThrow(/Partial<User> is not allowed/);
    expect(() => transform(src)).toThrow(/phantom brand/);
  });

  it("rejects Required<Brand>", () => {
    const src = `
validate type User = { id: string };
type Tight = Required<User>;
`;
    expect(() => transform(src)).toThrow(/Required<User> is not allowed/);
  });

  it("allows Readonly<Brand> and ReadonlyArray<Brand>", () => {
    const src = `
validate type User = { id: string };
type R = Readonly<User>;
type List = ReadonlyArray<User>;
const u = User.from({ id: "a" });
`;
    const { code } = transform(src);
    expect(code).toContain(`type R = Readonly<User>`);
    expect(code).toContain(`type List = ReadonlyArray<User>`);
  });
});

describe("soundness 1.0: runSoundness1Checks entry", () => {
  it("runs against an explicit symbol table", () => {
    const source = `
brand type Account = "admin" | "regular";
function isAccount(x: unknown): x is Account { return true; }
`;
    const dialect = parseSts(source);
    const symbols = buildProjectSymbols([
      { filename: "t.sts", source, dialect },
    ]);
    expect(() =>
      runSoundness1Checks(source, { filename: "t.sts", symbols }),
    ).toThrow(/type predicate/);
  });
});

describe("soundness 1.0: plain .ts cannot assert into a brand (#72)", () => {
  const brandSts = `export brand type Brand = "admin" | "regular";\n`;

  it("fails as Brand in as-brand.ts", () => {
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "as-brand.ts",
          source: `export const punched = "admin" as Brand;\n`,
        },
      ]),
    ).toThrow(SyntaxError);
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "as-brand.ts",
          source: `export const punched = "admin" as Brand;\n`,
        },
      ]),
    ).toThrow(/type assertion to dialect companion 'Brand'/);
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "as-brand.ts",
          source: `export const punched = "admin" as Brand;\n`,
        },
      ]),
    ).toThrow(/not rewritten into cast/);
  });

  it("fails angle-bracket assertion to a brand in .ts", () => {
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "angle.ts",
          source: `export const punched = <Brand>"admin";\n`,
        },
      ]),
    ).toThrow(/type assertion to dialect companion 'Brand'/);
  });

  it("fails as Brand declared in another file in the batch", () => {
    expect(() =>
      transformProject([
        {
          filename: "ids.sts",
          source: `brand type Brand = "a" | "b";\n`,
        },
        {
          filename: "as-brand.ts",
          source: `export const punched = "a" as Brand;\n`,
        },
      ]),
    ).toThrow(/dialect companion 'Brand'/);
  });

  it("fails as User for a validate type", () => {
    expect(() =>
      transformProject([
        {
          filename: "user.sts",
          source: `validate type User = { id: string };\n`,
        },
        {
          filename: "as-user.ts",
          source: `export const u = { id: "a" } as User;\n`,
        },
      ]),
    ).toThrow(/type assertion to dialect companion 'User'/);
  });

  it("fails any assertion into a brand annotation", () => {
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "as-any.ts",
          source: `declare const raw: unknown;\nexport const punched: Brand = raw as any;\n`,
        },
      ]),
    ).toThrow(/any assertion into dialect companion 'Brand'/);
  });

  it("fails non-null assertion into a brand", () => {
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "bang.ts",
          source: `declare const raw: unknown;\nexport const punched: Brand = raw!;\n`,
        },
      ]),
    ).toThrow(/non-null assertion into dialect companion 'Brand'/);
    expect(() =>
      transformProject([
        { filename: "brand.sts", source: brandSts },
        {
          filename: "definite.ts",
          source: `export let punched!: Brand;\n`,
        },
      ]),
    ).toThrow(/non-null assertion to dialect companion 'Brand'/);
  });

  it("Brand.from in .ts still typechecks", () => {
    const use = `import { Brand } from "./brand.js";\nexport const ok = Brand.from("admin");\n`;
    const project = transformProject([
      { filename: "brand.sts", source: brandSts },
      { filename: "use.ts", source: use },
    ]);
    const plain = project.files.find((f) => f.filename === "use.ts")!;
    const sts = project.files.find((f) => f.filename === "brand.sts")!;
    expect(plain.changed).toBe(false);
    expect(plain.code).toBe(use);
    expect(plain.code).toContain(`Brand.from("admin")`);
    const bundled = `${sts.code}\n${plain.code.replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];\n/, "")}`;
    expect(typecheckOk(bundled)).toEqual([]);
  });

  it("keeps cast<Brand>, as const, and non-companion assertions", () => {
    const use = `
import { Brand } from "./brand.js";
declare function cast<T>(value: unknown): T;
export const values = ["admin", "regular"] as const;
export const label = "admin" as string;
export const n = 1 as number;
export const wide = 1 as any;
export const viaCast = cast<Brand>("admin");
export const ok = Brand.from("admin");
`;
    const project = transformProject([
      { filename: "brand.sts", source: brandSts },
      { filename: "use.ts", source: use },
    ]);
    const plain = project.files.find((f) => f.filename === "use.ts")!;
    expect(plain.changed).toBe(false);
    expect(plain.code).toBe(use);
    expect(plain.code).toContain(`cast<Brand>`);
    expect(plain.code).toContain(`as const`);
    expect(plain.code).not.toContain(`Brand.from("admin") as`);
  });

  it("copies a .ts file that never names a dialect companion", () => {
    const plain = `export const x = 1 as any;\nexport const y = value!;\nexport const z = "a" as string;\n`;
    const project = transformProject([
      { filename: "brand.sts", source: brandSts },
      { filename: "plain.ts", source: plain },
    ]);
    const file = project.files.find((f) => f.filename === "plain.ts")!;
    expect(file.changed).toBe(false);
    expect(file.code).toBe(plain);
  });
});
