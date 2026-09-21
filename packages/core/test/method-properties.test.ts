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
  it("expands type/interface/class methods to readonly property form", () => {
    const src = `
type Feed = { eat(animal: Animal): void };
interface Handler { handle(x: number): void }
class Kennel {
  eat(dog: Dog) {}
}
`;
    const { code, changed } = transform(src);
    expect(changed).toBe(true);
    expect(code).toContain("readonly eat: (animal: Animal) => void");
    expect(code).toContain("readonly handle: (x: number) => void");
    expect(code).toMatch(/readonly eat = \(dog: Dog\) => \{\s*\};/);
    expect(code).not.toMatch(/eat\(animal: Animal\): void/);
    expect(code).not.toMatch(/^\s*eat\(dog: Dog\)\s*\{/m);
  });

  it("tsc rejects Dog handler where Animal is required; accepts Animal where Dog is required", () => {
    const src = `
type Animal = { kind: "animal" };
type Dog = Animal & { bark: true };

type AnimalFeeder = { eat(animal: Animal): void };
type DogFeeder = { eat(dog: Dog): void };

class DogOnly {
  eat(dog: Dog) {}
}
class AnimalOk {
  eat(animal: Animal) {}
}
`;
    const { code } = transform(src);
    expect(code).toContain("readonly eat: (animal: Animal) => void");
    expect(code).toContain("readonly eat: (dog: Dog) => void");

    const check = `${code}

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
