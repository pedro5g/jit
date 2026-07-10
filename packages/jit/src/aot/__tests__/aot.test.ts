import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";

describe("JIT model namespace", () => {
  const User = JIT.model(
    JIT.object({
      id: JIT.number().int().positive(),
      name: JIT.string().min(2),
      email: JIT.string().pii("mask"),
      tags: JIT.array(JIT.string()),
    })
  );

  const ada = { id: 1, name: "Ada", email: "ada@math.org", tags: ["math"] };

  it("should expose every compiled operation lazily from one namespace", () => {
    expect(User.is(ada)).toBe(true);
    expect(User.is({ ...ada, id: 0 })).toBe(false);
    expect(User.parse(ada)).toBe(ada);
    expect(User.safeParse({ ...ada, name: "A" }).success).toBe(false);
    expect(User.equal(ada, { ...ada })).toBe(true);
    expect(User.clone(ada)).toEqual(ada);
    expect(User.clone(ada)).not.toBe(ada);
    expect(User.diff(ada, { ...ada, name: "Grace" })).toHaveLength(1);
    expect(User.hash(ada)).toBe(User.hash({ ...ada }));
    expect(User.update(ada, { name: "Ada L." }).name).toBe("Ada L.");
    expect(User.stringify(ada)).toBe(JSON.stringify(ada));
    expect(User.fromJSON(JSON.stringify(ada))).toEqual(ada);
    expect(User.mask(ada).email).toBe("***.org");
    expect(User.codec.decode(User.codec.encode(ada))).toEqual(ada);
    expect(User.schema.type).toBe("object");
  });

  it("should only throw for unsupported operations when accessed", () => {
    const WithMap = JIT.model(JIT.object({ meta: JIT.map(JIT.string(), JIT.number()) }));

    expect(WithMap.mask).toBeTypeOf("function");
    expect(WithMap.codec.decode(WithMap.codec.encode({ meta: new Map([["a", 1]]) }))).toEqual({
      meta: new Map([["a", 1]]),
    });
    expect(() => WithMap.stringify).toThrow(/serialize/);
  });
});

describe("JIT AOT generate", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should generate a standalone runnable module for callback-free operations", async () => {
    // A refine callback skips the validator, keeping the module import-free.
    const Event = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      target: JIT.string().pii(),
      body: JIT.string().sanitize(),
      at: JIT.date(),
    }).refine(() => true);

    const result = AOT.generate({ schemas: { Event }, outDir });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");

    expect(source).not.toContain('from "jit"');
    expect(result.skipped.map((skip) => skip.operation)).toContain("validator");

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      Event_equal: (left: unknown, right: unknown) => boolean;
      Event_clone: <T>(value: T) => T;
      Event_stringify: (value: unknown) => string;
      Event_mask: <T>(value: T) => T;
      Event_sanitize: <T>(value: T) => T;
      Event_codec: { encode: (value: unknown) => Uint8Array; decode: (bytes: Uint8Array) => unknown };
    };

    const event = {
      id: 7,
      kind: "click" as const,
      target: "secret-target",
      body: "<script>x()</script>hello",
      at: new Date("2026-07-05T00:00:00.000Z"),
    };

    expect(generated.Event_equal(event, { ...event })).toBe(true);
    expect(generated.Event_clone(event)).toEqual(event);
    expect(generated.Event_stringify(event)).toBe(JSON.stringify(event));
    expect(generated.Event_mask(event).target).toBe("***");
    expect(generated.Event_sanitize(event).body).toBe("hello");
    expect(generated.Event_codec.decode(generated.Event_codec.encode(event))).toEqual(event);
  });

  it("should generate validator flat exports with inlined regex bindings", () => {
    const User = JIT.object({
      id: JIT.number().int(),
      email: JIT.string().email(),
      plan: JIT.string().default("free"),
    });

    const result = AOT.generate({ schemas: { User }, outDir, packageName: "@acme/models" });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");
    const manifest = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8")) as { name: string; type: string };

    expect(result.skipped.filter((skip) => skip.operation === "validator")).toHaveLength(0);
    expect(source).toContain("const User_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("function is(value)");
    expect(source).toContain("function safeParse(value)");
    expect(source).toContain("class JITValidationError extends Error");
    expect(source).not.toContain("import ");
    expect(source).toContain("const User_is = /*#__PURE__*/ ((v) => v.is)(User_validator);");
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");

    expect(types).toContain("export type User =");
    expect(types).toContain("id: number");
    expect(types).toContain("plan?: string");
    expect(types).toContain("value is User");
    expect(types).toContain("export declare const User_is");
    expect(types).not.toContain("export declare const User: {");

    expect(manifest.name).toBe("@acme/models");
    expect(manifest.type).toBe("module");
  });

  it("should report skipped operations with reasons instead of failing", () => {
    const Weird = JIT.object({
      meta: JIT.map(JIT.string(), JIT.number()),
      hook: JIT.string().refine((value) => value.length > 0),
      open: JIT.any(),
    });

    const result = AOT.generate({ schemas: { Weird }, outDir });
    const operations = result.skipped.map((skip) => `${skip.schema}.${skip.operation}`);

    expect(operations).toContain("Weird.validator");
    expect(operations).toContain("Weird.stringify");
    expect(operations).toContain("Weird.codec");
    expect(result.files).toHaveLength(5);
  });

  it("should honor build options that keep generated files minimal", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });

    writeFileSync(join(outDir, "package.json"), '{"stale":true}\n');

    const result = AOT.generate({
      schemas: { User },
      outDir,
      operations: ["is"],
      exportMode: "flat",
      emitPackageJson: false,
    });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(result.files.map((file) => file.split("/").pop()).sort()).toEqual([
      "index.cjs",
      "index.d.cts",
      "index.d.ts",
      "index.mjs",
    ]);
    expect(existsSync(join(outDir, "package.json"))).toBe(false);
    expect(source).toContain("const User_is");
    expect(source).not.toContain("User_parse");
    expect(source).not.toContain("User_equal");
    expect(source).not.toContain('from "jit"');
    expect(types).toContain("export declare const User_is");
    expect(types).not.toContain("export declare const User_parse");
  });

  it("should generate hash and hash-short-circuit equal with zero imports", async () => {
    const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
    const result = AOT.generate({ schemas: { Hashed }, outDir });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");

    expect(result.skipped.filter((skip) => skip.operation === "equal")).toHaveLength(0);
    expect(source).toContain("const Hashed_hash");
    expect(source).toContain("((__hash) => (");
    expect(source).not.toContain("import ");

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      Hashed_equal: (left: unknown, right: unknown) => boolean;
      Hashed_hash: (value: unknown) => number;
    };
    const ada = { id: 1, name: "Ada" };

    expect(generated.Hashed_equal(ada, { ...ada })).toBe(true);
    expect(generated.Hashed_equal(ada, { ...ada, name: "Grace" })).toBe(false);
    expect(generated.Hashed_hash(ada)).toBe(generated.Hashed_hash({ ...ada }));
    expect(generated.Hashed_hash(ada)).not.toBe(generated.Hashed_hash({ ...ada, name: "Grace" }));
  });

  it("should emit TypeScript types for nested and wrapped schemas", () => {
    const type = AOT.emitTypeScriptType(
      JIT.object({
        id: JIT.number(),
        nick: JIT.optional(JIT.string()),
        role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
        items: JIT.array(JIT.object({ sku: JIT.string() })),
      }).schema
    );

    expect(type).toBe('{ id: number; nick?: string | undefined; role: "admin" | "user"; items: { sku: string }[] }');

    expect(AOT.emitTypeScriptType(JIT.object({ id: JIT.number() }).readonly().schema)).toBe("Readonly<{ id: number }>");
  });
});
