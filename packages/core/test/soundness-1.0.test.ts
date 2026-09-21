/**
 * Sound-TS 1.0 soundness rules (#54) — fixtures per reject/accept matrix.
 * See packages/core/src/soundness/SOUNDNESS_1_0.md.
 */

import { describe, expect, it } from "vitest";
import {
  transform,
  transformProject,
  runSoundness1Checks,
  buildProjectSymbols,
  parseSts,
} from "../src/index.js";

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

describe("soundness 1.0: outbound widen", () => {
  it("rejects a validate type value as its naked field structure", () => {
    const src = `
validate type User = { id: string };
const u: User = User.from({ id: "a" });
const plain: { id: string } = u;
`;
    expect(() => transform(src)).toThrow(/naked field structure/);
    expect(() => transform(src)).toThrow(/'User'/);
    expect(() => transform(src)).toThrow(/this visitor is the gate/);
  });

  it("rejects a validate-type .from initializer and cast<>", () => {
    expect(() =>
      transform(`
validate type User = { id: string };
const raw: unknown = { id: "a" };
const plain: { id: string } = User.from(raw);
`),
    ).toThrow(/naked field structure/);
    expect(() =>
      transform(`
validate type User = { id: string };
const raw: unknown = { id: "a" };
const plain: { id: string } = cast<User>(raw);
`),
    ).toThrow(/naked field structure/);
  });

  it("rejects an unannotated binding that holds a validate value", () => {
    const src = `
validate type User = { id: string; age: number };
const u = User.from({ id: "a", age: 1 });
const plain: { age: number; id: string } = u;
`;
    expect(() => transform(src)).toThrow(/naked field structure/);
  });

  it("rejects a later assignment to a naked-annotated binding", () => {
    const src = `
validate type User = { id: string };
const u = User.from({ id: "a" });
let plain: { id: string } = { id: "b" };
plain = u;
`;
    expect(() => transform(src)).toThrow(/naked field structure/);
  });

  it("allows field reads and a fresh object with the same shape", () => {
    const src = `
validate type User = { id: string };
const u = User.from({ id: "a" });
const id = u.id;
const plain: { id: string } = { id: "b" };
void id;
void plain;
`;
    const { code } = transform(src);
    expect(code).toContain(`const id = u.id`);
    expect(code).toContain(`const plain: { id: string } = { id: "b" }`);
  });

  it("rejects a literal brand as its bare union and accepts .toPrimitive", () => {
    const rejected = `
brand type Account = "admin" | "regular";
const a = Account.from("admin");
const members: "admin" | "regular" = a;
`;
    expect(() => transform(rejected)).toThrow(/bare literal union/);
    expect(() => transform(rejected)).toThrow(/Account\.toPrimitive/);

    const accepted = `
brand type Account = "admin" | "regular";
const a = Account.from("admin");
const members: "admin" | "regular" = Account.toPrimitive(a);
const wide: string = a;
const literal: "admin" | "regular" = "admin";
void members;
void wide;
void literal;
`;
    const { code } = transform(accepted);
    expect(code).toContain(`Account.toPrimitive(a)`);
    expect(code).toContain(`const wide: string = a`);
  });

  it("rejects a number literal brand and Values member as the bare union", () => {
    expect(() =>
      transform(`
brand type Days = 7 | 30 | 90;
const d: Days = Days.from(7);
const members: 90 | 7 | 30 = d;
`),
    ).toThrow(/bare literal union/);

    const src = `
brand type Days = 7 | 30 | 90;
const d = Days.from(7);
const members: 7 | 30 | 90 = Days.toPrimitive(d);
const wide: number = d;
const viaValues: 7 | 30 | 90 = Days.Values[7];
void members;
void wide;
`;
    expect(() => transform(src)).toThrow(/Days\.toPrimitive/);
    expect(() => transform(src)).toThrow(/bare literal union/);
  });

  it("allows .toPrimitive for a number literal brand when Values is not assigned", () => {
    const src = `
brand type Days = 7 | 30 | 90;
const d = Days.from(7);
const members: 7 | 30 | 90 = Days.toPrimitive(d);
const wide: number = d;
void members;
void wide;
`;
    const { code } = transform(src);
    expect(code).toContain(`Days.toPrimitive(d)`);
    expect(code).toContain(`const wide: number = d`);
  });

  it("rejects an imported validate type widened to its naked fields", () => {
    expect(() =>
      transformProject([
        {
          filename: "user.sts",
          source: `validate type User = { id: string };\nexport { User };\n`,
        },
        {
          filename: "main.sts",
          source: `
import { User } from "./user.js";
const u: User = User.from({ id: "a" });
const plain: { readonly id: string } = u;
`,
        },
      ]),
    ).toThrow(/naked field structure/);
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
