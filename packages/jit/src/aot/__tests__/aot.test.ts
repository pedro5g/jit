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
    const Event = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      target: JIT.string().pii(),
      body: JIT.string().sanitize(),
      at: JIT.date(),
    });
    const WireEvent = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      target: JIT.string(),
    });
    const selected = JIT.compile(Event, ["equal", "clone", "diff", "stringify"]);

    const result = AOT.generate({
      schemas: {},
      functions: {
        Event_equal: selected.equal,
        Event_clone: selected.clone,
        Event_diff: selected.diff,
        Event_stringify: selected.stringify,
        Event_fromJSON: JIT.json(WireEvent).parse().compile(),
        Event_mask: JIT.mask(Event),
        Event_sanitize: JIT.sanitize(Event),
        Event_codec: JIT.codec(Event),
      },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");

    expect(source).not.toContain('from "jit"');
    expect(result.skipped).toHaveLength(0);

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      Event_equal: (left: unknown, right: unknown) => boolean;
      Event_clone: <T>(value: T) => T;
      Event_diff: (left: unknown, right: unknown) => readonly unknown[];
      Event_stringify: (value: unknown) => string;
      Event_fromJSON: (json: string) => unknown;
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
    expect(generated.Event_diff(event, { ...event, target: "next" })).toEqual([
      { type: "update", path: ["target"], value: "next" },
    ]);
    expect(generated.Event_stringify(event)).toBe(JSON.stringify(event));
    expect(generated.Event_fromJSON('{"id":7,"kind":"click","target":"next"}')).toEqual({
      id: 7,
      kind: "click",
      target: "next",
    });
    expect(() => generated.Event_fromJSON('{"id":7}')).toThrow(/expected literal click/);
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

    const selected = JIT.validator(User).get("is", "parse", "safeParse");
    const result = AOT.generate({
      schemas: {},
      functions: {
        User_is: selected.is,
        User_parse: selected.parse,
        User_safeParse: selected.safeParse,
      },
      outDir,
      packageName: "@acme/models",
    });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");
    const manifest = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8")) as { name: string; type: string };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("const User_is_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("const User_parse_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("const User_safeParse_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("function is(value)");
    expect(source).toContain("function safeParse(value)");
    expect(source).toContain("class JITValidationError extends Error");
    expect(source).not.toContain("import ");
    expect(source).toContain("const User_is = /*#__PURE__*/ ((v) => v.is)(User_is_validator);");
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");

    expect(types).not.toContain("export type User =");
    expect(types).toContain("id: number");
    expect(types).toContain("plan?: string");
    expect(types).toContain("export declare const User_is");
    expect(types).toContain("export declare const User_parse");
    expect(types).toContain("export declare const User_safeParse");
    expect(types).not.toContain("export declare const User: {");

    expect(manifest.name).toBe("@acme/models");
    expect(manifest.type).toBe("module");
  });

  it("should preserve standalone export names when grouped internals would collide", async () => {
    const UserSchema = JIT.object({ id: JIT.number() });
    const selected = JIT.validator(UserSchema).get("is");

    AOT.generate({
      schemas: { User: JIT.compile(UserSchema, { is: selected.is }) },
      functions: { User_is: selected.is },
      outDir,
    });

    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      User: { is: (value: unknown) => boolean };
      User_is: (value: unknown) => boolean;
    };

    expect(source).toContain("const User_is_1");
    expect(source).toContain("is: User_is_1");
    expect(source).toContain("const User_is =");
    expect(types).toContain("export type UserStrict<TValue> = TValue;");
    expect(generated.User.is({ id: 1 })).toBe(true);
    expect(generated.User_is({ id: 1 })).toBe(true);
  });

  it("should report raw schemas as skipped instead of generating fallback functions", () => {
    const Weird = JIT.object({
      meta: JIT.map(JIT.string(), JIT.number()),
      hook: JIT.string().refine((value) => value.length > 0),
      open: JIT.any(),
    });

    const result = AOT.generate({ schemas: { Weird }, outDir });
    const operations = result.skipped.map((skip) => `${skip.schema}.${skip.operation}`);

    expect(operations).toContain("Weird.schema");
    expect(result.files).toHaveLength(0);
  });

  it("should honor build options that keep generated files minimal", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });

    writeFileSync(join(outDir, "package.json"), '{"stale":true}\n');
    const selected = JIT.validator(User).get("is");

    const result = AOT.generate({
      schemas: {},
      functions: { User_is: selected.is },
      outDir,
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
    expect(source).not.toContain("JITValidationError");
    expect(source).not.toContain("__hashCache");
    expect(source).not.toContain("__indexCache");
    expect(source).not.toContain("__getIndex");
    expect(source).not.toContain('from "jit"');
    expect(types).toContain("export declare const User_is");
    expect(types).not.toContain("export declare const User_parse");
  });

  it("should inline cache helpers only for operations that need them", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const PlainUsers = JIT.array(User);
    const IndexedUsers = JIT.array(User).entity({ key: "id" }).indexBy("id");
    const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
    const plainDir = join(outDir, "plain");
    const indexedDir = join(outDir, "indexed");
    const hashedDir = join(outDir, "hashed");

    AOT.generate({
      schemas: {},
      functions: { Plain_equal: JIT.compile(PlainUsers, ["equal"]).equal },
      outDir: plainDir,
    });

    const plainSource = readFileSync(join(plainDir, "index.mjs"), "utf8");

    expect(plainSource).not.toContain("__indexCache");
    expect(plainSource).not.toContain("__hashCache");

    AOT.generate({
      schemas: {},
      functions: { Indexed_equal: JIT.compile(IndexedUsers, ["equal"]).equal },
      outDir: indexedDir,
    });

    const indexedSource = readFileSync(join(indexedDir, "index.mjs"), "utf8");
    const indexedGenerated = (await import(pathToFileURL(join(indexedDir, "index.mjs")).href)) as {
      Indexed_equal: (left: readonly unknown[], right: readonly unknown[]) => boolean;
    };
    const left = Array.from({ length: 70 }, (_, index) => ({ id: index, name: `user-${index}` }));
    const right = [...left].reverse();

    expect(indexedSource.match(/const __indexCache = new WeakMap\(\);/g)).toHaveLength(1);
    expect(indexedSource).toContain('__getIndex(r, "id")');
    expect(indexedSource).not.toContain("__hashCache");
    expect(indexedGenerated.Indexed_equal(left, right)).toBe(true);
    expect(indexedGenerated.Indexed_equal(left, right)).toBe(true);
    expect(
      indexedGenerated.Indexed_equal(
        left,
        right.map((user) => (user.id === 35 ? { ...user, name: "changed" } : user))
      )
    ).toBe(false);

    const selected = JIT.compile(Hashed, ["equal", "hash"]);

    AOT.generate({
      schemas: {},
      functions: { Hashed_equal: selected.equal, Hashed_hash: selected.hash },
      outDir: hashedDir,
    });

    const hashedSource = readFileSync(join(hashedDir, "index.mjs"), "utf8");
    const hashedGenerated = (await import(pathToFileURL(join(hashedDir, "index.mjs")).href)) as {
      Hashed_equal: (left: unknown, right: unknown) => boolean;
      Hashed_hash: (value: unknown) => number;
    };

    expect(hashedSource.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
    expect(hashedSource).not.toContain("__indexCache");
    expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
    expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toBe(false);
    expect(hashedGenerated.Hashed_hash({ id: 1, name: "Ada" })).toBe(
      hashedGenerated.Hashed_hash({ id: 1, name: "Ada" })
    );
  });

  it("should generate hash and hash-short-circuit equal with zero imports", async () => {
    const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
    const selected = JIT.compile(Hashed, ["equal", "hash"]);
    const result = AOT.generate({
      schemas: {},
      functions: {
        Hashed_equal: selected.equal,
        Hashed_hash: selected.hash,
      },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");

    expect(result.skipped.filter((skip) => skip.operation === "equal")).toHaveLength(0);
    expect(source).toContain("const Hashed_hash");
    expect(source).toContain("const Hashed_equal_hash");
    expect(source).toContain("((__hash) => (");
    expect(source.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
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
        status: JIT.string().oneOf(["active", "blocked"] as const),
        level: JIT.number().oneOf([1, 2, 3] as const),
        items: JIT.array(JIT.object({ sku: JIT.string() })),
      }).schema
    );

    expect(type).toBe(
      '{ id: number; nick?: string | undefined; role: "admin" | "user"; status: "active" | "blocked"; level: 1 | 2 | 3; items: { sku: string }[] }'
    );

    expect(AOT.emitTypeScriptType(JIT.object({ id: JIT.number() }).readonly().schema)).toBe("Readonly<{ id: number }>");
  });
});
