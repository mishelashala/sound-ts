import { describe, expect, it, expectTypeOf } from "vitest";
import {
  defineLiteralSet,
  InferLiteral,
  LiteralSetError,
} from "../src/index.js";

describe("defineLiteralSet", () => {
  const AccountRole = defineLiteralSet("AccountRole", [
    "admin",
    "regular",
  ] as const);

  type AccountRole = InferLiteral<typeof AccountRole>;

  it("exposes name and values", () => {
    expect(AccountRole.name).toBe("AccountRole");
    expect(AccountRole.values).toEqual(["admin", "regular"]);
    expect(Object.isFrozen(AccountRole.values)).toBe(true);
    expect(Object.isFrozen(AccountRole)).toBe(true);
  });

  it("from accepts valid members (happy path)", () => {
    expect(AccountRole.from("admin")).toBe("admin");
    expect(AccountRole.from("regular")).toBe("regular");
  });

  it("is narrows valid members", () => {
    expect(AccountRole.is("admin")).toBe(true);
    expect(AccountRole.is("regular")).toBe(true);
    expect(AccountRole.is("guest")).toBe(false);
    expect(AccountRole.is(42)).toBe(false);
    expect(AccountRole.is(null)).toBe(false);
    expect(AccountRole.is(undefined)).toBe(false);
  });

  it("from rejects invalid values at runtime", () => {
    expect(() => AccountRole.from("guest")).toThrow(LiteralSetError);
    expect(() => AccountRole.from("guest")).toThrow(
      /Invalid AccountRole.*"guest"/,
    );
    expect(() => AccountRole.from(1)).toThrow(LiteralSetError);

    try {
      AccountRole.from("nope");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LiteralSetError);
      const e = err as LiteralSetError;
      expect(e.setName).toBe("AccountRole");
      expect(e.value).toBe("nope");
      expect(e.allowed).toEqual(["admin", "regular"]);
    }
  });

  it("types the union correctly for consumers", () => {
    expectTypeOf<AccountRole>().toEqualTypeOf<"admin" | "regular">();
    const role = AccountRole.from("admin");
    expectTypeOf(role).toEqualTypeOf<"admin" | "regular">();

    if (AccountRole.is("admin")) {
      // type-guard path
      const ok: AccountRole = "admin";
      expect(ok).toBe("admin");
    }
  });

  it("rejects empty name / empty values / duplicates at definition time", () => {
    expect(() => defineLiteralSet("", ["a"] as const)).toThrow(TypeError);
    expect(() =>
      defineLiteralSet("X", [] as unknown as readonly [string, ...string[]]),
    ).toThrow(TypeError);
    expect(() =>
      defineLiteralSet("Dup", ["a", "a"] as const),
    ).toThrow(/duplicate/);
  });
});
