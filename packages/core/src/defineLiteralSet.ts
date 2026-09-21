import { LiteralSetError } from "./errors.js";

/**
 * Internal emit target / runtime shape for closed string literal sets.
 * Not the public product API — authors write `brand type`, the CLI expands.
 * @internal
 */
export interface LiteralSet<
  Name extends string,
  Values extends readonly string[],
> {
  readonly name: Name;
  readonly values: Values;
  is(value: unknown): value is Values[number];
  from(value: unknown): Values[number];
  /** Narrow a branded member back to the closed literal union (DTO / JSON edges). */
  toPrimitive(value: Values[number]): Values[number];
}

/** @internal */
export type InferLiteral<S> =
  S extends LiteralSet<string, infer Values> ? Values[number] : never;

/**
 * Build the runtime companion object that `brand type` expands into.
 * @internal
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
    throw new TypeError(`defineLiteralSet: duplicate values in set "${name}"`);
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

  function toPrimitive(value: Values[number]): Values[number] {
    for (const v of frozen) {
      if (value === v) return v as Values[number];
    }
    throw new LiteralSetError(name, value, frozen);
  }

  return Object.freeze({
    name,
    values: frozen,
    is,
    from,
    toPrimitive,
  });
}
