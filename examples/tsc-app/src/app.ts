import { AccountCode } from "./account-code.js";
import { CurrencyNumber } from "./currency.js";
import { Environment } from "./environment.js";
import { Measure } from "./measure.js";
import { Account } from "./roles.js";

export function label(role: Account): string {
  return role === "admin" ? "admin" : "regular";
}

export const admin: Account = "admin";

export const sandbox: Environment = "sandbox";

export function environmentFromChecked(raw: unknown): Environment | undefined {
  if (!Environment.is(raw)) return undefined;
  return Environment.from(raw);
}

export const codeZero: AccountCode = AccountCode.Zero;

export function accountCodeLabel(code: AccountCode): string {
  switch (AccountCode.toPrimitive(code)) {
    case 0:
      return "zero";
    case 1:
      return "one";
    case 2:
      return "two";
    case 3:
      return "three";
  }
}

export function currencyFromAmount(amount: number): CurrencyNumber {
  return CurrencyNumber.from(amount.toFixed(2));
}

export function measureUnits(raw: unknown): number | null {
  const measure: Measure = Measure.from(raw);
  return measure.units;
}
