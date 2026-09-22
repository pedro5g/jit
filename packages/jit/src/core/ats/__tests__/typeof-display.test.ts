import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "typeof-display.fixture.ts");

function displayTypes(): Record<string, string> {
  const program = ts.createProgram([fixture], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ["@jit/source"],
    lib: ["lib.es2020.d.ts", "lib.esnext.temporal.d.ts", "lib.dom.d.ts"],
    types: ["node"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const sourceFile = program.getSourceFile(fixture);
  if (sourceFile === undefined) throw new Error(`Type display fixture was not loaded: ${fixture}`);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    diagnostics,
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")
  ).toEqual([]);

  const checker = program.getTypeChecker();
  const output: Record<string, string> = {};
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    const type = checker.getTypeAtLocation(statement.type);
    output[statement.name.text] = checker.typeToString(type, statement, ts.TypeFormatFlags.NoTruncation);
  }
  return output;
}

describe("public Typeof display", () => {
  it("prints schema-directed public types without builder internals", () => {
    const types = displayTypes();
    const { EntityUser, ...stableTypes } = types;

    expect(stableTypes).toMatchInlineSnapshot(`
      {
        "DomainState": "Omit<{ id: number; name: string; email: string; role: "member" | "admin"; active: boolean; score: number; tags: string[]; profile: { bio: string | null; } | undefined; }, "id"> & Readonly<Pick<{ id: number; name: string; email: string; role: "member" | "admin"; active: boolean; score: number; tags: string[]; profile: { bio: string | null; } | undefined; }, "id">>",
        "PublicUser": "{ id: number; name: string; email: string; }",
        "User": "{ id: number; name: string; email: string; role: "member" | "admin"; active: boolean; score: number; tags: string[]; profile: { bio: string | null; } | undefined; }",
        "UserEvent": "{ readonly id: string; readonly type: "user.name-changed"; readonly version: 1; readonly occurredAt: Date; readonly payload: { oldName: string; newName: string; }; } & JIT.DomainEventBrand & { readonly "~event": JIT.StandardEvent; }",
        "UserList": "{ id: number; name: string; email: string; role: "member" | "admin"; active: boolean; score: number; tags: string[]; profile: { bio: string | null; } | undefined; }[]",
      }
    `);
    for (const member of [
      "readonly email: string;",
      'readonly role: "member" | "admin";',
      "readonly name: string;",
      "readonly id: number;",
      "readonly tags: string[];",
      "equals: (other: unknown) => boolean;",
      "hashCode: () => number;",
      "readonly active: boolean;",
      "readonly score: number;",
      "readonly profile: { bio: string | null; } | undefined;",
    ]) {
      expect(EntityUser).toContain(member);
    }
    expect(Object.values(stableTypes).join("\n")).not.toMatch(/BuilderShape|TypeofShape|BaseBuilder|SchemaCheck/);
  }, 120_000);
});
