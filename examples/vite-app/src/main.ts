import { Account } from "./roles.sts";

const role: Account = "admin";
console.log(Account.is(role) ? role : "invalid");
