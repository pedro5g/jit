import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const isUser = JIT.validate.is(User);

    AOT.generate({ groups: {}, artifacts: { User_is: isUser }, outDir });

    const bundled = await bundle(
      `import { User_is } from "./index.js";\nconsole.log(User_is({ id: 1, name: "Ada", email: "ada@math.org" }));\n`
    );

    // Only the validator survives; every other compiled operation is gone.
    expect(bundled).toContain("function is(");
    expect(bundled).not.toContain("stringify");
    expect(bundled).not.toContain("encode");
    expect(bundled).not.toContain("clone");
    expect(bundled).not.toContain("JITValidationError"); // parse unused
    expect(bundled).not.toContain("Object.freeze"); // namespace dropped
  });

  it("should drop unused flat exports from the final app bundle", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      email: JIT.string().email(),
    });
    const isUser = JIT.validate.is(User);
    const parseUser = JIT.validate.parse(User);
    const stringify = JIT.json.stringify(User);

    AOT.generate({
      groups: {},
      artifacts: {
        User_is: isUser,
        User_parse: parseUser,
        User_stringify: stringify,
      },
      outDir,
    });

    const generated = readFileSync(join(outDir, "index.js"), "utf8");
    const bundled = await bundle(
      `import { User_is } from "./index.js";\nconsole.log(User_is({ id: 1, name: "Ada", email: "ada@math.org" }));\n`
    );

    expect(generated).toContain("const User_parse");
    expect(generated).toContain("const User_stringify");
    expect(generated).toContain("class JITValidationError extends Error");
    expect(bundled).toContain("User_is");
    expect(bundled).not.toContain("User_parse");
    expect(bundled).not.toContain("User_stringify");
    expect(bundled).not.toContain("JITValidationError");
    expect(bundled).not.toContain("function stringify");
  });

  it("should keep only the stages used by a composed JSON collection pipeline", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string(), active: JIT.boolean() });
    const activeUsers = JIT.json
      .parse(JIT.array(User))
      .validate()
      .filter((query) => query.eq("active", true))
      .select("id", "name")
      .to.json();

    AOT.generate({ groups: {}, artifacts: { activeUsers }, outDir });
    const bundled = await bundle(
      `import { activeUsers } from "./index.js";\nconsole.log(activeUsers('[{"id":1,"name":"Ada","active":true}]'));\n`
    );

    expect(bundled).toContain("function query(value)");
    expect(bundled).toContain("function stringify");
    expect(bundled).not.toContain("encodeInto");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("function map(source)");
  });

  it("should retain only the co-emitted class required by a construction pipeline", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() }));
    const parseUser = JIT.json.parse(User).validate();

    AOT.generate({ groups: {}, artifacts: { User, parseUser }, outDir });
    const bundled = await bundle(
      `import { parseUser } from "./index.js";\nconsole.log(parseUser('{"id":"u_1","name":"Ada"}'));\n`
    );

    expect(bundled).toContain("class User");
    expect(bundled).toContain("new User(r.data, true)");
    expect(bundled).not.toContain("@jit-compiler/jit");
    expect(bundled).not.toContain("ExecutionPlan");
    expect(bundled).not.toContain("artifact-registry");
  });

  it("should emit only configured class capabilities and drop unused classes", async () => {
    const Shape = JIT.object({ id: JIT.string(), value: JIT.number() });
    const Comparable = JIT.class(Shape).use(JIT.class.equals);
    const Hashable = JIT.class(Shape).use(JIT.class.hashCode);

    AOT.generate({ groups: {}, artifacts: { Comparable, Hashable }, outDir });
    const generated = readFileSync(join(outDir, "index.js"), "utf8");
    const bundled = await bundle(
      `import { Comparable } from "./index.js";\nconst value = Comparable.create({ id: "a", value: 1 });\nconsole.log(value.equals(value));\n`
    );

    expect(generated).toContain("equals(other)");
    expect(generated).toContain("hashCode()");
    expect(bundled).toContain("equals(other)");
    expect(bundled).not.toContain("hashCode()");
    expect(bundled).not.toContain("Hashable");
  });

  it("should drop entire schemas that are never imported", async () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });
    AOT.generate({
      artifacts: {
        User_equal: JIT.compare.equal(User),
        Order_equal: JIT.compare.equal(Order),
      },
      outDir,
    });

    const bundled = await bundle(
      `import { User_equal } from "./index.js";\nconsole.log(User_equal({ id: 1 }, { id: 1 }));\n`
    );

    expect(bundled).toContain("User_equal");
    expect(bundled).not.toContain("Order");
  });

  it("should keep the namespace aggregation only when it is used", async () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.validate.is(User);

    AOT.generate({ groups: { User: { is: isUser } }, outDir });

    const bundled = await bundle(`import { User } from "./index.js";\nconsole.log(User.is({ id: 1 }));\n`);

    expect(bundled).toContain("Object.freeze");
  });
});
