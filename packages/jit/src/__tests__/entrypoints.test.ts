import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT_ARTIFACT } from "../core/host.js";
import { JIT as DefineJIT } from "../define.js";
import { AOT } from "../index.js";
import { getArtifact } from "../runtime/artifact-registry.js";
import { JIT as RuntimeJIT } from "../runtime.js";

type UnknownArtifact = (...args: unknown[]) => unknown;

interface ApiParityCase {
  readonly name: string;
  readonly runtime: UnknownArtifact;
  readonly define: UnknownArtifact;
  readonly args: readonly unknown[];
}

function normalizeArtifactResult(value: unknown): unknown {
  return value !== null && typeof value === "object" && Symbol.iterator in value
    ? [...(value as Iterable<unknown>)]
    : value;
}

describe("runtime and define entrypoints", () => {
  it("should keep the public namespace shape one-to-one", () => {
    expect(Object.keys(DefineJIT).sort()).toEqual(Object.keys(RuntimeJIT).sort());

    for (const namespace of ["binary", "compare", "cqrs", "json", "security", "validate"] as const) {
      expect(Object.keys(DefineJIT[namespace]).sort(), namespace).toEqual(Object.keys(RuntimeJIT[namespace]).sort());
    }
  });

  it("should verify registered runtime/define/AOT operations through one parity matrix", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-api-parity-"));
    const RuntimeUser = RuntimeJIT.object({ id: RuntimeJIT.number(), name: RuntimeJIT.string() });
    const DefineUser = DefineJIT.object({ id: DefineJIT.number(), name: DefineJIT.string() });
    const RuntimeUsers = RuntimeJIT.array(RuntimeUser);
    const DefineUsers = DefineJIT.array(DefineUser);
    const value = { id: 1, name: "Ada" };
    const equalValue = { id: 1, name: "Ada" };

    const cases: readonly ApiParityCase[] = [
      {
        name: "isUser",
        runtime: RuntimeJIT.validate.is(RuntimeUser) as UnknownArtifact,
        define: DefineJIT.validate.is(DefineUser) as UnknownArtifact,
        args: [value],
      },
      {
        name: "equalUser",
        runtime: RuntimeJIT.compare.equal(RuntimeUser) as UnknownArtifact,
        define: DefineJIT.compare.equal(DefineUser) as UnknownArtifact,
        args: [value, equalValue],
      },
      {
        name: "cloneUser",
        runtime: RuntimeJIT.clone(RuntimeUser) as UnknownArtifact,
        define: DefineJIT.clone(DefineUser) as UnknownArtifact,
        args: [value],
      },
      {
        name: "stringifyUser",
        runtime: RuntimeJIT.json.stringify(RuntimeUser) as UnknownArtifact,
        define: DefineJIT.json.stringify(DefineUser) as UnknownArtifact,
        args: [value],
      },
      {
        name: "stringifyUserChunks",
        runtime: RuntimeJIT.json.stringifyChunks(RuntimeUsers, { chunkBytes: 8 }) as UnknownArtifact,
        define: DefineJIT.json.stringifyChunks(DefineUsers, { chunkBytes: 8 }) as UnknownArtifact,
        args: [[value, equalValue]],
      },
    ];

    try {
      for (const parityCase of cases) {
        expect(getArtifact(parityCase.runtime), `${parityCase.name} runtime metadata`).toBeDefined();
        expect(getArtifact(parityCase.define), `${parityCase.name} define metadata`).toBeDefined();
        expect(AOT_ARTIFACT in parityCase.define, `${parityCase.name} define stub`).toBe(true);
        expect(() => parityCase.define(...parityCase.args), `${parityCase.name} define execution`).toThrow(
          /AOT artifacts cannot be executed/
        );
      }

      AOT.generate({
        artifacts: Object.fromEntries(cases.map((parityCase) => [parityCase.name, parityCase.define])),
        outDir,
      });

      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as Readonly<
        Record<string, UnknownArtifact>
      >;

      expect(source).toContain("function* stringifyChunks(value)");
      expect(source).toContain("chunk.length + part.length > 8");
      expect(source).not.toContain('from "@jit-compiler/jit"');

      for (const parityCase of cases) {
        expect(
          normalizeArtifactResult(generated[parityCase.name](...parityCase.args)),
          `${parityCase.name} AOT result`
        ).toEqual(normalizeArtifactResult(parityCase.runtime(...parityCase.args)));
      }

      const chunksCase = cases.find((parityCase) => parityCase.name === "stringifyUserChunks");
      expect(chunksCase).toBeDefined();
      AOT.generate({ artifacts: { stringifyUserChunks: chunksCase?.define }, outDir, format: "ts" });
      expect(readFileSync(join(outDir, "index.ts"), "utf8")).toContain("=> IterableIterator<string>");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should expose the runtime JIT namespace", () => {
    const User = RuntimeJIT.object({ id: RuntimeJIT.number() });
    const isUser = RuntimeJIT.validate.is(User);

    expect(isUser({ id: 1 })).toBe(true);
    expectTypeOf<RuntimeJIT.Typeof<typeof User>>().toEqualTypeOf<{ id: number }>();
  });

  it("should create typed AOT stubs that generate standalone output", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-define-entrypoint-"));

    try {
      const User = DefineJIT.object({ id: DefineJIT.number() });
      const isUser = DefineJIT.validate.is(User);

      expect(AOT_ARTIFACT in isUser).toBe(true);
      expect(() => isUser({ id: 1 })).toThrow(/AOT artifacts cannot be executed/);

      AOT.generate({
        artifacts: { isUser },
        outDir,
      });

      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        isUser: (value: unknown) => boolean;
      };

      expect(source).not.toContain('from "@jit-compiler/jit"');
      expect(generated.isUser({ id: 1 })).toBe(true);
      expect(generated.isUser({ id: "1" })).toBe(false);
      expectTypeOf(isUser).toMatchTypeOf<(value: unknown) => value is DefineJIT.Typeof<typeof User>>();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should keep composed definition pipelines non-executable until AOT lowering", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-define-pipeline-"));

    try {
      const User = DefineJIT.object({ id: DefineJIT.number(), active: DefineJIT.boolean() });
      const activeUsers = DefineJIT.json
        .parse(DefineJIT.array(User))
        .validate()
        .filter((query) => query.eq("active", true))
        .select("id")
        .to.json();

      expect(() => activeUsers('[{"id":1,"active":true}]')).toThrow(/AOT artifacts cannot be executed/);

      AOT.generate({ schemas: {}, artifacts: { activeUsers }, outDir });

      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        activeUsers: (json: string) => string;
      };

      expect(generated.activeUsers('[{"id":1,"active":true},{"id":2,"active":false}]')).toBe('[{"id":1}]');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should preserve transform, update, and security stages in definition pipelines", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-define-full-pipeline-"));

    try {
      const User = DefineJIT.object({
        id: DefineJIT.number(),
        role: DefineJIT.enum(["admin", "member"] as const),
        name: DefineJIT.string(),
        email: DefineJIT.string().pii("mask"),
        note: DefineJIT.string().sanitize(),
      });
      const publicUsers = DefineJIT.json
        .parse(DefineJIT.array(User))
        .validate()
        .transform(User, { name: (name) => name.trim().toUpperCase() })
        .update({ name: "PUBLIC" })
        .sanitize()
        .mask()
        .filter((query) => query.eq("role", "admin"))
        .select("id", "name", "email", "note")
        .to.json();

      AOT.generate({ schemas: {}, artifacts: { publicUsers }, outDir });

      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        publicUsers: (json: string) => string;
      };

      expect(
        generated.publicUsers('[{"id":1,"role":"admin","name":" Ada ","email":"ada@math.org","note":"<b>ok</b>"}]')
      ).toBe('[{"id":1,"name":"PUBLIC","email":"***.org","note":"ok"}]');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
