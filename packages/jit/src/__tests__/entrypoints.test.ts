import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT_ARTIFACT } from "../core/host.js";
import { JIT as DefineJIT } from "../define.js";
import { AOT } from "../index.js";
import { JIT as RuntimeJIT } from "../runtime.js";

describe("runtime and define entrypoints", () => {
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
