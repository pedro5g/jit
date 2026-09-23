import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AOT, JIT } from "../../index.js";
import { createArtifactToolCore } from "../artifact-tools.js";

function createArtifactRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "jit-agent-tools-"));
  const User = JIT.object({ id: JIT.number() });
  AOT.generate({
    artifacts: { isUser: JIT.validate.is(User) },
    schemas: { User },
    outDir: join(root, "generated"),
    format: "ts",
    emitManifest: true,
  });
  return root;
}

describe("AgentToolCore artifact lookup tools", () => {
  let root: string;

  beforeEach(() => {
    root = createArtifactRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("answers semantic lookup questions from a clean manifest", async () => {
    const core = createArtifactToolCore();
    const found = await core.execute("jit_artifact_find", { symbol: "User" }, { root });
    const described = await core.execute("jit_artifact_describe", { symbol: "isUser" }, { root });
    const status = await core.execute("jit_artifact_status", {}, { root });

    expect(found.data).toMatchObject({ status: "clean", matches: [{ export: "User", file: "index.ts" }] });
    expect(described.data).toMatchObject({
      status: "clean",
      symbol: { name: "isUser", capabilities: expect.arrayContaining(["is"]) },
    });
    expect(status.data).toMatchObject({
      status: "clean",
      artifactDigest: expect.any(String),
      manifestDigest: expect.any(String),
    });
  });

  it("refuses to treat modified metadata as current semantics", async () => {
    const sourcePath = join(root, "generated", "index.ts");
    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8")}\n// manual edit\n`);
    const result = await createArtifactToolCore().execute("jit_artifact_find", { symbol: "User" }, { root });

    expect(result.data).toMatchObject({ status: "modified", files: ["index.ts"] });
    expect(result.text).toContain("not authoritative");
  });
});

describe("AgentToolCore artifact materialization tools", () => {
  let root: string;

  beforeEach(() => {
    root = createArtifactRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("explains physical choices only when the manifest was built with a target", async () => {
    const Values = JIT.array(JIT.string()).length(5);
    AOT.generate({
      artifacts: { isValues: JIT.validate.is(Values) },
      outDir: join(root, "adaptive"),
      format: "ts",
      target: { profile: "v8-99" },
      emitManifest: true,
    });

    const explained = await createArtifactToolCore().execute(
      "jit_artifact_explain",
      { outDir: "adaptive", symbol: "isValues" },
      { root }
    );

    expect(explained.data).toMatchObject({
      status: "clean",
      physical: {
        target: "v8-99",
        decisions: [expect.objectContaining({ family: "array.validate", strategy: "unrolled" })],
      },
    });
  });

  it("materializes a clean tree and keeps the second write unchanged", async () => {
    const core = createArtifactToolCore();
    const first = await core.execute("jit_artifact_materialize", { targetDir: "materialized" }, { root });
    const second = await core.execute("jit_artifact_materialize", { targetDir: "materialized" }, { root });

    expect(first.data).toMatchObject({ status: "success", created: 3, updated: 0, unchanged: 0 });
    expect(second.data).toMatchObject({ status: "success", created: 0, updated: 0, unchanged: 3 });
    expect(readFileSync(join(root, "materialized", "index.ts"), "utf8")).toContain("export");
  });

  it("describes Runtime Class construction without reading its source", async () => {
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }));
    AOT.generate({ artifacts: { User }, outDir: join(root, "class"), format: "ts", emitManifest: true });

    const described = await createArtifactToolCore().execute(
      "jit_artifact_describe",
      { outDir: "class", symbol: "User" },
      { root }
    );

    expect(described.data).toMatchObject({
      status: "clean",
      symbol: {
        kind: "class",
        construction: "factory",
        factories: { create: "create", hydrate: "hydrate" },
      },
    });
  });
});
