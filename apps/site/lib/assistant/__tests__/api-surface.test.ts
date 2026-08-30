import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";
import { describe, expect, it } from "vitest";
import { ApiSurface, type ApiSurfaceDocument, scanJitExpressions } from "../api-surface";
import { audit, unknownCliUsage, unknownNames } from "../audit";
import { repairTurn } from "../repair";
import type { DocsIndex } from "../types";

const publicDir = resolve(import.meta.dirname, "../../../public/assistant");
const document = JSON.parse(readFileSync(resolve(publicDir, "api-surface.json"), "utf8")) as ApiSurfaceDocument;
const index = JSON.parse(readFileSync(resolve(publicDir, "docs-index.json"), "utf8")) as DocsIndex;
const surface = new ApiSurface(document, index.methodsInDocs);

describe("the reflected surface", () => {
  it("matches the runtime exactly, at the top level", () => {
    expect(document.members.map((member) => member.name).sort()).toEqual(Object.keys(JIT).sort());
  });

  it("carries the namespace members that the flat list never had", () => {
    expect(surface.member("validate")?.members).toEqual(["async", "is", "issues", "parse", "safeParse"]);
    expect(surface.member("compare")?.members).toEqual(["changed", "diff", "equal", "hash"]);
    expect(surface.member("security")?.members).toEqual(["mask", "sanitize"]);
  });

  /**
   * The whole reason chain methods are read from builder/types.ts rather than
   * reflected: every builder shares one prototype, so `JIT.number().email` is a
   * function at runtime and a type error in an editor. Reflection would tell
   * the ghost `.email()` is fine on a number.
   */
  it("gates chain methods by schema kind, the way the types do", () => {
    expect(surface.chainFor("string")).toContain("email");
    expect(surface.chainFor("number")).not.toContain("email");

    expect(surface.chainFor("object")).toContain("pick");
    expect(surface.chainFor("string")).not.toContain("pick");

    expect(surface.chainFor("number")).toContain("multipleOf");
    expect(surface.chainFor("string")).not.toContain("multipleOf");
  });

  /**
   * A query builder is a function with methods hung off it, so reflection
   * reports every name as available on every builder and the audit could not
   * check the query chain at all. `JIT.cqrs` is the canonical query surface;
   * these are the names its readers actually type.
   */
  it("carries the CQRS query chain, which no schema kind gates", () => {
    const query = surface.chainFor("cqrs.query");

    expect(query).toContain("distinct");
    expect(query).toContain("join");
    expect(query).toContain("first");
    expect(query).toContain("aggregate");
    // `where` is the canonical spelling; `filter` is the node kind it builds.
    expect(query).toContain("where");

    expect(surface.chainFor("cqrs.join")).toEqual(["on"]);
    expect(surface.chainFor("cqrs.to")).toEqual(["asyncIterator", "iterator", "visitor"]);
  });

  it("reports nothing the documentation and the library disagree about", () => {
    expect(document.problems).toEqual([]);
  });
});

describe("scanJitExpressions", () => {
  it("separates a namespace member from the chain that follows", () => {
    const [expression] = scanJitExpressions("JIT.validate.safeParse(User)");

    expect(expression.root).toBe("validate");
    expect(expression.member).toBe("safeParse");
    expect(expression.calls).toEqual([]);
  });

  it("follows a chain past its arguments", () => {
    const [expression] = scanJitExpressions("JIT.string().min(3).max(120).email()");

    expect(expression.root).toBe("string");
    expect(expression.calls).toEqual(["min", "max", "email"]);
  });

  /**
   * A nested schema is its own expression, not a method of the outer one.
   * Reading `string` as a call on `object` would make every correct example
   * look wrong.
   */
  it("reads a nested schema as its own expression", () => {
    const found = scanJitExpressions("JIT.object({ email: JIT.string().email() }).strict()");

    expect(found.map((expression) => expression.root)).toEqual(["object", "string"]);
    expect(found[0].calls).toEqual(["strict"]);
    expect(found[1].calls).toEqual(["email"]);
  });

  it("steps over a bracket inside a string literal", () => {
    const [expression] = scanJitExpressions("JIT.string().regex(/[)]/).min(1)");

    expect(expression.calls).toEqual(["regex", "min"]);
  });
});

describe("the deep audit", () => {
  it("catches a namespace member the library does not have", () => {
    const { apis } = unknownNames("Use JIT.compare.deepEqual(User) and JIT.security.redact(User).", surface);

    expect(apis).toEqual(["JIT.compare.deepEqual", "JIT.security.redact"]);
  });

  it("catches a chain method the library does not have", () => {
    const { methods } = unknownNames("```ts\nJIT.string().notEmpty()\n```", surface);

    expect(methods).toEqual([".notEmpty()"]);
  });

  /**
   * `const result = await user.evaluateAll()` never touches a `JIT.` chain, so the
   * expression walk cannot see it — and it is the exact shape of the answer
   * that started this work. The method has to be one the library really does
   * not have: `.run()` used to serve here and is now a rules result mode.
   */
  it("catches a method invented on a local variable inside a jit example", () => {
    const { methods } = unknownNames(
      "```ts\nconst User = JIT.object({});\nconst result = await user.evaluateAll();\n```",
      surface
    );

    expect(methods).toEqual([".evaluateAll()"]);
  });

  it("passes an answer that only uses real names", () => {
    const answer = [
      "```ts",
      "const User = JIT.object({ email: JIT.string().email(), age: JIT.number().int().min(0) });",
      "const isUser = JIT.validate.is(User);",
      "const same = JIT.compare.equal(User);",
      "const safe = JIT.security.mask(User);",
      "const doc = JIT.jsonSchema.to(User);",
      "```",
    ].join("\n");

    expect(unknownNames(answer, surface)).toEqual({ apis: [], methods: [] });
  });

  it("catches an invented CLI flag", () => {
    expect(unknownCliUsage("Run `jit --version` to check.", [])).toEqual(["jit --version"]);
  });

  /**
   * The check that has to be silent. Portuguese prose about the library is
   * full of `jit` followed by a verb — "jit compila o schema", "jit não
   * interpreta" — and reading those as subcommands produces confident nonsense
   * about the library's own documentation.
   */
  it("does not read Portuguese prose as a command", () => {
    expect(unknownCliUsage("A jit compila o schema uma vez; jit não interpreta nada em runtime.", [])).toEqual([]);
    expect(unknownCliUsage("uma mudança é reportada por `jit list` e ignorada depois", [])).toEqual([]);
  });

  it("accepts every real subcommand", () => {
    expect(unknownCliUsage("```bash\npnpm jit generate\njit init\n```", [])).toEqual([]);
  });
});

/**
 * The strongest guarantee available: every example the documentation itself
 * ships is an answer the ghost could legitimately write, so none of them may
 * trip the audit. The migration guide is excluded because teaching removed
 * names is its entire subject.
 */
describe("no false positives against the documentation", () => {
  // Read from the MDX rather than the index: the index flattens code into
  // prose, and the audit's whole design depends on telling the two apart.
  const contentDir = resolve(import.meta.dirname, "../../../content/docs");

  function mdxFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) mdxFiles(path, found);
      else if (entry.name.endsWith(".mdx")) found.push(path);
    }
    return found;
  }

  const examples = mdxFiles(contentDir).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const historical = /migrating-to-2|whats-new/.test(file);

    return [...source.matchAll(/```(ts|tsx|typescript|js|javascript)\n([\s\S]*?)```/g)]
      .map((match) => ({ file, code: match[2] ?? "", historical }))
      .filter((example) => /\bJIT\./.test(example.code));
  });

  const current = examples.filter((example) => !example.historical);

  it("has a real corpus of examples to check", () => {
    expect(current.length).toBeGreaterThan(100);
  });

  it("flags nothing in any current jit example", () => {
    const offenders: string[] = [];

    for (const example of current) {
      const findings = audit(`Here:\n\n\`\`\`ts\n${example.code}\n\`\`\``, {
        api: index.api,
        sections: [],
        concepts: [],
        surface,
      });

      for (const finding of findings) {
        if (finding.kind === "invented-api" || finding.kind === "invented-method" || finding.kind === "invented-cli") {
          offenders.push(`${example.file}: ${finding.names.join(", ")}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The other half of the guarantee: silence on correct examples would be
   * worthless if it were silence on everything. The migration guide teaches
   * removed names on purpose, and every one of them must still be caught.
   */
  it("still catches the removed APIs the migration guide teaches", () => {
    const historical = examples.filter((example) => example.historical);
    expect(historical.length).toBeGreaterThan(0);

    const caught = new Set<string>();
    for (const example of historical) {
      const { apis } = unknownNames(`\`\`\`ts\n${example.code}\n\`\`\``, surface);
      for (const name of apis) caught.add(name);
    }

    expect(caught).toContain("JIT.validator");
    expect(caught).toContain("JIT.mapper");
  });
});

describe("repairTurn", () => {
  it("says nothing when the answer passed", () => {
    expect(repairTurn("all good", [], surface)).toBeNull();
  });

  /**
   * The correction has to name the alternative, not just the mistake. A small
   * model told only "that is wrong" reaches for a second invention.
   */
  it("names what was wrong and what the valid methods are", () => {
    const answer = "```ts\nJIT.string().notEmpty()\n```";
    const findings = audit(answer, {
      api: index.api,
      sections: [],
      concepts: [],
      surface,
    });
    const correction = repairTurn(answer, findings, surface);

    expect(correction).toContain(".notEmpty()");
    expect(correction).toContain("noEmpty");
    expect(correction).toContain("Write the answer again");
  });

  it("does not carry a method list when the problem was a contradiction", () => {
    const correction = repairTurn("it is slower", [{ kind: "contradiction", claim: "jit compiles once" }], surface);

    expect(correction).toContain("jit compiles once");
    expect(correction).not.toContain("Every method");
  });
});
