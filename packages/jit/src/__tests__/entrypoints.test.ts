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
    const isUser = RuntimeJIT.validate(User).is().compile();

    expect(isUser({ id: 1 })).toBe(true);
    expectTypeOf<RuntimeJIT.Infer<typeof User>>().toEqualTypeOf<{ id: number }>();
  });

  it("should create typed AOT stubs that generate standalone output", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-define-entrypoint-"));

    try {
      const User = DefineJIT.object({ id: DefineJIT.number() });
      const isUser = DefineJIT.validate(User).is().compile();

      expect(AOT_ARTIFACT in isUser).toBe(true);
      expect(() => isUser({ id: 1 })).toThrow(/AOT artifacts cannot be executed/);

      AOT.generate({
        schemas: {},
        functions: { isUser },
        outDir,
      });

      const source = readFileSync(join(outDir, "index.mjs"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
        isUser: (value: unknown) => boolean;
      };

      expect(source).not.toContain('from "@pedro5g/jit"');
      expect(generated.isUser({ id: 1 })).toBe(true);
      expect(generated.isUser({ id: "1" })).toBe(false);
      expectTypeOf(isUser).toMatchTypeOf<(value: unknown) => value is DefineJIT.Infer<typeof User>>();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
