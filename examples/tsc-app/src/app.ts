import { Account } from "./roles.js";

export function label(role: Account): string {
  return role === "admin" ? "admin" : "regular";
}

export const admin: Account = "admin";
