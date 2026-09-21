import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { transform, rewriteMethodsAsProperties } from "../src/index.js";

/** Compile a snippet with stock tsc --strict; return diagnostic messages. */
function typecheckOk(source: string): string[] {
  const file = "snippet.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError) => {
    if (name === file) {
      return ts.createSourceFile(file, source, languageVersion, true);
    }
    return orig(name, languageVersion, onError);
  };
  host.writeFile = () => {};
  const program = ts.createProgram([file], options, host);
  const diags = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];
  return diags.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  );
}

describe("emit methods as readonly function properties", () => {
  it("expands class methods to readonly property form via transform", () => {
    // Object `type` / `interface` aliases are rejected by soundness (#38).
    // Class methods still rewrite under transform.
    const src = `
class Kennel {
  eat(dog: string) {}
}
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toMatch(/readonly eat = \(dog: string\) => \{\s*\};/);
    expect(code).not.toMatch(/^\s*eat\(dog: string\)\s*\{/m);
  });

  it("rewrites type/interface method signatures (emit helper, pre-soundness)", () => {
    const src = `
type Feed = { eat(animal: string): void };
interface Handler { handle(x: number): void }
`;
    const { code, count } = rewriteMethodsAsProperties(src);
    expect(count).toBeGreaterThan(0);
    expect(code).toContain("readonly eat: (animal: string) => void");
    expect(code).toContain("readonly handle: (x: number) => void");
  });

  it("tsc rejects Dog handler where Animal is required; accepts Animal where Dog is required", () => {
    // Build types in the tsc fixture only. .sts soundness forbids those aliases.
    const classes = `
class DogOnly {
  eat(dog: Dog) {}
}
class AnimalOk {
  eat(animal: Animal) {}
}
`;
    const { code: methods } = rewriteMethodsAsProperties(classes);
    expect(methods).toMatch(/readonly eat = \(dog: Dog\) =>/);
    expect(methods).toMatch(/readonly eat = \(animal: Animal\) =>/);

    const check = `
type Animal = { kind: "animal" };
type Dog = Animal & { bark: true };

type AnimalFeeder = { readonly eat: (animal: Animal) => void };
type DogFeeder = { readonly eat: (dog: Dog) => void };

${methods}

declare let needsAnimal: AnimalFeeder;
declare let needsDog: DogFeeder;

// Animal-where-Dog is OK (contravariant parameters)
needsDog = { eat: (animal: Animal) => {} };
needsDog = new AnimalOk();

// @ts-expect-error Dog-where-Animal must fail under strictFunctionTypes
needsAnimal = { eat: (dog: Dog) => {} };
// @ts-expect-error Dog method property not assignable to Animal feeder
needsAnimal = new DogOnly();
`;
    expect(typecheckOk(check)).toEqual([]);
  });

  it("does not ban method() authoring — rewrite is emit-only", () => {
    const src = `type T = { m(n: number): void };\n`;
    const { code } = rewriteMethodsAsProperties(src);
    expect(src).toContain("m(n: number): void");
    expect(code).toContain("readonly m: (n: number) => void");
  });
});
