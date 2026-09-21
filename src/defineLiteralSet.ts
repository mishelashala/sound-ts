import { LiteralSetError } from "./errors.js";

/**
 * A closed, finite set of string literals with compile-time union typing
 * and runtime validation helpers. Plain TypeScript — works with stock tsc.
 */
export interface LiteralSet<
  Name extends string,
  Values extends readonly string[],
> {
  /** Display / error name of the set (e.g. `"AccountRole"`). */
  readonly name: Name;
  /** The closed list of allowed string literals. */
  readonly values: Values;
  /** Type-guard: `true` iff `value` is one of `.values`. */
  is(value: unknown): value is Values[number];
  /**
   * Parse / narrow: returns the value typed as the union, or throws
   * {@link LiteralSetError} when invalid.
   */
  from(value: unknown): Values[number];
}

/** Extract the string-literal union from a {@link LiteralSet} instance. */
export type InferLiteral<S> =
  S extends LiteralSet<string, infer Values> ? Values[number] : never;

/**
 * Define a closed string-literal set.
 *
 * @example
 * ```ts
 * const AccountRole = defineLiteralSet("AccountRole", ["admin", "regular"] as const);
 * type AccountRole = InferLiteral<typeof AccountRole>; // "admin" | "regular"
 *
 * AccountRole.from("admin");           // "admin"
 * AccountRole.is("guest");             // false
 * AccountRole.from("guest");           // throws LiteralSetError
 * ```
 */
export function defineLiteralSet<
  Name extends string,
  const Values extends readonly [string, ...string[]],
>(name: Name, values: Values): LiteralSet<Name, Values> {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("defineLiteralSet: name must be a non-empty string");
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(
      "defineLiteralSet: values must be a non-empty array of strings",
    );
  }
  for (const v of values) {
    if (typeof v !== "string") {
      throw new TypeError(
        `defineLiteralSet: every value must be a string (got ${typeof v})`,
      );
    }
  }
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new TypeError(
      `defineLiteralSet: duplicate values in set "${name}"`,
    );
  }

  const frozen = Object.freeze([...values]) as unknown as Values;

  function is(value: unknown): value is Values[number] {
    return typeof value === "string" && unique.has(value);
  }

  function from(value: unknown): Values[number] {
    if (is(value)) {
      return value;
    }
    throw new LiteralSetError(name, value, frozen);
  }

  return Object.freeze({
    name,
    values: frozen,
    is,
    from,
  });
}
