/**
 * Thrown when a value is not a member of a defined literal set.
 */
export class LiteralSetError extends Error {
  readonly setName: string;
  readonly value: unknown;
  readonly allowed: readonly string[];

  constructor(setName: string, value: unknown, allowed: readonly string[]) {
    const preview =
      typeof value === "string"
        ? JSON.stringify(value)
        : `typeof ${typeof value}`;
    super(
      `Invalid ${setName}: ${preview} is not one of [${allowed.map((v) => JSON.stringify(v)).join(", ")}]`,
    );
    this.name = "LiteralSetError";
    this.setName = setName;
    this.value = value;
    this.allowed = allowed;
  }
}
