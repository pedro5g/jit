import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";

describe("JIT.compile explicit aggregation", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().min(2),
    email: JIT.string().email().pii("mask"),
  });

  const ada = { id: 1, name: "Ada", email: "ada@math.org" };

  it("should compile only the requested operations, hot and aggregated", () => {
    const Users = JIT.compile(User, ["is", "equal", "stringify"]);

    expect(Users.is(ada)).toBe(true);
    expect(Users.is({ ...ada, id: 0 })).toBe(false);
    expect(Users.equal(ada, { ...ada })).toBe(true);
    expect(Users.stringify(ada)).toBe(JSON.stringify(ada));
    expect(Users.ops).toEqual(["is", "equal", "stringify"]);
    expect(Users.schema.type).toBe("object");

    // Not requested → not compiled, not present, not typed.
    expect((Users as Record<string, unknown>).clone).toBeUndefined();
    expect((Users as Record<string, unknown>).parse).toBeUndefined();
    expectTypeOf<keyof typeof Users>().toEqualTypeOf<"schema" | "ops" | "extras" | "is" | "equal" | "stringify">();
  });

  it("should share one validator across is/parse/safeParse/fromJSON", () => {
    const Users = JIT.compile(User, ["parse", "fromJSON"]);

    expect(Users.parse(ada)).toBe(ada);
    expect(Users.fromJSON(JSON.stringify(ada))).toEqual(ada);
    expect(() => Users.parse({ ...ada, email: "broken" })).toThrow(/email/);
  });

  it("should reject unknown ops loudly", () => {
    expect(() => JIT.compile(User, ["is", "teleport" as never])).toThrow(/unknown compile op/);
  });

  it("should aggregate explicitly supplied compiled functions", () => {
    const selected = JIT.validator(User).get("is", "parse");
    const Users = JIT.compile(User, {
      is: selected.is,
      parse: selected.parse,
    });

    expect(Users.is(ada)).toBe(true);
    expect(Users.parse(ada)).toBe(ada);
    expect(Users.ops).toEqual(["is", "parse"]);
    expect(Users.extras).toEqual([]);
    expect(Object.keys(Users).sort()).toEqual(["extras", "is", "ops", "parse", "schema"]);
    expectTypeOf<keyof typeof Users>().toEqualTypeOf<"schema" | "ops" | "extras" | "is" | "parse">();
  });
});

describe("AOT generation from JIT.compile markers", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-ops-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should generate only the ops the dev selected", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const marked = JIT.compile(User, ["is", "stringify"]);

    const result = AOT.generate({ schemas: { User: marked }, outDir });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toContain("const User_is");
    expect(source).toContain("const User_stringify");
    expect(source).not.toContain("User_clone");
    expect(source).not.toContain("User_equal");
    expect(source).not.toContain("User_codec");
    expect(source).not.toContain("User_parse");
    expect(source).not.toContain("User_hash");
    // parse not requested → no error class needed → still zero-import.
    expect(source).not.toContain("class JITValidationError");

    expect(types).toContain("User_is");
    expect(types).not.toContain("User_clone");

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      User: Record<string, unknown> & { is: (value: unknown) => boolean };
    };

    expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
    expect(Object.keys(generated.User).sort()).toEqual(["is", "stringify"]);
    expect(result.skipped).toHaveLength(0);
  });

  it("should export only the grouped object for object-style compile markers", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const ada = { id: 1, name: "Ada" };
    const selected = JIT.validator(User).get("is", "parse");
    const marked = JIT.compile(User, { is: selected.is, parse: selected.parse });

    AOT.generate({ schemas: { User: marked }, outDir });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toContain("const User_is");
    expect(source).toContain("const User_parse");
    expect(source).toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(source).toMatch(/export \{ User \};/);
    expect(source).not.toMatch(/export \{[^}]*User_is/);
    expect(types).not.toContain("export declare const User_is");
    expect(types).toContain("readonly is: (value: unknown) => value is User;");

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      User: { is: (value: unknown) => boolean; parse: (value: unknown) => typeof ada };
      User_is?: unknown;
    };

    expect(generated.User.is(ada)).toBe(true);
    expect(generated.User.parse(ada)).toEqual(ada);
    expect(generated.User_is).toBeUndefined();
  });

  it("should aggregate and generate dev-defined query and mapper extras", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      role: JIT.string(),
    });
    const Users = JIT.array(User);
    const PublicUser = JIT.object({ id: JIT.number(), name: JIT.string() });

    const findAdmins = JIT.query(Users)
      .filter((q) => q.eq("role", "admin"))
      .compile();
    const toDTO = JIT.mapper(User, PublicUser);
    const marked = JIT.compile(User, ["is"], { findAdmins, toDTO });

    const people = [
      { id: 1, name: "Ada", role: "admin" },
      { id: 2, name: "Grace", role: "user" },
    ];

    // Runtime aggregation: same object, no prefixes, fully typed.
    expect(marked.findAdmins(people)).toEqual([people[0]]);
    expect(marked.toDTO.map(people[1])).toEqual({ id: 2, name: "Grace" });
    expect(marked.extras).toEqual(["findAdmins", "toDTO"]);

    // AOT: extras are re-emitted from their registered source + bindings.
    const result = AOT.generate({
      schemas: { User: marked },
      sources: new Map([["User", join(outDir, "user.jit.ts")]]),
      outDir,
    });
    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("const User_findAdmins");
    expect(source).toContain("const User_toDTO");
    expect(types).toContain('export declare const User_findAdmins: typeof import("./user.jit.js").User["findAdmins"];');
    expect(types).toContain("readonly findAdmins: typeof User_findAdmins;");

    const generated = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as {
      User: {
        is: (value: unknown) => boolean;
        findAdmins: (items: unknown[]) => unknown[];
        toDTO: { map: (value: unknown) => unknown; many: (values: unknown[]) => unknown[] };
      };
    };

    expect(generated.User.findAdmins(people)).toEqual([people[0]]);
    expect(generated.User.toDTO.many(people)).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  it("should skip extras whose bindings cannot be serialized", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const PublicUser = JIT.object({ id: JIT.number(), label: JIT.string() });
    const toLabel = JIT.mapper(User, PublicUser, {
      label: (user) => `${user.name}#${user.id}`,
    });
    const marked = JIT.compile(User, ["is"], { toLabel });

    const result = AOT.generate({ schemas: { User: marked }, outDir });
    const skip = result.skipped.find((entry) => entry.operation === "toLabel");

    expect(skip?.reason).toMatch(/cannot be serialized/);
  });

  it("should reject extras colliding with compiled ops", () => {
    const User = JIT.object({ id: JIT.number() });

    expect(() => JIT.compile(User, ["is"], { is: () => true })).toThrow(/collides/);
    expect(() => JIT.compile(User, [], { schema: 1 })).toThrow(/collides/);
  });

  it("should report runtime-only ops instead of failing", () => {
    const User = JIT.object({ id: JIT.number() });
    const marked = JIT.compile(User, ["is", "update"]);

    const result = AOT.generate({ schemas: { User: marked }, outDir });
    const skipped = result.skipped.map((skip) => `${skip.operation}: ${skip.reason}`);

    expect(skipped.some((entry) => entry.startsWith("update: runtime-only"))).toBe(true);
  });

  it("should keep hash internal when only equal needs it", () => {
    const Item = JIT.object({ id: JIT.number(), tags: JIT.array(JIT.string()) }).hash();
    const marked = JIT.compile(Item, ["equal"]);

    AOT.generate({ schemas: { Item: marked }, outDir });

    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toContain("const Item_equal");
    expect(types).not.toContain("Item_hash:");
    expect(source).toMatch(/export \{ Item_equal, Item \};/);
  });
});
