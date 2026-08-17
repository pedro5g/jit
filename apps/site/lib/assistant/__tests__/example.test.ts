import { JIT } from "@jit-compiler/jit/runtime";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  declaredNames,
  demonstratesUsage,
  describeFailure,
  mainExample,
  prepareSource,
  replaceMainExample,
} from "../example";
import { evaluateExample } from "../example-run";

/**
 * The check that runs the ghost's code before a reader sees it.
 *
 * Every case here is an answer that was actually produced. Each one passes the
 * name audit — no invented API, no invented method, nothing to match on — and
 * each one is useless or wrong, which is exactly why reading the answer was
 * never going to be enough.
 */

/** The same transpiler the worker uses, so the tests exercise the real path. */
function transpile(source: string): string {
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
  });
  const problem = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (problem) throw new SyntaxError(ts.flattenDiagnosticMessageText(problem.messageText, " "));

  return result.outputText;
}

const run = (code: string) => evaluateExample(code, { jit: JIT, transpile });

describe("evaluateExample", () => {
  it("passes an example that declares, compiles and runs", async () => {
    await expect(
      run(`import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({ id: JIT.string(), age: JIT.number().int().min(0) });
const isUser = JIT.validate.is(User);

isUser({ id: "a", age: 34 });`)
    ).resolves.toBeNull();
  });

  it("keeps type annotations from failing an otherwise working example", async () => {
    await expect(
      run(`import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({ id: JIT.string() });
type UserShape = JIT.Typeof<typeof User>;

const parse: (value: unknown) => UserShape = JIT.validate.parse(User);
parse({ id: "a" });`)
    ).resolves.toBeNull();
  });

  /**
   * The failure the reader reported: every name real, nothing to flag, and the
   * example cannot be run because the data it validates was never written.
   */
  it("names the value an example forgot to declare", async () => {
    await expect(
      run(`const User = JIT.object({ id: JIT.string() });
const isUser = JIT.validate.is(User);

if (isUser(payload)) {
  console.log("ok");
}`)
    ).resolves.toEqual({ kind: "undeclared", name: "payload" });
  });

  /**
   * A schema is not a validator, and treating it as one is the single most
   * common shape a small model gets wrong: it reads `const User = JIT.object(…)`
   * and calls `User(value)`. Every name in it is real.
   */
  it("catches a schema being called as if it validated", async () => {
    const failure = await run(`const User = JIT.object({ id: JIT.string() });

User({ id: "a" });`);

    expect(failure?.kind).toBe("threw");
    expect(failure && "error" in failure && failure.error).toMatch(/is not a function/);
  });

  it("catches a field declared with a type name instead of a schema", async () => {
    const failure = await run(`const User = JIT.object({ id: "string" });
const isUser = JIT.validate.is(User);

isUser({ id: "a" });`);

    expect(failure?.kind).toBe("threw");
    expect(failure && "error" in failure && failure.error).toMatch(/TypeError/);
  });

  it("reports an example whose parse fails on its own sample data", async () => {
    const failure = await run(`const User = JIT.object({ id: JIT.string() });
const parseUser = JIT.validate.parse(User);

parseUser({ id: 42 });`);

    expect(failure?.kind).toBe("threw");
  });

  it("treats a platform global used as a schema as the undeclared name it is", async () => {
    const failure = await run(`const Rows = JIT.array(Event);
const isRows = JIT.validate.is(Rows);

isRows([]);`);

    expect(failure).toEqual({ kind: "undeclared", name: "Event" });
  });

  it("accepts a block that demonstrates its own failure case", async () => {
    await expect(
      run(`const Email = JIT.string().email();
const parseEmail = JIT.validate.parse(Email);

parseEmail("NOT-AN-EMAIL"); // throws`)
    ).resolves.toBeNull();
  });
});

describe("demonstratesUsage", () => {
  it("rejects a schema that is declared and never used", () => {
    expect(demonstratesUsage(`const User = JIT.object({ id: JIT.string() });`)).toBe(false);
  });

  it("rejects a compiled function that is never called", () => {
    expect(
      demonstratesUsage(`const User = JIT.object({ id: JIT.string() });
const isUser = JIT.validate.is(User);`)
    ).toBe(false);
  });

  it("accepts a compiled function called with data", () => {
    expect(
      demonstratesUsage(`const User = JIT.object({ id: JIT.string() });
const isUser = JIT.validate.is(User);
isUser({ id: "a" });`)
    ).toBe(true);
  });

  it("does not count a function's own declaration as a use of it", () => {
    expect(demonstratesUsage(`function build(value) { return JIT.object(value); }`)).toBe(false);
  });
});

describe("declaredNames", () => {
  it("reads names out of destructuring as well as plain bindings", () => {
    expect(declaredNames(`const User = JIT.object({});\nconst { success, issues } = result;`)).toEqual([
      "User",
      "success",
      "issues",
    ]);
  });
});

describe("prepareSource", () => {
  it("removes the import and the export keyword without touching the code", () => {
    expect(
      prepareSource(`import { JIT } from "@jit-compiler/jit/runtime";

export const User = JIT.object({});`)
    ).toContain("const User = JIT.object({});");
  });
});

describe("mainExample", () => {
  it("picks the longest block that uses the library", () => {
    const answer =
      "before\n```ts\nJIT.string();\n```\nafter\n```ts\nconst User = JIT.object({ id: JIT.string() });\n```";

    expect(mainExample(answer)).toContain("JIT.object");
  });

  it("ignores blocks that are not about jit", () => {
    expect(mainExample("```bash\npnpm add jit\n```")).toBeNull();
  });
});

describe("replaceMainExample", () => {
  it("swaps the block and says where the replacement came from", () => {
    const answer = "Here is how.\n\n```ts\nconst User = JIT.object({});\n```\n\nThat is it.";
    const swapped = replaceMainExample(answer, "const Verified = JIT.object({});", "From the docs.");

    expect(swapped).toContain("const Verified");
    expect(swapped).not.toContain("const User");
    expect(swapped).toContain("From the docs.");
    expect(swapped.indexOf("From the docs.")).toBeGreaterThan(swapped.indexOf("const Verified"));
  });
});

describe("describeFailure", () => {
  it("tells the reader what to do about it, not what category it is", () => {
    expect(describeFailure({ kind: "undeclared", name: "payload" })).toContain("payload");
    expect(describeFailure({ kind: "inert" })).toContain("call it with a value");
  });
});
