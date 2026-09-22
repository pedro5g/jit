import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { AOT, JIT } from "../../index.js";
import { createArtifactBundleMetadata } from "../artifact-bundle.js";
import { createArtifactManifestIndex, inspectArtifactStatus, sha256 } from "../artifact-manifest.js";
import {
  type ArtifactModule,
  createArtifactProgram,
  relativeModuleImport,
  topologicalModuleOrder,
} from "../artifact-program.js";
import { SemanticNameAllocator } from "../semantic-name.js";

function useTemporaryOutput(): () => string {
  let outDir = "";
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-artifact-contract-"));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });
  return () => outDir;
}

describe("sovereign artifact program and naming", () => {
  it("validates a module graph and orders dependencies without reading source", () => {
    const modules: ArtifactModule[] = [
      {
        id: "user",
        path: "domain/user.ts",
        dependencies: [{ module: "id", symbols: ["id:UserId"] }],
        declarations: [{ name: "User", kind: "class", symbolId: "user:User" }],
        exports: [{ name: "User", symbolId: "user:User", typeOnly: false }],
      },
      {
        id: "id",
        path: "domain/id.ts",
        dependencies: [],
        declarations: [{ name: "UserId", kind: "type", symbolId: "id:UserId" }],
        exports: [{ name: "UserId", symbolId: "id:UserId", typeOnly: true }],
      },
    ];
    const program = createArtifactProgram({
      modules,
      symbols: [
        {
          id: "user:User",
          name: "User",
          kind: "class",
          module: "user",
          exportName: "User",
          declaration: "User",
          capabilities: [],
          protocols: [],
          dependencies: ["id:UserId"],
          effects: [],
        },
        {
          id: "id:UserId",
          name: "UserId",
          kind: "type",
          module: "id",
          exportName: "UserId",
          declaration: "UserId",
          capabilities: ["type"],
          protocols: [],
          dependencies: [],
          effects: [],
        },
      ],
    });

    expect(topologicalModuleOrder(program).map((module) => module.id)).toEqual(["id", "user"]);
    expect(relativeModuleImport("domain/user.ts", "domain/id.ts")).toBe("./id.ts");
    expect(() =>
      createArtifactProgram({
        ...program,
        modules: program.modules.map((module) => ({
          ...module,
          dependencies: module.id === "id" ? [{ module: "user", symbols: [] }] : module.dependencies,
        })),
      })
    ).toThrow(/cycle/);
  });

  it("keeps the manifest digest algorithm portable across Node and browser hosts", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("á🙂")).toBe("52cd59e7686ec46ad758919f8c0187d76cf3b2dc3fcc678493b2a161ea565f2c");
  });

  it("allocates deterministic semantic names while preserving compact names", () => {
    const compact = new SemanticNameAllocator("compact");
    compact.reserve("module", "value");
    expect(compact.allocate({ role: "temporary", preferred: "value", scope: "module" })).toBe("value_1");

    const semantic = new SemanticNameAllocator("semantic");
    expect(semantic.allocate({ role: "temporary", path: ["user", "name"], scope: "module" })).toBe("userName");
    expect(semantic.allocate({ role: "temporary", path: ["company", "name"], scope: "module" })).toBe("companyName");
    expect(semantic.allocate({ role: "temporary", preferred: "class", scope: "module" })).toBe("class_1");
  });
});

describe("sovereign artifact manifest drift", () => {
  const outputDir = useTemporaryOutput();

  it("emits a hash-bound manifest and detects managed file drift", () => {
    const outDir = outputDir();
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const result = AOT.generate({
      artifacts: { isUser: JIT.validate.is(User), parseUser: JIT.validate.parse(User) },
      schemas: { User },
      outDir,
      format: "ts",
      emitManifest: true,
    });

    expect(result.manifest?.manifestVersion).toBe(1);
    expect(result.manifest?.ownership).toBe("managed");
    expect(result.manifest?.symbols.map((symbol) => symbol.name)).toEqual(["User", "isUser", "parseUser"]);
    expect(result.receipt?.manifestDigest).toBe(result.manifest?.manifestDigest);
    expect(existsSync(join(outDir, "jit.manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "jit.receipt.json"))).toBe(true);
    expect(inspectArtifactStatus(outDir).status).toBe("clean");

    const manifestPath = join(outDir, "jit.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      readonly files: readonly { readonly exports: readonly string[] }[];
    };
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, files: [{ ...manifest.files[0], exports: ["missing"] }] })}\n`
    );
    expect(inspectArtifactStatus(outDir)).toMatchObject({ status: "stale" });
    AOT.generate({
      artifacts: { isUser: JIT.validate.is(User), parseUser: JIT.validate.parse(User) },
      schemas: { User },
      outDir,
      format: "ts",
      emitManifest: true,
    });

    const sourcePath = join(outDir, "index.ts");
    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8")}\n`);
    expect(inspectArtifactStatus(outDir)).toMatchObject({ status: "modified", files: ["index.ts"] });

    writeFileSync(join(outDir, "orphan.ts"), "// Generated by jit — do not edit.\nexport const orphan = true;\n");
    expect(inspectArtifactStatus(outDir)).toMatchObject({
      status: "modified",
      files: ["index.ts", "orphan.ts"],
      reason: "generated file is not declared in the manifest",
    });

    writeFileSync(join(outDir, "jit.manifest.json"), "not json\n");
    expect(inspectArtifactStatus(outDir)).toMatchObject({ status: "stale" });
    AOT.generate({ artifacts: { isUser: JIT.validate.is(User) }, schemas: { User }, outDir, emitManifest: true });

    const receiptPath = join(outDir, "jit.receipt.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, declarationDigest: "0".repeat(64) })}\n`);
    expect(inspectArtifactStatus(outDir)).toMatchObject({
      status: "stale",
      reason: "receipt does not match the manifest",
    });
  });
});

describe("sovereign artifact manifest indexes", () => {
  const outputDir = useTemporaryOutput();

  it("derives deterministic forward and reverse lookup indexes from the manifest", () => {
    const outDir = outputDir();
    const UserId = JIT.string().uuid();
    const User = JIT.object({ id: UserId });
    const result = AOT.generate({
      artifacts: { isUser: JIT.validate.is(User) },
      schemas: { UserId, User },
      outDir,
      format: "ts",
      emitManifest: true,
    });

    const index = createArtifactManifestIndex(result.manifest!);
    expect(index.declarationToSymbols.User).toEqual(["index:User"]);
    expect(index.symbolToFile["index:User"]).toBe("index.ts");
    expect(index.symbolToDependencies["index:User"]).toEqual(["index:UserId"]);
    expect(index.symbolConsumers["index:UserId"]).toEqual(["index:User"]);
    expect(index.typeToUsers.UserId).toEqual(["index:User"]);
  });
});

describe("sovereign artifact naming determinism", () => {
  it("keeps semantic naming deterministic across separate output trees", () => {
    const User = JIT.object({ id: JIT.number() });
    const first = mkdtempSync(join(tmpdir(), "jit-artifact-naming-a-"));
    const second = mkdtempSync(join(tmpdir(), "jit-artifact-naming-b-"));

    try {
      AOT.generate({ artifacts: { isUser: JIT.validate.is(User) }, outDir: first, naming: "semantic" });
      AOT.generate({ artifacts: { isUser: JIT.validate.is(User) }, outDir: second, naming: "semantic" });
      expect(readFileSync(join(first, "index.js"), "utf8")).toBe(readFileSync(join(second, "index.js"), "utf8"));
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});

describe("sovereign artifact bundle metadata", () => {
  it("merges independently compiled units and binds the final file paths", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "jit-artifact-bundle-a-"));
    const secondDir = mkdtempSync(join(tmpdir(), "jit-artifact-bundle-b-"));

    try {
      const first = AOT.generate({
        artifacts: { isUser: JIT.validate.is(JIT.object({ id: JIT.number() })) },
        outDir: firstDir,
        format: "ts",
        emitManifest: true,
      });
      const second = AOT.generate({
        artifacts: { isAccount: JIT.validate.is(JIT.object({ id: JIT.number() })) },
        outDir: secondDir,
        format: "ts",
        emitManifest: true,
      });
      const file = (directory: string, path: string) => readFileSync(join(directory, path), "utf8");
      const metadata = createArtifactBundleMetadata(
        [
          {
            key: "user.jit.ts",
            manifest: first.manifest!,
            receipt: first.receipt!,
            fileMap: { "index.ts": "user.ts" },
          },
          {
            key: "account.jit.ts",
            manifest: second.manifest!,
            receipt: second.receipt!,
            fileMap: { "index.ts": "account.ts" },
          },
        ],
        [
          {
            path: "user.ts",
            hash: sha256(file(firstDir, "index.ts")),
            bytes: Buffer.byteLength(file(firstDir, "index.ts")),
            exports: [],
            imports: [],
          },
          {
            path: "account.ts",
            hash: sha256(file(secondDir, "index.ts")),
            bytes: Buffer.byteLength(file(secondDir, "index.ts")),
            exports: [],
            imports: [],
          },
        ],
        { ownership: "managed", format: "ts", naming: "compact" }
      );

      expect(metadata.manifest.files.map((file) => file.path)).toEqual(["account.ts", "user.ts"]);
      expect(metadata.manifest.symbols.map((symbol) => symbol.id)).toEqual([
        "account.jit.ts:index:isAccount",
        "user.jit.ts:index:isUser",
      ]);
      expect(metadata.receipt.files).toBe(2);
      expect(metadata.receipt.manifestDigest).toBe(metadata.manifest.manifestDigest);
    } finally {
      rmSync(firstDir, { recursive: true, force: true });
      rmSync(secondDir, { recursive: true, force: true });
    }
  });
});

describe("sovereign artifact metadata paths", () => {
  const outputDir = useTemporaryOutput();

  it("creates metadata directories only inside the requested output", () => {
    const outDir = outputDir();
    mkdirSync(outDir, { recursive: true });
    const User = JIT.object({ id: JIT.number() });
    AOT.generate({
      artifacts: { isUser: JIT.validate.is(User) },
      outDir,
      emitManifest: true,
      manifestPath: "metadata/jit.manifest.json",
      receiptPath: "metadata/jit.receipt.json",
    });

    expect(existsSync(join(outDir, "metadata", "jit.manifest.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, "metadata", "jit.manifest.json"), "utf8")).manifestVersion).toBe(1);
  });
});

describe("sovereign artifact protocol adapters", () => {
  const outputDir = useTemporaryOutput();

  it("emits selected protocol adapters and portable error names structurally", () => {
    const outDir = outputDir();
    const User = JIT.object({ id: JIT.number().int() });
    const result = AOT.generate({
      artifacts: { parseUser: JIT.validate.parse(User) },
      outDir,
      format: "js",
      portableErrors: true,
      protocols: {
        parseUser: [{ protocol: "standard-schema/v1", version: 1, input: "unknown", output: "User" }],
      },
      emitManifest: true,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");

    expect(result.skipped).toEqual([]);
    expect(source).toContain('"~standard"');
    expect(source).toContain("class ValidationError extends Error");
    expect(source).not.toContain("JITValidationError");
    expect(result.manifest?.symbols.find((symbol) => symbol.name === "parseUser")?.protocols).toEqual([
      "standard-schema/v1",
    ]);
  });
});

describe("sovereign artifact Runtime Class descriptions", () => {
  const outputDir = useTemporaryOutput();

  it("records the construction boundary and canonical factories", () => {
    const outDir = outputDir();
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }));
    const result = AOT.generate({ artifacts: { User }, outDir, format: "ts", emitManifest: true });
    const symbol = result.manifest?.symbols.find((candidate) => candidate.name === "User");

    expect(symbol).toMatchObject({
      kind: "class",
      construction: "factory",
      factories: { create: "create", hydrate: "hydrate" },
    });
  });

  it("materializes nested Runtime Types through graph-derived module imports", () => {
    const outDir = outputDir();
    const UserId = JIT.ddd.uniqueIdentifier(JIT.string());
    const User = JIT.ddd.entity(JIT.object({ id: UserId }));
    const result = AOT.generate({
      artifacts: { UserId, User },
      outDir,
      format: "ts",
      perFile: true,
      modulePaths: { UserId: "domain/value-objects/UserId", User: "domain/entities/User" },
      emitManifest: true,
    });
    const source = readFileSync(join(outDir, "domain/entities/User.ts"), "utf8");

    expect(result.skipped).toEqual([]);
    expect(source).toContain('from "../value-objects/UserId.js"');
    expect(result.program?.modules.find((module) => module.id === "domain/entities/User")?.dependencies).toEqual([
      expect.objectContaining({ module: "domain/value-objects/UserId" }),
    ]);
    const program = ts.createProgram(
      [
        join(outDir, "domain/value-objects/UserId.ts"),
        join(outDir, "domain/entities/User.ts"),
        join(outDir, "index.ts"),
      ],
      {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
      }
    );
    expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
  }, 15_000);
});

describe("sovereign artifact typed TypeScript", () => {
  const outputDir = useTemporaryOutput();

  it("emits standalone TypeScript without ts-nocheck", () => {
    const outDir = outputDir();
    const User = JIT.object({ id: JIT.number().int(), name: JIT.string().toCamelCase() });
    AOT.generate({
      artifacts: { isUser: JIT.validate.is(User), parseUser: JIT.validate.parse(User) },
      schemas: { User },
      outDir,
      format: "ts",
      portableErrors: true,
    });

    const sourcePath = join(outDir, "index.ts");
    expect(readFileSync(sourcePath, "utf8")).not.toContain("@ts-nocheck");
    const program = ts.createProgram([sourcePath], {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 10_000);
});

describe("sovereign artifact case parity", () => {
  const outputDir = useTemporaryOutput();

  it("keeps case transforms behaviorally identical between runtime and AOT", async () => {
    const outDir = outputDir();
    const schema = JIT.string().toCamelCase();
    const runtimeParse = JIT.validate.parse(schema);
    AOT.generate({
      artifacts: { parseCase: runtimeParse, isCase: JIT.validate.is(schema) },
      outDir,
      format: "js",
    });

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly parseCase: (value: unknown) => string;
      readonly isCase: (value: unknown) => boolean;
    };
    expect(generated.parseCase("user_name")).toBe(runtimeParse("user_name"));
    expect(generated.isCase("user_name")).toBe(true);
    expect(readFileSync(join(outDir, "index.js"), "utf8")).toContain("__caseTransform");
  });
});

describe("sovereign artifact JSON protocol", () => {
  const outputDir = useTemporaryOutput();

  it("keeps Standard JSON Schema separate from callable Standard Schema", () => {
    const outDir = outputDir();
    const User = JIT.object({ id: JIT.number() });
    const result = AOT.generate({
      artifacts: { UserJson: JIT.jsonSchema.to(User) },
      outDir,
      protocols: {
        UserJson: [{ protocol: "standard-json-schema/v1", version: 1, input: "schema", output: "json-schema" }],
      },
      emitManifest: true,
    });

    expect(result.skipped).toEqual([]);
    expect(result.manifest?.protocols).toEqual([
      {
        protocol: "standard-json-schema/v1",
        version: 1,
        input: "schema",
        output: "json-schema",
        symbols: ["index:UserJson"],
      },
    ]);
    expect(readFileSync(join(outDir, "index.js"), "utf8")).not.toContain('"~standard"');
  });
});
