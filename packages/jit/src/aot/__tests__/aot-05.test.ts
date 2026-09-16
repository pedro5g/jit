import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";
import { registerAotTestHooks } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should re-emit lazy iterators and direct visitors as import-free AOT source", async () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    active: JIT.boolean(),
  });
  const Users = JIT.array(User);
  const ActiveIds = JIT.cqrs
    .query(Users)
    .filter((q) => q.eq("active", true))
    .select("id")
    .take(2)
    .to.iterator();
  const VisitActiveIds = JIT.cqrs
    .query(Users)
    .filter((q) => q.eq("active", true))
    .select("id")
    .to.visitor();
  const result = AOT.generate({
    groups: {},
    artifacts: { ActiveIds, VisitActiveIds },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    ActiveIds: (input: readonly { id: number; active: boolean }[]) => IterableIterator<{ id: number }>;
    VisitActiveIds: (
      input: readonly { id: number; active: boolean }[],
      consume: (value: { id: number }) => void
    ) => number;
  };
  const users = [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true },
    { id: 4, active: true },
  ];
  const visited: number[] = [];

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).toContain("function* stage0(input, params)");
  expect(source).toContain("function visit(input, consume)");
  expect([...generated.ActiveIds(users)]).toEqual([{ id: 1 }, { id: 3 }]);
  expect(generated.VisitActiveIds(users, (value) => visited.push(value.id))).toBe(3);
  expect(visited).toEqual([1, 3, 4]);
});

it("should re-emit callback-free watched collection diffs", async () => {
  const User = JIT.object({ id: JIT.number(), name: JIT.string() });
  const Users = JIT.array(User);
  const UserChanges = JIT.state.watch(Users, { key: "id" });
  const UserCollection = { changes: UserChanges };
  const result = AOT.generate({
    groups: { UserCollection },
    artifacts: { UserChanges },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    UserCollection: { changes: typeof UserChanges };
    UserChanges: typeof UserChanges;
  };
  const ada = { id: 1, name: "Ada" };
  const grace = { id: 2, name: "Grace" };
  const adaUpdated = { id: 1, name: "Ada Lovelace" };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).toContain("function watch(previous, current)");
  expect(source).toContain("const previousIndex = new Map();");
  expect(generated.UserChanges([ada, grace], [adaUpdated])).toEqual({
    currentItems: [adaUpdated],
    initialItems: [ada, grace],
    newItems: [],
    removedItems: [grace],
    updatedItems: [{ previous: ada, current: adaUpdated }],
    isChanged: true,
  });
  expect(generated.UserCollection.changes([ada], [ada])).toEqual({
    currentItems: [ada],
    initialItems: [ada],
    newItems: [],
    removedItems: [],
    updatedItems: [],
    isChanged: false,
  });
});

it("should serialize watched collection callbacks into self-contained AOT bindings", async () => {
  const User = JIT.object({ id: JIT.number() });
  const Users = JIT.array(User);
  const hooks = {
    onAdd(_value: { id: number }) {
      return undefined;
    },
  };
  const UserChanges = JIT.state.watch(Users, { key: "id", onAdd: hooks.onAdd });
  const result = AOT.generate({
    groups: {},
    artifacts: { UserChanges },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    UserChanges: typeof UserChanges;
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain("const __w0 = (function onAdd(_value)");
  expect(generated.UserChanges([], [{ id: 1 }]).newItems).toEqual([{ id: 1 }]);
});

it("should serialize default, refine, and transform callbacks into AOT validators", async () => {
  const User = JIT.object({
    name: JIT.string().default(() => "'"),
  })
    .transform({
      name: (value) => String(value).trim(),
    })
    .refine((value) => value.name !== "blocked");
  const result = AOT.generate({
    groups: {},
    artifacts: {
      isUser: JIT.validate.is(User),
      parseUser: JIT.validate.parse(User),
      safeParseUser: JIT.validate.safeParse(User),
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    isUser: (value: unknown) => boolean;
    parseUser: (value: unknown) => { name: string };
    safeParseUser: (value: unknown) => { success: boolean };
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain(`(() => "'")`);
  expect(source).toContain("((value) => String(value).trim())");
  expect(source).toContain('((value) => value.name !== "blocked")');
  expect(generated.isUser({ name: " Ada " })).toBe(true);
  expect(generated.parseUser({ name: " Ada " })).toEqual({ name: "Ada" });
  expect(generated.parseUser({})).toEqual({ name: "'" });
  expect(generated.safeParseUser({ name: "blocked" }).success).toBe(false);
});

it("should reject callbacks with inaccessible closure dependencies", () => {
  const minimum = 2;
  const Name = JIT.string().refine((value) => value.length >= minimum);
  const result = AOT.generate({
    groups: {},
    artifacts: { isName: JIT.validate.is(Name) },
    outDir,
  });

  expect(result.files).toEqual([]);
  expect(result.skipped).toContainEqual({
    schema: "isName",
    operation: "is",
    reason: "refine/transform/default callbacks cannot be serialized ahead of time",
  });
});

it("should generate validator flat exports with inlined regex bindings", () => {
  const User = JIT.object({
    id: JIT.number().int(),
    email: JIT.string().email(),
    plan: JIT.string().default("free"),
  });

  const result = AOT.generate({
    groups: {},
    artifacts: {
      User_is: JIT.validate.is(User),
      User_parse: JIT.validate.parse(User),
      User_safeParse: JIT.validate.safeParse(User),
    },
    outDir,
    format: "ts",
  });
  const source = readFileSync(join(outDir, "index.ts"), "utf8");

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain("const User_is_validator = /*#__PURE__*/ (() => {");
  expect(source).toContain("const User_parse_validator = /*#__PURE__*/ (() => {");
  expect(source).toContain("const User_safeParse_validator = /*#__PURE__*/ (() => {");
  expect(source).toContain("function is(value)");
  expect(source).toContain("function safeParse(value)");
  expect(source).toContain("class JITValidationError extends Error");
  expect(source).not.toContain("import ");
  expect(source).toContain("= /*#__PURE__*/ ((v) => v.is)(User_is_validator);");
  expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");

  expect(source).not.toContain("export type User =");
  expect(source).toContain("id: number");
  expect(source).toContain("plan: string");
  expect(source).toContain("const User_is:");
  expect(source).toContain("const User_parse:");
  expect(source).toContain("const User_safeParse:");
  expect(source).not.toContain("const User: {");

  expect(existsSync(join(outDir, "package.json"))).toBe(false);
});

it("should preserve standalone export names when grouped internals would collide", async () => {
  const UserSchema = JIT.object({ id: JIT.number() });
  const isUser = JIT.validate.is(UserSchema);

  AOT.generate({
    groups: { User: { is: isUser } },
    artifacts: { User_is: isUser },
    outDir,
    format: "ts",
  });

  const source = readFileSync(join(outDir, "index.ts"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
    User: { is: (value: unknown) => boolean };
    User_is: (value: unknown) => boolean;
  };

  expect(source).toContain("const User_is_1");
  expect(source).toContain("is: User_is_1");
  expect(source).toContain("const User_is:");
  expect(generated.User.is({ id: 1 })).toBe(true);
  expect(generated.User_is({ id: 1 })).toBe(true);
});

it("should emit standalone and grouped specialized formatters", async () => {
  const Document = JIT.string().format("###.###.###-##");
  const formatDocument = JIT.format(Document).compile();

  AOT.generate({
    groups: { Document: { format: formatDocument } },
    artifacts: { formatDocument },
    outDir,
    format: "ts",
  });

  const source = readFileSync(join(outDir, "index.ts"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
    Document: { format: (value: string) => string };
    formatDocument: (value: string) => string;
  };

  expect(source).toContain("function format(value)");
  expect(source).not.toContain("safeParse");
  expect(source).toContain("readonly format: (value: string) => string");
  expect(generated.Document.format("12345678901")).toBe("123.456.789-01");
  expect(generated.formatDocument("12345678901")).toBe("123.456.789-01");
});

it("should report raw schemas as skipped instead of generating fallback functions", () => {
  const Weird = JIT.object({
    meta: JIT.mapSchema(JIT.string(), JIT.number()),
    hook: JIT.string().refine((value) => value.length > 0),
    open: JIT.any(),
  });

  const result = AOT.generate({ schemas: { Weird }, outDir });

  // A schema on its own declares a type, never a runtime function.
  expect(result.files).toHaveLength(0);
});

it("should honor build options that keep generated files minimal", () => {
  const User = JIT.object({ id: JIT.number(), name: JIT.string() });

  writeFileSync(join(outDir, "package.json"), '{"stale":true}\n');
  const isUser = JIT.validate.is(User);

  const result = AOT.generate({
    groups: {},
    artifacts: { User_is: isUser },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");

  expect(result.files.map((file) => file.split("/").pop()).sort()).toEqual(["index.js"]);
  expect(readFileSync(join(outDir, "package.json"), "utf8")).toBe('{"stale":true}\n');
  expect(source).toContain("const User_is");
  expect(source).not.toContain("User_parse");
  expect(source).not.toContain("User_equal");
  expect(source).not.toContain("JITValidationError");
  expect(source).not.toContain("__hashCache");
  expect(source).not.toContain("__indexCache");
  expect(source).not.toContain("__getIndex");
  expect(source).not.toContain('from "@jit-compiler/jit"');
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
    groups: {},
    artifacts: { Plain_equal: JIT.compare.equal(PlainUsers) },
    outDir: plainDir,
  });

  const plainSource = readFileSync(join(plainDir, "index.js"), "utf8");

  expect(plainSource).not.toContain("__indexCache");
  expect(plainSource).not.toContain("__hashCache");

  AOT.generate({
    groups: {},
    artifacts: { Indexed_equal: JIT.compare.equal(IndexedUsers) },
    outDir: indexedDir,
  });

  const indexedSource = readFileSync(join(indexedDir, "index.js"), "utf8");
  const indexedGenerated = (await import(pathToFileURL(join(indexedDir, "index.js")).href)) as {
    Indexed_equal: (left: readonly unknown[], right: readonly unknown[]) => boolean;
  };
  const left = Array.from({ length: 70 }, (_, index) => ({
    id: index,
    name: `user-${index}`,
  }));
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

  AOT.generate({
    artifacts: {
      Hashed_equal: JIT.compare.equal(Hashed),
      Hashed_hash: JIT.compare.hash(Hashed),
    },
    outDir: hashedDir,
  });

  const hashedSource = readFileSync(join(hashedDir, "index.js"), "utf8");
  const hashedGenerated = (await import(pathToFileURL(join(hashedDir, "index.js")).href)) as {
    Hashed_equal: (left: unknown, right: unknown) => boolean;
    Hashed_hash: (value: unknown) => number;
  };

  expect(hashedSource.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
  expect(hashedSource).not.toContain("__indexCache");
  expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
  expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toBe(false);
  expect(hashedGenerated.Hashed_hash({ id: 1, name: "Ada" })).toBe(hashedGenerated.Hashed_hash({ id: 1, name: "Ada" }));
});

it("should generate hash and hash-short-circuit equal with zero imports", async () => {
  const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
  const result = AOT.generate({
    artifacts: {
      Hashed_equal: JIT.compare.equal(Hashed),
      Hashed_hash: JIT.compare.hash(Hashed),
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");

  expect(result.skipped.filter((skip) => skip.operation === "equal")).toHaveLength(0);
  expect(source).toContain("const Hashed_hash");
  expect(source).toContain("const Hashed_equal_hash");
  expect(source).toContain("((__hash) => (");
  expect(source.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
  expect(source).not.toContain("import ");

  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    Hashed_equal: (left: unknown, right: unknown) => boolean;
    Hashed_hash: (value: unknown) => number;
  };
  const ada = { id: 1, name: "Ada" };

  expect(generated.Hashed_equal(ada, { ...ada })).toBe(true);
  expect(generated.Hashed_equal(ada, { ...ada, name: "Grace" })).toBe(false);
  expect(generated.Hashed_hash(ada)).toBe(generated.Hashed_hash({ ...ada }));
  expect(generated.Hashed_hash(ada)).not.toBe(generated.Hashed_hash({ ...ada, name: "Grace" }));
});

it("should inline a JSON Schema document and a specialized mock generator", async () => {
  const User = JIT.object({
    id: JIT.number().int32().positive(),
    email: JIT.string().email(),
    role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
  });
  const result = AOT.generate({
    artifacts: {
      userDocument: JIT.jsonSchema.to(User),
      mockUser: JIT.mock(User),
    },
    schemas: { User },
    outDir,
    format: "ts",
  });
  const source = readFileSync(join(outDir, "index.ts"), "utf8");

  expect(result.skipped).toHaveLength(0);
  // The document is static data: the translator never reaches the bundle.
  expect(source).toContain("const userDocument: { readonly [key: string]: unknown } = /*#__PURE__*/ Object.freeze({");
  expect(source).toContain('"format":"email"');
  expect(source).toContain("const mockUser: (options?: { readonly seed?: number }) => User =");
  expect(source).toContain("function __srand(seed)");
  expect(source).not.toContain('from "@jit-compiler/jit"');

  const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
    userDocument: { type: string; required: readonly string[] };
    mockUser: (options?: { seed?: number }) => {
      id: number;
      email: string;
      role: string;
    };
  };

  expect(generated.userDocument.type).toBe("object");
  expect(generated.userDocument.required).toEqual(["id", "email", "role"]);
  expect(JIT.validate.is(User)(generated.mockUser({ seed: 5 }))).toBe(true);
  expect(generated.mockUser({ seed: 5 })).toEqual(generated.mockUser({ seed: 5 }));
});

it("should lower a schema built from a JSON Schema document at generation time", async () => {
  const User = JIT.jsonSchema.from({
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1 },
      name: { type: "string", minLength: 2 },
    },
    required: ["id", "name"],
  } as const);
  const result = AOT.generate({
    artifacts: {
      isUser: JIT.validate.is(User),
      toJson: JIT.json.stringify(User),
    },
    schemas: { User },
    outDir,
    format: "ts",
  });
  const source = readFileSync(join(outDir, "index.ts"), "utf8");

  expect(result.skipped).toHaveLength(0);
  // The document is build-time input: only specialized functions ship.
  expect(source).toContain("export type User = { id: number; name: string };");
  expect(source).not.toContain("properties");
  expect(source).not.toContain("$schema");

  const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
    isUser: (value: unknown) => boolean;
    toJson: (value: { id: number; name: string }) => string;
  };

  expect(generated.isUser({ id: 1, name: "Ada" })).toBe(true);
  expect(generated.isUser({ id: 0, name: "Ada" })).toBe(false);
  expect(generated.isUser({ id: 1, name: "A" })).toBe(false);
  expect(generated.toJson({ id: 1, name: "Ada" })).toBe('{"id":1,"name":"Ada"}');
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
    '{ id: number; nick: string | undefined; role: "admin" | "user"; status: "active" | "blocked"; level: 1 | 2 | 3; items: { sku: string }[] }'
  );

  expect(AOT.emitTypeScriptType(JIT.object({ id: JIT.number() }).readonly().schema)).toBe("Readonly<{ id: number }>");
});

it("should generate every structural operation for a self-referencing schema", async () => {
  const Node: never = JIT.object({
    value: JIT.number().int32(),
    label: JIT.string().min(1),
    children: JIT.array(JIT.lazy((): never => Node)),
  }) as never;
  const names = new Map([[(Node as { schema: unknown }).schema, "Node"]] as never);

  // A cycle is only expressible in TypeScript through a name.
  expect(AOT.emitTypeScriptType((Node as { schema: never }).schema, names as never)).toBe(
    "{ value: number; label: string; children: Node[] }"
  );

  AOT.generate({
    artifacts: {
      cloneNode: JIT.clone(Node),
      equalNode: JIT.compare.equal(Node),
      diffNode: JIT.compare.diff(Node),
      nodeToJson: JIT.json.stringify(Node),
      updateNode: JIT.state.update(Node).compile(),
      isNode: JIT.validate.is(Node),
    },
    outDir,
    format: "js",
  });

  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as Record<string, never>;
  const value = {
    value: 1,
    label: "root",
    children: [{ value: 2, label: "a", children: [] }],
  };
  const clone = (generated.cloneNode as (v: unknown) => typeof value)(value);
  const changed = {
    ...value,
    children: [{ value: 9, label: "a", children: [] }],
  };

  expect(clone).toEqual(value);
  expect(clone.children).not.toBe(value.children);
  expect((generated.equalNode as (a: unknown, b: unknown) => boolean)(clone, value)).toBe(true);
  expect((generated.equalNode as (a: unknown, b: unknown) => boolean)(changed, value)).toBe(false);
  expect((generated.diffNode as (a: unknown, b: unknown) => unknown[])(value, changed)).toEqual([
    { type: "update", path: ["children", 0, "value"], value: 9 },
  ]);
  expect((generated.nodeToJson as (v: unknown) => string)(value)).toBe(JSON.stringify(value));
  expect(
    (generated.updateNode as (v: unknown, p: unknown) => typeof value)(value, {
      value: 7,
    }).value
  ).toBe(7);
  expect((generated.isNode as (v: unknown) => boolean)(value)).toBe(true);
});
