import { describe, expect, it } from "vitest";
import { parseSts } from "../src/ast/index.js";
import { transformProject } from "../src/transform.js";
import {
  buildProjectSymbols,
  lookupSymbol,
  resolveBrandMemberSymbols,
  resolveCastTarget,
} from "../src/symbols/index.js";

describe("dialect project symbols (cross-file)", () => {
  it("resolves brand members to symbols across files on the AST pipeline", () => {
    const aSource = `
brand type Admin = "admin";
brand type Regular = "regular";
export { Admin, Regular };
`;
    const bSource = `
import { Admin, Regular } from "./a.js";
brand type Staff = Admin | Regular;
`;

    const files = [
      { filename: "a.sts", source: aSource, dialect: parseSts(aSource) },
      { filename: "b.sts", source: bSource, dialect: parseSts(bSource) },
    ];
    const project = buildProjectSymbols(files);
    resolveBrandMemberSymbols(project);

    const admin = project.byName.get("Admin");
    const regular = project.byName.get("Regular");
    const staff = project.byName.get("Staff");
    expect(admin?.kind).toBe("brand");
    expect(admin?.filename).toBe("a.sts");
    expect(regular?.filename).toBe("a.sts");
    expect(staff?.filename).toBe("b.sts");
    expect(staff?.decl.kind).toBe("union");

    if (staff?.decl.kind === "union") {
      expect(lookupSymbol(project, "b.sts", staff.decl.members[0]!)?.id).toBe(
        admin?.id,
      );
      expect(lookupSymbol(project, "b.sts", staff.decl.members[1]!)?.id).toBe(
        regular?.id,
      );
    }
  });

  it("links stock companion imports to declaring symbols", () => {
    const aSource = `
brand type Admin = "admin";
export { Admin };
`;
    const bSource = `
import { Admin as Role } from "./a.js";
const x = Role;
`;
    const project = buildProjectSymbols([
      { filename: "a.sts", source: aSource, dialect: parseSts(aSource) },
      { filename: "b.sts", source: bSource, dialect: parseSts(bSource) },
    ]);

    const scope = project.scopes.get("b.sts")!;
    expect(scope.imports).toHaveLength(1);
    const binding = scope.imports[0]!;
    expect(binding.localName).toBe("Role");
    expect(binding.importedName).toBe("Admin");
    expect(binding.moduleSpecifier).toBe("./a.js");
    expect(binding.symbol?.name).toBe("Admin");
    expect(binding.symbol?.filename).toBe("a.sts");
    expect(scope.importByLocal.get("Role")?.symbol?.id).toBe(
      project.byName.get("Admin")?.id,
    );
  });

  it("resolves cast targets to companion symbols across files", () => {
    const userSource = `
validate type User = { id: string };
export { User };
`;
    const mainSource = `
import { User } from "./user.js";
const u = cast<User>(raw);
`;
    const project = buildProjectSymbols([
      {
        filename: "user.sts",
        source: userSource,
        dialect: parseSts(userSource),
      },
      {
        filename: "main.sts",
        source: mainSource,
        dialect: parseSts(mainSource),
      },
    ]);

    const cast = project.scopes.get("main.sts")!.dialect.casts[0]!;
    const resolved = resolveCastTarget(project, "main.sts", cast.target);
    expect(resolved.kind).toBe("companion");
    if (resolved.kind === "companion") {
      expect(resolved.symbol.kind).toBe("validate");
      expect(resolved.symbol.name).toBe("User");
      expect(resolved.symbol.filename).toBe("user.sts");
    }
  });

  it("transformProject keeps imports as stock TS after emit", () => {
    const result = transformProject([
      {
        filename: "a.sts",
        source: `
brand type Admin = "admin";
export { Admin };
`,
      },
      {
        filename: "b.sts",
        source: `
import { Admin } from "./a.js";
brand type Staff = Admin | Admin;
const x = cast<Admin>(raw);
`,
      },
    ]);

    const b = result.files.find((f) => f.filename === "b.sts")!;
    expect(b.code).toContain(`import { Admin } from "./a.js";`);
    expect(b.code).not.toContain("brand type");
    expect(b.code).toContain(`Admin.from(raw)`);

    const admin = result.symbols.byName.get("Admin");
    expect(admin?.filename).toBe("a.sts");
    const importHit = result.symbols.scopes
      .get("b.sts")!
      .importByLocal.get("Admin");
    expect(importHit?.symbol?.id).toBe(admin?.id);
  });

  it("rejects duplicate companion names via the symbol table", () => {
    const a = `brand type User = "a";\n`;
    const b = `validate type User = { id: string };\n`;
    expect(() =>
      buildProjectSymbols([
        { filename: "a.sts", source: a, dialect: parseSts(a) },
        { filename: "b.sts", source: b, dialect: parseSts(b) },
      ]),
    ).toThrow(/both brand type and validate type/);
  });
});
