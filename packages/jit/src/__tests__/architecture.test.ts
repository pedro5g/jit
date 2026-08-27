import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expectTypeOf } from "vitest";

import { JIT } from "../index.js";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectIndexFiles(directory: string, output: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) collectIndexFiles(path, output);
    else if (entry.name === "index.ts") output.push(path);
  }
  return output;
}

function isExportedTypeAlias(statement: ts.Statement): boolean {
  return (
    ts.isTypeAliasDeclaration(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

describe("source architecture", () => {
  it("keeps every index.ts as a declaration-only re-export barrel", () => {
    for (const path of collectIndexFiles(sourceRoot)) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const invalid = source.statements.filter(
        (statement) => !ts.isExportDeclaration(statement) && !isExportedTypeAlias(statement)
      );

      expect(
        invalid.map((statement) => ts.SyntaxKind[statement.kind]),
        path
      ).toEqual([]);
    }
  });

  it("infers enum array literals without an as const assertion", () => {
    const Role = JIT.enum(["admin", "user"]);

    expect(Role.schema.def.values).toEqual(["admin", "user"]);
    expectTypeOf<JIT.Typeof<typeof Role>>().toEqualTypeOf<"admin" | "user">();
  });
});
