/** Curated .sts samples for the docs playground dropdown. */
export const EXAMPLES = [
  {
    id: "literal",
    label: "String literal brand",
    source: `brand type Account = "admin" | "regular";

function setRole(role: Account) {
  console.log(role);
}

setRole("admin");
setRole(Account.from("admin"));
// setRole("superuser"); // error under stock tsc
// Account.from("superuser"); // throws
`,
  },
  {
    id: "refined",
    label: "Refined brand",
    source: `brand type PositiveInt = number {
  is(n: number): n is PositiveInt {
    return Number.isInteger(n) && n > 0;
  }
}

const n = PositiveInt.from(3);
// const bad = PositiveInt.from(-1); // throws
// const wider: PositiveInt = 3; // error under stock tsc
`,
  },
  {
    id: "union",
    label: "Brand union",
    source: `brand type Admin = "admin";
brand type Regular = "regular";
brand type Staff = Admin | Regular;

function greet(role: Staff) {
  return role === "admin" ? "hello, admin" : "hello";
}

greet(Admin.from("admin"));
greet(Regular.from("regular"));
`,
  },
  {
    id: "validate",
    label: "Validate type",
    source: `validate type User = { id: string; age: number };

const ok = User.from({ id: "u1", age: 30 });
User.is({ id: "u1", age: 30 });
// User.from({ id: "u1" }); // throws
`,
  },
  {
    id: "cast",
    label: "Checked cast",
    source: `brand type Account = "admin" | "regular";
validate type User = { id: string; age: number };

declare const raw: unknown;

const role = cast<Account>(raw);
const n = cast<number>(raw);
const user = cast<User>(raw);
`,
  },
  {
    id: "methods",
    label: "Method parameters",
    source: `// Methods emit as readonly function properties (strictFunctionTypes).
class Kennel {
  feed(name: string) {
    console.log(name);
  }
}

const kennel = new Kennel();
kennel.feed("rex");
`,
  },
  {
    id: "reject-as",
    label: "Reject as (error)",
    source: `// Expand fails: use cast<> or Account.from instead of as.
brand type Account = "admin" | "regular";

const punched = "admin" as Account;
`,
  },
  {
    id: "reject-any",
    label: "Reject any (error)",
    source: `// Expand fails: use unknown, then cast<> / .from.
const punched: any = "admin";
`,
  },
  {
    id: "reject-bang",
    label: "Reject ! (error)",
    source: `// Expand fails: narrow with a check instead of !.
declare const user: { name: string | undefined };

const name = user.name!;
`,
  },
  {
    id: "reject-wide",
    label: "Reject Object / {} (error)",
    source: `// Expand fails: Object / {} / Function are too wide.
function take(value: Object) {
  console.log(value);
}
`,
  },
  {
    id: "reject-structural",
    label: "No structural alias (error)",
    source: `// Expand fails: use validate type or brand type.
type User = { id: string; age: number };
`,
  },
];

export function exampleById(id) {
  return EXAMPLES.find((example) => example.id === id) ?? EXAMPLES[0];
}
