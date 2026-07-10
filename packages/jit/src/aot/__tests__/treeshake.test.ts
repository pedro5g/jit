import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { AOT, JIT } from "../../index.js";

describe("JIT AOT tree-shaking (real bundler proof)", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-treeshake-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  async function bundle(entrySource: string): Promise<string> {
    const entry = join(outDir, "entry.mjs");

    writeFileSync(entry, entrySource);

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      write: false,
      minify: false,
      treeShaking: true,
    });

    return result.outputFiles[0].text;
  }

  it("should keep only the imported flat operation in the final bundle", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      email: JIT.string().email(),
    });

    AOT.generate({ schemas: { User }, outDir });

    const bundled = await bundle(
      `import { User_is } from "./index.mjs";\nconsole.log(User_is({ id: 1, name: "Ada", email: "ada@math.org" }));\n`
    );

    // Only the validator survives; every other compiled operation is gone.
    expect(bundled).toContain("function is(");
    expect(bundled).not.toContain("stringify");
    expect(bundled).not.toContain("encode");
    expect(bundled).not.toContain("clone");
    expect(bundled).not.toContain("JITValidationError"); // parse unused
    expect(bundled).not.toContain("Object.freeze"); // namespace dropped
  });

  it("should drop entire schemas that are never imported", async () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });

    AOT.generate({ schemas: { User, Order }, outDir });

    const bundled = await bundle(
      `import { User_equal } from "./index.mjs";\nconsole.log(User_equal({ id: 1 }, { id: 1 }));\n`
    );

    expect(bundled).toContain("User_equal");
    expect(bundled).not.toContain("Order");
  });

  it("should keep the namespace aggregation only when it is used", async () => {
    const User = JIT.object({ id: JIT.number() });
    const selected = JIT.validator(User).get("is");

    AOT.generate({ schemas: { User: JIT.compile(User, { is: selected.is }) }, outDir });

    const bundled = await bundle(`import { User } from "./index.mjs";\nconsole.log(User.is({ id: 1 }));\n`);

    expect(bundled).toContain("Object.freeze");
  });
});
