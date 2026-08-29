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
  /**
   * Reduces a result that holds functions to something comparable. An ability
   * answers through its methods, so the parity worth checking is what those
   * methods answer, not the identity of the closures.
   */
  readonly answer?: (result: never) => unknown;
}

function resultOf(parityCase: ApiParityCase, artifact: UnknownArtifact): unknown {
  const result = artifact(...parityCase.args);

  return normalizeArtifactResult(parityCase.answer === undefined ? result : parityCase.answer(result as never));
}

function normalizeArtifactResult(value: unknown): unknown {
  return value !== null && typeof value === "object" && Symbol.iterator in value
    ? [...(value as Iterable<unknown>)]
    : value;
}

describe("runtime and define entrypoints", () => {
  it("should keep the public namespace shape one-to-one", () => {
    expect(Object.keys(DefineJIT).sort()).toEqual(Object.keys(RuntimeJIT).sort());

    for (const namespace of ["api", "binary", "compare", "cqrs", "json", "security", "state", "validate"] as const) {
      expect(Object.keys(DefineJIT[namespace]).sort(), namespace).toEqual(Object.keys(RuntimeJIT[namespace]).sort());
    }

    for (const removed of ["update", "patch", "reconcile", "watch", "watchedList"] as const) {
      expect(removed in RuntimeJIT, removed).toBe(false);
      expect(removed in DefineJIT, removed).toBe(false);
    }
    expect("input" in RuntimeJIT.cqrs).toBe(false);
    expect("parse" in RuntimeJIT.cqrs).toBe(false);
  });

  it("should verify registered runtime/define/AOT operations through one parity matrix", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-api-parity-"));
    const RuntimeUser = RuntimeJIT.object({
      id: RuntimeJIT.number(),
      name: RuntimeJIT.string(),
    });
    const DefineUser = DefineJIT.object({
      id: DefineJIT.number(),
      name: DefineJIT.string(),
    });
    const RuntimeUsers = RuntimeJIT.array(RuntimeUser);
    const DefineUsers = DefineJIT.array(DefineUser);
    const RuntimeProfile = RuntimeJIT.object({
      userId: RuntimeJIT.number(),
      label: RuntimeJIT.string(),
    });
    const DefineProfile = DefineJIT.object({
      userId: DefineJIT.number(),
      label: DefineJIT.string(),
    });
    const value = { id: 1, name: "Ada" };
    const equalValue = { id: 1, name: "Ada" };
    const runtimeSelected = RuntimeJIT.cqrs
      .query(RuntimeUser)
      .where((query) => query.eq("id", 1))
      .select("name");
    const defineSelected = DefineJIT.cqrs
      .query(DefineUser)
      .where((query) => query.eq("id", 1))
      .select("name");
    const runtimeInputParser = RuntimeJIT.api.parse(RuntimeJIT.api.query(RuntimeUser, { filter: { id: true } }));
    const defineInputParser = DefineJIT.api.parse(DefineJIT.api.query(DefineUser, { filter: { id: true } }));
    const runtimeSorted = RuntimeJIT.sort(RuntimeUser).by("name", "desc").thenBy("id");
    const defineSorted = DefineJIT.sort(DefineUser).by("name", "desc").thenBy("id");
    const runtimeIndexed = RuntimeJIT.index(RuntimeJIT.array(RuntimeUser)).by("id");
    const defineIndexed = DefineJIT.index(DefineJIT.array(DefineUser)).by("id");
    const runtimeFirst = RuntimeJIT.cqrs
      .query(RuntimeJIT.array(RuntimeUser))
      .where((query) => query.eq("id", 2))
      .first();
    const defineFirst = DefineJIT.cqrs
      .query(DefineJIT.array(DefineUser))
      .where((query) => query.eq("id", 2))
      .first();
    const runtimeAggregate = RuntimeJIT.cqrs.query(RuntimeJIT.array(RuntimeUser)).aggregate({
      count: RuntimeJIT.cqrs.count(),
      total: RuntimeJIT.cqrs.sum("id"),
    });
    const defineAggregate = DefineJIT.cqrs.query(DefineJIT.array(DefineUser)).aggregate({
      count: DefineJIT.cqrs.count(),
      total: DefineJIT.cqrs.sum("id"),
    });
    const runtimeSome = RuntimeJIT.cqrs
      .query(RuntimeJIT.array(RuntimeUser))
      .where((query) => query.gt("id", 1))
      .some();
    const defineSome = DefineJIT.cqrs
      .query(DefineJIT.array(DefineUser))
      .where((query) => query.gt("id", 1))
      .some();
    const runtimeJoin = RuntimeJIT.cqrs.query(RuntimeUser).join(RuntimeProfile).on("id", "userId");
    const defineJoin = DefineJIT.cqrs.query(DefineUser).join(DefineProfile).on("id", "userId");
    const runtimeDistinct = RuntimeJIT.cqrs.query(RuntimeUser).distinct();
    const defineDistinct = DefineJIT.cqrs.query(DefineUser).distinct();
    const runtimeLookup = RuntimeJIT.lookup(RuntimeJIT.array(RuntimeUser).keyed("id"));
    const defineLookup = DefineJIT.lookup(DefineJIT.array(DefineUser).keyed("id"));
    const runtimeReconcile = RuntimeJIT.state.reconcile(RuntimeJIT.array(RuntimeUser).keyed("id"));
    const defineReconcile = DefineJIT.state.reconcile(DefineJIT.array(DefineUser).keyed("id"));
    const runtimeProject = RuntimeJIT.project(RuntimeUser).select("id");
    const defineProject = DefineJIT.project(DefineUser).select("id");
    const runtimeSelectedEqual = RuntimeJIT.compare.equal(RuntimeUser).select("id");
    const defineSelectedEqual = DefineJIT.compare.equal(DefineUser).select("id");
    const runtimeChanged = RuntimeJIT.compare.changed(RuntimeUser);
    const defineChanged = DefineJIT.compare.changed(DefineUser);
    const runtimeCacheKey = RuntimeJIT.cacheKey.string(RuntimeUser).select("id", "name");
    const defineCacheKey = DefineJIT.cacheKey.string(DefineUser).select("id", "name");
    const runtimeAccess = RuntimeJIT.access(RuntimeUser)
      .actor(RuntimeUser)
      .can("read")
      .can("update", (query, self) => query.eq("id", self.field("id")));
    const defineAccess = DefineJIT.access(DefineUser)
      .actor(DefineUser)
      .can("read")
      .can("update", (query, self) => query.eq("id", self.field("id")));
    const RuntimeReview = RuntimeJIT.object({ userId: RuntimeJIT.number(), tier: RuntimeJIT.literal("known") });
    const DefineReview = DefineJIT.object({ userId: DefineJIT.number(), tier: DefineJIT.literal("known") });
    const runtimeRules = RuntimeJIT.rules(RuntimeUser)
      .inputs({ minimum: RuntimeJIT.number() })
      .rule("known", {
        when: (query, input) => query.gte("id", input.field("minimum")),
        emit: RuntimeReview,
        values: (subject) => ({ userId: subject.field("id") }),
      })
      .rule("named", { when: (query) => query.neq("name", "") });
    const defineRules = DefineJIT.rules(DefineUser)
      .inputs({ minimum: DefineJIT.number() })
      .rule("known", {
        when: (query, input) => query.gte("id", input.field("minimum")),
        emit: DefineReview,
        values: (subject) => ({ userId: subject.field("id") }),
      })
      .rule("named", { when: (query) => query.neq("name", "") });
    const runtimeManyRules = runtimeRules.many();
    const defineManyRules = defineRules.many();
    const runtimeCanonical = RuntimeJIT.canonical(RuntimeUser);
    const defineCanonical = DefineJIT.canonical(DefineUser);
    const runtimeMergePatch = RuntimeJIT.state.patch.merge(RuntimeUser);
    const defineMergePatch = DefineJIT.state.patch.merge(DefineUser);
    const runtimeJsonPatch = RuntimeJIT.state.patch.json(RuntimeUser);
    const defineJsonPatch = DefineJIT.state.patch.json(DefineUser);
    const RuntimeEvent = RuntimeJIT.discriminatedUnion("type", [
      RuntimeJIT.object({ type: RuntimeJIT.literal("created"), id: RuntimeJIT.number() }),
      RuntimeJIT.object({ type: RuntimeJIT.literal("deleted"), id: RuntimeJIT.number() }),
    ]);
    const DefineEvent = DefineJIT.discriminatedUnion("type", [
      DefineJIT.object({ type: DefineJIT.literal("created"), id: DefineJIT.number() }),
      DefineJIT.object({ type: DefineJIT.literal("deleted"), id: DefineJIT.number() }),
    ]);
    const runtimeMatch = RuntimeJIT.match(RuntimeEvent)
      .case("created", (event) => `created:${event.id}`)
      .case("deleted", (event) => `deleted:${event.id}`)
      .exhaustive();
    const defineMatch = DefineJIT.match(DefineEvent)
      .case("created", (event) => `created:${event.id}`)
      .case("deleted", (event) => `deleted:${event.id}`)
      .exhaustive();
    const RuntimeUserV2 = RuntimeJIT.object({
      version: RuntimeJIT.literal(2),
      fullName: RuntimeJIT.string(),
    });
    const DefineUserV2 = DefineJIT.object({ version: DefineJIT.literal(2), fullName: DefineJIT.string() });
    const runtimeMigration = RuntimeJIT.migrate(
      RuntimeJIT.object({ version: RuntimeJIT.literal(1), name: RuntimeJIT.string() })
    ).to(RuntimeUserV2, { fullName: { from: "name" } });
    const defineMigration = DefineJIT.migrate(
      DefineJIT.object({ version: DefineJIT.literal(1), name: DefineJIT.string() })
    ).to(DefineUserV2, { fullName: { from: "name" } });
    const runtimeCsv = RuntimeJIT.csv.parse(RuntimeUser);
    const defineCsv = DefineJIT.csv.parse(DefineUser);
    const runtimeNdjson = RuntimeJIT.ndjson.parse(RuntimeUser).select("id").to.ndjson();
    const defineNdjson = DefineJIT.ndjson.parse(DefineUser).select("id").to.ndjson();

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
        runtime: RuntimeJIT.json.stringifyChunks(RuntimeUsers, {
          chunkBytes: 8,
        }) as UnknownArtifact,
        define: DefineJIT.json.stringifyChunks(DefineUsers, {
          chunkBytes: 8,
        }) as UnknownArtifact,
        args: [[value, equalValue]],
      },
      {
        name: "selectedUsers",
        runtime: runtimeSelected as UnknownArtifact,
        define: defineSelected as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "parseUserQuery",
        runtime: runtimeInputParser as UnknownArtifact,
        define: defineInputParser as UnknownArtifact,
        args: [{ filter: { id: 1 } }],
      },
      {
        name: "sortedUsers",
        runtime: runtimeSorted as UnknownArtifact,
        define: defineSorted as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "usersById",
        runtime: runtimeIndexed as UnknownArtifact,
        define: defineIndexed as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "firstUser",
        runtime: runtimeFirst as UnknownArtifact,
        define: defineFirst as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "userTotals",
        runtime: runtimeAggregate as UnknownArtifact,
        define: defineAggregate as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "anyUser",
        runtime: runtimeSome as UnknownArtifact,
        define: defineSome as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }]],
      },
      {
        name: "usersWithProfiles",
        runtime: runtimeJoin as UnknownArtifact,
        define: defineJoin as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }], [{ userId: 1, label: "math" }]],
      },
      {
        name: "distinctUsers",
        runtime: runtimeDistinct as UnknownArtifact,
        define: defineDistinct as UnknownArtifact,
        args: [[value, equalValue, { id: 2, name: "Grace" }]],
      },
      {
        name: "lookupUserById",
        runtime: runtimeLookup as UnknownArtifact,
        define: defineLookup as UnknownArtifact,
        args: [[value, { id: 2, name: "Grace" }], 2],
      },
      {
        name: "projectUserId",
        runtime: runtimeProject as UnknownArtifact,
        define: defineProject as UnknownArtifact,
        args: [value],
      },
      {
        name: "equalUserById",
        runtime: runtimeSelectedEqual as UnknownArtifact,
        define: defineSelectedEqual as UnknownArtifact,
        args: [value, { ...value, name: "Different" }],
      },
      {
        name: "changedUser",
        runtime: runtimeChanged as UnknownArtifact,
        define: defineChanged as UnknownArtifact,
        args: [value, { ...value, name: "Different" }],
      },
      {
        name: "userCacheKey",
        runtime: runtimeCacheKey as UnknownArtifact,
        define: defineCacheKey as UnknownArtifact,
        args: [value],
      },
      {
        name: "userAccess",
        runtime: runtimeAccess as UnknownArtifact,
        define: defineAccess as UnknownArtifact,
        args: [value],
        answer: (ability: { can(action: string, subject?: unknown): boolean }) => [
          ability.can("read", value),
          ability.can("update", value),
          ability.can("update", { ...value, id: 99 }),
          ability.can("archive" as never, value),
        ],
      },
      {
        name: "testUserRule",
        runtime: runtimeRules.test as UnknownArtifact,
        define: defineRules.test as UnknownArtifact,
        args: ["known", value, { minimum: 1 }],
      },
      {
        name: "someUserRule",
        runtime: runtimeRules.some as UnknownArtifact,
        define: defineRules.some as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "firstUserRule",
        runtime: runtimeRules.first as UnknownArtifact,
        define: defineRules.first as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "matchUserRules",
        runtime: runtimeRules.match as UnknownArtifact,
        define: defineRules.match as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "runUserRules",
        runtime: runtimeRules.run as UnknownArtifact,
        define: defineRules.run as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "explainUserRules",
        runtime: runtimeRules.explain as UnknownArtifact,
        define: defineRules.explain as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "knownUserPredicate",
        runtime: runtimeRules.predicate("known") as UnknownArtifact,
        define: defineRules.predicate("known") as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "visitUserRules",
        runtime: runtimeRules.to.visitor() as UnknownArtifact,
        define: defineRules.to.visitor() as UnknownArtifact,
        args: [value, { minimum: 1 }, () => {}],
      },
      {
        name: "iterateUserRules",
        runtime: runtimeRules.to.iterator() as UnknownArtifact,
        define: defineRules.to.iterator() as UnknownArtifact,
        args: [value, { minimum: 1 }],
      },
      {
        name: "classifyUsers",
        runtime: runtimeManyRules as UnknownArtifact,
        define: defineManyRules as UnknownArtifact,
        args: [[value], { minimum: 1 }],
      },
      {
        name: "visitClassifiedUsers",
        runtime: runtimeManyRules.to.visitor() as UnknownArtifact,
        define: defineManyRules.to.visitor() as UnknownArtifact,
        args: [[value], { minimum: 1 }, () => {}],
      },
      {
        name: "iterateClassifiedUsers",
        runtime: runtimeManyRules.to.iterator() as UnknownArtifact,
        define: defineManyRules.to.iterator() as UnknownArtifact,
        args: [[value], { minimum: 1 }],
      },
      {
        name: "canonicalUser",
        runtime: runtimeCanonical as UnknownArtifact,
        define: defineCanonical as UnknownArtifact,
        args: [value],
      },
      {
        name: "mergeUser",
        runtime: runtimeMergePatch as UnknownArtifact,
        define: defineMergePatch as UnknownArtifact,
        args: [value, { name: "Merged" }],
      },
      {
        name: "patchUser",
        runtime: runtimeJsonPatch as UnknownArtifact,
        define: defineJsonPatch as UnknownArtifact,
        args: [value, [{ op: "replace", path: "/name", value: "Patched" }]],
      },
      {
        name: "matchEvent",
        runtime: runtimeMatch as UnknownArtifact,
        define: defineMatch as UnknownArtifact,
        args: [{ type: "created", id: 1 }],
      },
      {
        name: "migrateUser",
        runtime: runtimeMigration as UnknownArtifact,
        define: defineMigration as UnknownArtifact,
        args: [{ version: 1, name: "Ada" }],
      },
      {
        name: "parseUsersCsv",
        runtime: runtimeCsv as UnknownArtifact,
        define: defineCsv as UnknownArtifact,
        args: ["id,name\n1,Ada"],
      },
      {
        name: "filterUsersNdjson",
        runtime: runtimeNdjson as UnknownArtifact,
        define: defineNdjson as UnknownArtifact,
        args: ['{"id":1,"name":"Ada"}\n'],
      },
      {
        name: "reconcileUsers",
        runtime: runtimeReconcile as UnknownArtifact,
        define: defineReconcile as UnknownArtifact,
        args: [
          [value, { id: 2, name: "Grace" }],
          [
            { id: 2, name: "Grace Hopper" },
            { id: 3, name: "Ada" },
          ],
        ],
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
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("rules.filter");

      for (const parityCase of cases) {
        expect(
          resultOf(parityCase, generated[parityCase.name] as UnknownArtifact),
          `${parityCase.name} AOT result`
        ).toEqual(resultOf(parityCase, parityCase.runtime));
      }

      const chunksCase = cases.find((parityCase) => parityCase.name === "stringifyUserChunks");
      expect(chunksCase).toBeDefined();
      AOT.generate({
        artifacts: { stringifyUserChunks: chunksCase?.define },
        outDir,
        format: "ts",
      });
      expect(readFileSync(join(outDir, "index.ts"), "utf8")).toContain("=> IterableIterator<string>");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should expose the runtime JIT namespace", () => {
    const User = RuntimeJIT.object({ id: RuntimeJIT.number() });
    const isUser = RuntimeJIT.validate.is(User);

    expect(isUser({ id: 1 })).toBe(true);
    expectTypeOf<RuntimeJIT.Typeof<typeof User>>().toEqualTypeOf<{
      id: number;
    }>();
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
      const User = DefineJIT.object({
        id: DefineJIT.number(),
        active: DefineJIT.boolean(),
      });
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
        role: DefineJIT.enum(["admin", "member"]),
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

  it("should reconstruct authorized query, projection, and patch from the define host", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-define-access-"));

    try {
      const Actor = DefineJIT.object({ id: DefineJIT.number() });
      const Post = DefineJIT.object({
        id: DefineJIT.number(),
        authorId: DefineJIT.number(),
        title: DefineJIT.string(),
      });
      const access = DefineJIT.access(Post)
        .actor(Actor)
        .can("read", (query, actor) => query.eq("authorId", actor.field("id")))
        .can("update", { fields: ["title"], when: (query, actor) => query.eq("authorId", actor.field("id")) });
      const actor = { id: 1 };
      const read = DefineJIT.cqrs.query(Post).authorize(access, "read", actor).select("id", "title");
      const shape = DefineJIT.project(Post).authorize(access, "read", actor);
      const change = DefineJIT.state.patch.apply(Post).authorize(access, "update", actor);

      AOT.generate({ schemas: {}, artifacts: { read, shape, change }, outDir });
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        read: (rows: Array<{ id: number; authorId: number; title: string }>) => unknown[];
        shape: (value: { id: number; authorId: number; title: string }) => object;
        change: (
          value: { id: number; authorId: number; title: string },
          patch: unknown
        ) => { id: number; authorId: number; title: string };
      };
      const own = { id: 1, authorId: 1, title: "draft" };
      const other = { id: 2, authorId: 2, title: "other" };

      expect(generated.read([own, other])).toEqual([{ id: 1, title: "draft" }]);
      expect(generated.shape(own)).toEqual(own);
      expect(generated.change(own, { title: "published" }).title).toBe("published");
      expect(() => generated.change(other, { title: "blocked" })).toThrow(/Access denied/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
