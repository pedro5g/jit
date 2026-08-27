import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expectTypeOf } from "vitest";

import { JIT as DefineJIT } from "../../define.js";
import { AOT, Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const UserV1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });
const UserV2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string() });
const UserV3 = JIT.object({ version: JIT.literal(3), displayName: JIT.string(), active: JIT.boolean() });

const migration = JIT.migrate(UserV1)
  .to(UserV2, { fullName: { from: "name" } })
  .to(UserV3, { displayName: { from: "fullName" }, active: { default: true } });

function sourceOf(value: object): string {
  const artifact = getArtifact(value);

  if (artifact?.kind !== "migration-plan") throw new Error("migration plan not registered");
  return Compiler.emitMigrationSource(artifact.descriptor);
}

describe("JIT.migrate", () => {
  it("dispatches once and applies only the remaining mapper edges", () => {
    expect(migration({ version: 1, name: "Ada" })).toEqual({ version: 3, displayName: "Ada", active: true });
    expect(migration({ version: 2, fullName: "Grace" })).toEqual({
      version: 3,
      displayName: "Grace",
      active: true,
    });

    const current = { version: 3 as const, displayName: "Lin", active: false };

    expect(migration(current)).toBe(current);
  });

  it("keeps the complete version union in its input type and the current schema in its output", () => {
    type V1 = JIT.Typeof<typeof UserV1>;
    type V2 = JIT.Typeof<typeof UserV2>;
    type V3 = JIT.Typeof<typeof UserV3>;

    expectTypeOf(migration).parameter(0).toEqualTypeOf<V1 | V2 | V3>();
    expectTypeOf(migration).returns.toEqualTypeOf<V3>();
  });

  it("rejects unsupported versions and invalid migration schemas", () => {
    expect(() => migration({ version: 0, name: "old" } as never)).toThrow(/unsupported migration version/);
    expect(() => JIT.migrate(JIT.object({ id: JIT.number() }))).toThrow(/literal "version" field/);
    expect(() => JIT.migrate(UserV1).to(UserV1)).toThrow(/repeats version 1/);
  });

  it("emits a switch with mapper fallthrough and no runtime walker", () => {
    const source = sourceOf(migration);

    expect(source).toContain("switch (value.version)");
    expect(source).toContain("value = migrateEdge0(value);");
    expect(source).toContain("value = migrateEdge1(value);");
    expect(source).not.toContain("for (");
    expect(migration.explain()).toEqual({
      strategy: "VersionSwitch",
      versions: [1, 2, 3],
      passes: 2,
      complexity: "O(remaining edges)",
    });
  });

  it("has runtime/define/AOT semantic parity", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-migration-"));
    const DV1 = DefineJIT.object({ version: DefineJIT.literal(1), name: DefineJIT.string() });
    const DV2 = DefineJIT.object({ version: DefineJIT.literal(2), fullName: DefineJIT.string() });
    const DV3 = DefineJIT.object({
      version: DefineJIT.literal(3),
      displayName: DefineJIT.string(),
      active: DefineJIT.boolean(),
    });
    const defined = DefineJIT.migrate(DV1)
      .to(DV2, { fullName: { from: "name" } })
      .to(DV3, { displayName: { from: "fullName" }, active: { default: true } });

    try {
      expect(() => defined({ version: 1, name: "Ada" })).toThrow(/AOT artifacts cannot be executed/);
      const result = AOT.generate({ artifacts: { migration: defined }, outDir });
      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        readonly migration: typeof migration;
      };

      expect(result.skipped).toHaveLength(0);
      expect(source).toContain("switch (value.version)");
      expect(source).not.toContain("@jit-compiler/jit");
      expect(generated.migration({ version: 1, name: "Ada" })).toEqual(migration({ version: 1, name: "Ada" }));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
