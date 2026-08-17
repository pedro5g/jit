import { JIT } from "@jit-compiler/jit/runtime";
import { describe, expect, it } from "vitest";
import { bundleUnits, topLevelNames } from "../bundle";

/**
 * The bundle is evaluated the way the compiler worker evaluates it, so a test
 * that passes here is a project that actually runs in the workspace.
 */
function evaluate(bundle: string, name: string): unknown {
  const factory = new Function("JIT", `"use strict";\n${bundle}\nreturn ${name};`) as (jit: unknown) => unknown;
  return factory(JIT);
}

describe("bundleUnits", () => {
  /** The failure the whole module exists for. */
  it("lets two files declare the same name", () => {
    const bundle = bundleUnits([
      {
        path: "user-schemas.ts",
        code: `import { JIT } from "@jit-compiler/jit/runtime";
export const schema = JIT.object({ id: JIT.string() });`,
      },
      {
        path: "account-schemas.ts",
        code: `import { JIT } from "@jit-compiler/jit/runtime";
import { schema as User } from "./user-schemas.js";
const schema = JIT.object({ owner: User });`,
      },
    ]);

    expect(() => evaluate(bundle, "schema")).not.toThrow();
    // the entry's own schema is the one at the top level
    expect(evaluate(`${bundle}\nconst isAccount = JIT.validate.is(schema);`, "isAccount({ owner: { id: 'a' } })")).toBe(
      true
    );
  });

  it("honours the alias an import gave the value", () => {
    const bundle = bundleUnits([
      { path: "shared.ts", code: "export const Base = 41;" },
      { path: "index.ts", code: `import { Base as Answer } from "./shared";\nconst value = Answer + 1;` },
    ]);

    expect(evaluate(bundle, "value")).toBe(42);
  });

  it("binds a namespace import to the module object", () => {
    const bundle = bundleUnits([
      { path: "shared.ts", code: "export const a = 1;\nexport const b = 2;" },
      { path: "index.ts", code: `import * as shared from "./shared";\nconst value = shared.a + shared.b;` },
    ]);

    expect(evaluate(bundle, "value")).toBe(3);
  });

  it("resolves a nested specifier to the file it points at", () => {
    const bundle = bundleUnits([
      { path: "schemas/shared.ts", code: "export const Base = 7;" },
      { path: "schemas/user.ts", code: `import { Base } from "./shared.js";\nconst value = Base;` },
    ]);

    expect(evaluate(bundle, "value")).toBe(7);
  });

  it("drops the package import, which is a binding rather than a module", () => {
    const bundle = bundleUnits([
      {
        path: "index.ts",
        code: `import { JIT } from "@jit-compiler/jit/runtime";\nconst schema = JIT.string();`,
      },
    ]);

    expect(bundle).not.toContain("import");
    expect(() => evaluate(bundle, "schema")).not.toThrow();
  });

  it("leaves the entry's declarations at the top level, where the compiler reads them", () => {
    const bundle = bundleUnits([
      { path: "shared.ts", code: "export const Base = 1;" },
      { path: "index.ts", code: `import { Base } from "./shared";\nconst schema = Base;` },
    ]);

    expect(bundle).toMatch(/const __module0 = \(\(\) => \{/);
    expect(bundle.split("__module0 = ")[1]).toContain("const schema = Base;");
  });
});

describe("topLevelNames", () => {
  it("reads exported and plain declarations alike", () => {
    expect(topLevelNames("export const a = 1;\nlet b = 2;\nfunction c() {}")).toEqual(["a", "b", "c"]);
  });
});
