import * as fc from "fast-check";

import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";
import { emitCqrsAotParserSource, emitCqrsInputParser, encodeCqrsCursor } from "../cqrs.js";

describe("JIT.cqrs", () => {
  describe("authorization constraints", () => {
    const Actor = JIT.object({ id: JIT.number() });
    const Post = JIT.object({ id: JIT.number(), authorId: JIT.number(), published: JIT.boolean() });
    const rows = [
      { id: 1, authorId: 1, published: false },
      { id: 2, authorId: 2, published: true },
      { id: 3, authorId: 2, published: false },
    ];
    const access = JIT.access(Post)
      .actor(Actor)
      .can("read", (query, actor) => query.or(query.eq("published", true), query.eq("authorId", actor.field("id"))));

    it("inlines access and user predicates into the same query program", () => {
      const ability = access({ id: 1 });
      const query = JIT.cqrs
        .query(Post)
        .authorize(ability, "read")
        .where((condition) => condition.gt("id", 1));

      expect(query(rows)).toEqual([rows[1]]);
      expect(query(rows)).toEqual(rows.filter((row) => ability.can("read", row) && row.id > 1));
      const standard = JSON.stringify(query["~query"]);
      expect(standard).not.toMatch(/access|ability|permission|rule/i);
      expect(standard).toContain('"value":1');
    });

    it("keeps complete rows after a subject-wide denial has been pushed into the predicate", () => {
      const deniedLocked = JIT.access(Post)
        .actor(Actor)
        .can("read")
        .cannot("read", (condition) => condition.eq("published", false));
      const query = JIT.cqrs.query(Post).authorize(deniedLocked({ id: 1 }), "read");

      expect(query(rows)).toEqual([rows[1]]);
    });

    it("folds unconditional allow away and unconditional deny to an empty query", () => {
      const allow = JIT.access(Post).actor(Actor).can("read")({ id: 1 });
      const deny = JIT.access(Post).actor(Actor).cannot("read")({ id: 1 });
      const allowed = JIT.cqrs.query(Post).authorize(allow, "read");
      const denied = JIT.cqrs.query(Post).authorize(deny, "read");

      expect(allowed(rows)).toEqual(rows);
      expect(allowed["~query"].definition.pipeline).toEqual([]);
      expect(denied(rows)).toEqual([]);
      expect(JSON.stringify(denied["~query"])).not.toMatch(/access|ability|permission|rule/i);
      const artifact = getArtifact(denied);
      if (artifact?.kind !== "query-plan") throw new Error("missing denied query plan");
      const source = Compiler.emitQuerySource(artifact.schema, artifact.program as never);
      expect(source).toContain("return [];");
      expect(source).not.toContain("for (");
    });

    it("intersects requested fields with the projection guaranteed safe for every returned row", () => {
      const scoped = JIT.access(Post)
        .actor(Actor)
        .can("read", { fields: ["id", "published"] })
        .can("read", {
          fields: ["authorId"],
          when: (condition, actor) => condition.eq("authorId", actor.field("id")),
        });
      const query = JIT.cqrs
        .query(Post)
        .authorize(scoped({ id: 1 }), "read")
        .select("id", "authorId", "published");

      expect(query(rows)).toEqual([
        { id: 1, published: false },
        { id: 2, published: true },
        { id: 3, published: false },
      ]);
      expect(query["~query"].definition.projection).toEqual(["id", "published"]);
    });
  });

  it("exposes the complete query engine through the canonical CQRS surface", () => {
    const Entry = JIT.object({
      id: JIT.number(),
      group: JIT.string(),
      score: JIT.number(),
      tags: JIT.array(JIT.string()),
    });
    const base = JIT.cqrs.query(Entry);
    const fromCollection = JIT.cqrs.query(JIT.array(Entry).keyed("id"));
    const rows = [
      { id: 1, group: "a", score: 10, tags: ["x", "y"] },
      { id: 1, group: "a", score: 20, tags: ["z"] },
      { id: 2, group: "b", score: 30, tags: ["w"] },
    ];

    expect(
      [
        "where",
        "authorize",
        "filter",
        "select",
        "unique",
        "keyed",
        "groupBy",
        "orderBy",
        "flatMap",
        "take",
        "drop",
        "takeWhile",
        "dropWhile",
        "chunk",
        "window",
        "pairwise",
        "scan",
        "groupAdjacentBy",
        "delete",
        "update",
        "sum",
        "count",
        "avg",
        "min",
        "max",
        "lazy",
        "explain",
      ].every((method) => typeof base[method as keyof typeof base] === "function")
    ).toBe(true);
    expect(base.unique("id")(rows)).toEqual([rows[0], rows[2]]);
    expect(fromCollection.where((query) => query.eq("id", 2))(rows)).toEqual([rows[2]]);
    expect(base.keyed("id")(rows).get(2)).toEqual(rows[2]);
    expect(base.groupBy("group")(rows).a).toHaveLength(2);
    expect(base.drop(1).take(1)(rows)).toEqual([rows[1]]);
    expect(base.flatMap("tags")(rows)).toEqual(["x", "y", "z", "w"]);
    expect(base.sum("score")(rows)).toBe(60);
    expect(base.count()(rows)).toBe(3);
    expect(base.avg("score")(rows)).toBe(20);
    expect(base.min("score")(rows)).toBe(10);
    expect(base.max("score")(rows)).toBe(30);
    expect([...base.where((query) => query.gt("score", 10)).to.iterator()(rows)]).toEqual([rows[1], rows[2]]);
    expect(base.take(1)["~query"].definition.pipeline).toEqual([{ kind: "take", count: 1 }]);
    expectTypeOf(base.count()(rows)).toEqualTypeOf<number>();
    expectTypeOf(base.keyed("id")(rows)).toEqualTypeOf<Map<number, (typeof rows)[number]>>();
    expectTypeOf(fromCollection(rows)).toEqualTypeOf<(typeof rows)[number][]>();
  });

  it("lowers static queries through the existing QueryProgram", () => {
    const Order = JIT.object({
      id: JIT.string(),
      status: JIT.enum(["draft", "confirmed"]),
      total: JIT.number(),
    });
    const recent = JIT.cqrs
      .query(Order)
      .where((query) => query.eq("status", "confirmed"))
      .select("id", "total")
      .orderBy("total", "desc")
      .limit(1);

    expect(
      recent([
        { id: "o_1", status: "confirmed", total: 10 },
        { id: "o_2", status: "draft", total: 20 },
        { id: "o_3", status: "confirmed", total: 30 },
      ])
    ).toEqual([{ id: "o_3", total: 30 }]);
    expect(recent["~query"].version).toBe(1);
    expect(recent["~query"].definition).toEqual({
      source: { kind: "object", fields: ["id", "status", "total"] },
      pipeline: [
        {
          kind: "where",
          condition: {
            kind: "compare",
            operator: "eq",
            left: { kind: "field", path: ["status"] },
            right: { kind: "literal", value: "confirmed" },
          },
        },
        { kind: "select", fields: ["id", "total"] },
        { kind: "orderBy", key: "total", direction: "desc" },
        { kind: "take", count: 1 },
      ],
      filter: {
        kind: "compare",
        operator: "eq",
        left: { kind: "field", path: ["status"] },
        right: { kind: "literal", value: "confirmed" },
      },
      projection: ["id", "total"],
      order: [{ path: ["total"], direction: "desc" }],
      limit: 1,
      params: [],
    });
    expectTypeOf(recent).toMatchTypeOf<
      (orders: { id: string; status: "draft" | "confirmed"; total: number }[]) => {
        id: string;
        total: number;
      }[]
    >();
  });

  it("combines successive where clauses in runtime and the portable descriptor", () => {
    const User = JIT.object({ id: JIT.string(), age: JIT.number(), active: JIT.boolean(), role: JIT.string() });
    const adults = JIT.cqrs
      .query(User)
      .where((query) => query.gte("age", 18))
      .where((query) => query.and(query.eq("active", true), query.not(query.eq("role", "blocked"))))
      .select("id", "age");
    const rows = [
      { id: "a", age: 20, active: true, role: "member" },
      { id: "b", age: 17, active: true, role: "member" },
      { id: "c", age: 30, active: true, role: "blocked" },
      { id: "d", age: 40, active: false, role: "member" },
    ];

    expect(adults(rows)).toEqual([{ id: "a", age: 20 }]);
    expect(adults["~query"].definition.filter).toMatchObject({
      kind: "logical",
      operator: "and",
      left: { kind: "compare", operator: "gte" },
      right: {
        kind: "logical",
        operator: "and",
        left: { kind: "compare", operator: "eq" },
        right: { kind: "not", inner: { kind: "compare", operator: "eq" } },
      },
    });
    expectTypeOf(adults(rows)).toEqualTypeOf<{ id: string; age: number }[]>();
  });

  it("canonicalizes repeated operators identically in runtime and the descriptor", () => {
    const User = JIT.object({ id: JIT.string(), age: JIT.number(), active: JIT.boolean() });
    const query = JIT.cqrs
      .query(User)
      .limit(3)
      .where((builder) => builder.gte("age", 18))
      .orderBy("age", "desc")
      .orderBy("id", "asc")
      .select("id", "age")
      .select("id")
      .limit(1)
      .where((builder) => builder.eq("active", true));
    const rows = [
      { id: "c", age: 30, active: true },
      { id: "a", age: 17, active: true },
      { id: "b", age: 20, active: true },
      { id: "d", age: 40, active: false },
    ];

    expect(query(rows)).toEqual([{ id: "b" }]);
    expect(query["~query"].definition).toMatchObject({
      filter: { kind: "logical", operator: "and" },
      projection: ["id"],
      order: [{ path: ["id"], direction: "asc" }],
      limit: 1,
    });
  });

  it("keeps every comparison and logical filter equivalent to its direct predicate", () => {
    const Entry = JIT.object({
      id: JIT.number(),
      age: JIT.number(),
      score: JIT.number(),
      active: JIT.boolean(),
      role: JIT.string(),
    });

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer(),
            age: fc.integer(),
            score: fc.integer(),
            active: fc.boolean(),
            role: fc.constantFrom("member", "blocked", "admin"),
          }),
          { maxLength: 40 }
        ),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (rows, firstBound, secondBound, scoreFloor, idFloor) => {
          const minimumAge = Math.min(firstBound, secondBound);
          const maximumAge = Math.max(firstBound, secondBound);
          const query = JIT.cqrs
            .query(Entry)
            .where((builder) => builder.and(builder.gte("age", minimumAge), builder.lte("age", maximumAge)))
            .where((builder) => builder.or(builder.eq("active", true), builder.neq("role", "blocked")))
            .where((builder) => builder.not(builder.lt("score", scoreFloor)))
            .where((builder) => builder.gt("id", idFloor));

          expect(query(rows)).toEqual(
            rows.filter(
              (row) =>
                row.age >= minimumAge &&
                row.age <= maximumAge &&
                (row.active === true || row.role !== "blocked") &&
                !(row.score < scoreFloor) &&
                row.id > idFloor
            )
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  it("rejects non-object read models", () => {
    expect(() => JIT.cqrs.query(JIT.string())).toThrow(/object or Runtime Type/i);
  });

  it("rejects invalid CQRS keys and aggregate types statically", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const query = JIT.cqrs.query(User);

    // @ts-expect-error missing is not a field in the read model
    query.orderBy("missing");
    // @ts-expect-error sum accepts numeric fields only
    query.sum("name");

    const Flag = JIT.object({ active: JIT.boolean(), metadata: JIT.object({ source: JIT.string() }) });
    const invalidOperatorTypes = () => {
      JIT.cqrs.query(Flag).filter((condition) => {
        // @ts-expect-error ordered comparisons do not accept boolean fields
        return condition.gte("active", true);
      });
      JIT.cqrs.query(Flag).filter((condition) => {
        // @ts-expect-error equality does not expose object fields as scalar predicates
        return condition.eq("metadata", { source: "api" });
      });
    };
    void invalidOperatorTypes;
  });

  it("registers typed parameters in the existing query program", () => {
    const User = JIT.object({ id: JIT.string(), active: JIT.boolean() });
    const byActive = JIT.cqrs
      .query(User)
      .params({ active: JIT.boolean() })
      .where((query, params) => query.eq("active", params.active));

    expect(
      byActive(
        [
          { id: "a", active: true },
          { id: "b", active: false },
        ],
        { active: true }
      )
    ).toEqual([{ id: "a", active: true }]);
    expect(byActive["~query"].definition.params).toEqual(["active"]);
  });

  it("accumulates successive typed parameter declarations", () => {
    const User = JIT.object({ id: JIT.string(), age: JIT.number(), active: JIT.boolean() });
    const query = JIT.cqrs
      .query(User)
      .params({ minimumAge: JIT.number() })
      .where((builder, params) => builder.gte("age", params.minimumAge))
      .params({ active: JIT.boolean() })
      .where((builder, params) => builder.eq("active", params.active));

    expect(query([{ id: "a", age: 20, active: true }], { minimumAge: 18, active: true })).toHaveLength(1);
    expect(query["~query"].definition.params).toEqual(["minimumAge", "active"]);
    expect(() => JIT.cqrs.query(User).params({ active: JIT.boolean() }).params({ active: JIT.boolean() })).toThrow(
      /duplicated/i
    );
  });

  it("is consumable by a structural adapter without JIT internals", () => {
    const User = JIT.object({ id: JIT.string(), active: JIT.boolean(), score: JIT.number() });
    const query = JIT.cqrs
      .query(User)
      .where((builder) => builder.eq("active", true))
      .select("id", "score")
      .orderBy("score", "desc")
      .limit(1);
    const definition = query["~query"].definition;
    const rows = [
      { id: "a", active: true, score: 10 },
      { id: "b", active: false, score: 50 },
      { id: "c", active: true, score: 30 },
    ];

    // This intentionally knows only the public V1 shape; it is a stand-in for
    // an ORM/SQL adapter, not an in-memory fallback provided by JIT.
    const filter = definition.filter;
    let value = rows;
    if (filter?.kind === "compare" && filter.left.kind === "field" && filter.right.kind === "literal") {
      const field = filter.left.path[0] as keyof (typeof rows)[number];
      const expected = filter.right.value;
      value = rows.filter((row) => row[field] === expected);
    }
    const ordered = [...value].sort((left, right) => right.score - left.score);
    const result = ordered.slice(0, definition.limit).map((row) => ({ id: row.id, score: row.score }));

    expect(result).toEqual(query(rows));
  });

  it("normalizes permitted dynamic filter input and rejects unsupported syntax", () => {
    const User = JIT.object({
      name: JIT.string(),
      age: JIT.number(),
      status: JIT.string(),
    });
    const input = JIT.api.query(User, {
      filter: {
        name: true,
        age: ["gte", "lte"],
        status: ["eq", "neq"],
      },
      select: ["name", "age", "status"],
      sort: ["name", "age"],
      pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
    });
    const parse = JIT.api.parse(input);

    expect(input["~query"]).toEqual({
      version: 1,
      definition: {
        source: { kind: "object", fields: ["name", "age", "status"] },
        filters: { name: true, age: ["gte", "lte"], status: ["eq", "neq"] },
        projection: true,
        sorting: ["name", "age"],
        pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
        limits: { maxConditions: 32, maxSortFields: 3, maxSelectFields: 30 },
      },
    });

    expect(parse({ filter: { age: { $gte: 18 }, status: "active" } })).toEqual({
      filter: [
        { kind: "gte", path: ["age"], value: 18 },
        { kind: "eq", path: ["status"], value: "active" },
      ],
      sort: [],
      pagination: { kind: "offset", offset: 0, limit: 20 },
    });
    expect(() => parse({ filter: { missing: 1 } })).toThrow(/not allowed/i);
    expect(() => parse({ filter: { age: { $contains: 1 } } })).toThrow(/operator/i);
    expect(() => parse({ filter: { name: { $contains: "Ada" } } })).toThrow(/only allows equality/i);
    expect(() => parse([])).toThrow(/must be an object/i);
    expect(() => parse({ unknown: true })).toThrow(/not allowed/i);
  });

  it("normalizes allowed sort fields and bounded offset pagination", () => {
    const User = JIT.object({ name: JIT.string(), createdAt: JIT.date() });
    const parse = JIT.api.parse(
      JIT.api.query(User, {
        sort: ["name", "createdAt"],
        pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
      })
    );

    expect(parse({ sort: "-createdAt,name", page: 3, limit: 10 })).toEqual({
      filter: [],
      sort: [
        { path: ["createdAt"], direction: "desc" },
        { path: ["name"], direction: "asc" },
      ],
      pagination: { kind: "offset", offset: 20, limit: 10 },
    });
    expect(() => parse({ sort: "missing" })).toThrow(/sort field/i);
    expect(() => parse({ sort: "name,name" })).toThrow(/repeats/i);
    expect(() => parse({ sort: "name," })).toThrow(/empty|not allowed/i);
    expect(() => parse({ sort: 42 })).toThrow(/non-empty string/i);
    expect(() => parse({ sort: "" })).toThrow(/non-empty string/i);
    expect(() => parse({ limit: 101 })).toThrow(/pagination/i);
    expect(() => parse({ page: Number.MAX_SAFE_INTEGER, limit: 100 })).toThrow(/pagination/i);
  });

  it("keeps permitted operator aliases on the compiled path", () => {
    const User = JIT.object({ age: JIT.number() });
    const parse = JIT.api.parse(JIT.api.query(User, { filter: { age: ["gte"] } }));

    expect(parse({ filter: { age: { gte: 18, $gte: 21 } } })).toEqual({
      filter: [
        { kind: "gte", path: ["age"], value: 21 },
        { kind: "gte", path: ["age"], value: 18 },
      ],
      sort: [],
    });
  });

  it("normalizes opaque compound cursors with stable ordering", () => {
    const User = JIT.object({ id: JIT.string(), createdAt: JIT.string() });
    const parse = JIT.api.parse(
      JIT.api.query(User, {
        pagination: { type: "cursor", by: ["createdAt", "id"], defaultLimit: 20, maxLimit: 100 },
      })
    );
    const after = encodeCqrsCursor(["2026-01-01T00:00:00.000Z", "u_1"]);

    expect(parse({ after, limit: 10 })).toEqual({
      filter: [],
      sort: [
        { path: ["createdAt"], direction: "asc" },
        { path: ["id"], direction: "asc" },
      ],
      pagination: { kind: "cursor", after: ["2026-01-01T00:00:00.000Z", "u_1"], limit: 10 },
    });
    expect(() => parse({ after, before: after })).toThrow(/either after or before/i);
    expect(() => parse({ after: "not-a-cursor" })).toThrow(/cursor/i);
    expect(() => parse({ after, sort: "-createdAt,id" })).toThrow(/stable ordering/i);
  });

  it("enforces the configured structural filter budget", () => {
    const User = JIT.object({ name: JIT.string(), status: JIT.string() });
    const parse = JIT.api.parse(
      JIT.api.query(User, {
        filter: { name: true, status: true },
        maxFilters: 1,
      })
    );

    expect(() => parse({ filter: { name: "Ada", status: "active" } })).toThrow(/structural limit/i);
  });

  it("enforces condition and sort budgets in the compiled request parser", () => {
    const User = JIT.object({ age: JIT.number(), name: JIT.string(), id: JIT.string() });
    const parse = JIT.api.parse(
      JIT.api.query(User, {
        filter: { age: ["gte", "lte"] },
        sort: ["age", "name", "id"],
        limits: { maxConditions: 1, maxSortFields: 1 },
      })
    );

    expect(() => parse({ filter: { age: { $gte: 18, $lte: 30 } } })).toThrow(/condition limit/i);
    expect(() => parse({ sort: "age,name" })).toThrow(/structural limit/i);
  });

  it("normalizes bounded sparse fieldsets against the schema", () => {
    const User = JIT.object({ id: JIT.string(), name: JIT.string(), email: JIT.string() });
    const parse = JIT.api.parse(JIT.api.query(User, { select: ["id", "name"], limits: { maxSelectFields: 2 } }));

    expect(parse({ fields: "id,name" })).toEqual({ filter: [], sort: [], select: ["id", "name"] });
    expect(() => parse({ fields: "id,name,email" })).toThrow(/select exceeds/i);
    expect(() => parse({ fields: "email" })).toThrow(/select field/i);
    expect(() => parse({ fields: "password" })).toThrow(/select field/i);
    expect(() => parse({ fields: "id,id" })).toThrow(/repeats/i);
    expect(() => parse({ fields: "id," })).toThrow(/empty|not allowed/i);
    expect(() => parse({ fields: "" })).toThrow(/empty/i);
    expect(() => JIT.api.parse(JIT.api.query(User, {}))({ fields: "id" })).toThrow(/sparse fields/i);
  });

  it("normalizes declared nested filter paths in compiled source", () => {
    const User = JIT.object({ profile: JIT.object({ age: JIT.number() }) });
    const parse = JIT.api.parse(JIT.api.query(User, { filter: { "profile.age": ["gte"] } }));

    expect(parse({ filter: { "profile.age": { $gte: 18 } } })).toEqual({
      filter: [{ kind: "gte", path: ["profile", "age"], value: 18 }],
      sort: [],
    });
  });

  it("validates static parser configuration before generating source", () => {
    const User = JIT.object({ name: JIT.string() });
    const invalidProjectionTypes = () => {
      // @ts-expect-error public projection fields are model keys
      JIT.api.query(User, { select: ["missing"] });
      // @ts-expect-error public projection is an explicit allowlist
      JIT.api.query(User, { select: true });
    };
    void invalidProjectionTypes;
    const Flags = JIT.object({ active: JIT.boolean(), metadata: JIT.object({ source: JIT.string() }) });
    const invalidOperatorTypes = () => {
      // @ts-expect-error boolean fields only support equality operators
      JIT.api.query(Flags, { filter: { active: ["gte"] } });
      // @ts-expect-error object fields are not scalar query fields
      JIT.api.query(Flags, { filter: { metadata: true } });
    };
    void invalidOperatorTypes;
    expect(() => JIT.api.query(User, { maxFilters: -1 })).toThrow(/maxFilters/i);
    expect(() =>
      JIT.api.query(User, {
        pagination: { type: "offset", defaultLimit: 10, maxLimit: 5 },
      })
    ).toThrow(/pagination/i);
    expect(() =>
      JIT.api.query(User, {
        pagination: { type: "cursor", by: [], defaultLimit: 10, maxLimit: 20 },
      })
    ).toThrow(/stable ordering/i);
    expect(() => JIT.api.query(User, { limits: { maxSortFields: -1 } })).toThrow(/structural limits/i);
    expect(() => JIT.api.query(User, { filter: { missing: true } as never })).toThrow(/not declared/i);
    expect(() => JIT.api.query(User, { sort: ["missing"] as never })).toThrow(/not declared/i);
    expect(() => JIT.api.query(User, { select: ["missing"] as never })).toThrow(/not declared/i);
    expect(() => JIT.api.query(User, { select: ["name", "name"] })).toThrow(/repeats/i);
    expect(() => JIT.api.query(User, { select: true as never })).toThrow(/must be an array/i);
    expect(() => JIT.api.query(User, { sort: ["name", "name"] })).toThrow(/repeats/i);
    expect(() => JIT.api.query(User, { filter: { name: ["eq", "eq"] } })).toThrow(/repeats operator/i);
    expect(() => JIT.api.query(User, { filter: { name: [] } })).toThrow(/empty operator list/i);
    expect(() => JIT.api.query(User, { filter: { name: ["$eq"] } as never })).toThrow(/invalid operator/i);
    expect(() => JIT.api.query(Flags, { filter: { active: ["gte"] } as never })).toThrow(/invalid operator/i);
    expect(() => JIT.api.query(Flags, { filter: { metadata: true } as never })).toThrow(/scalar query field/i);
    expect(() =>
      JIT.api.query(User, {
        pagination: { type: "cursor", by: ["name", "name"], defaultLimit: 10, maxLimit: 20 },
      })
    ).toThrow(/repeats/i);
  });

  it("snapshots nested configuration before compiling the parser", () => {
    const User = JIT.object({ age: JIT.number() });
    const operators: ("gte" | "lte")[] = ["gte"];
    const selected = ["age"] as const;
    const input = JIT.api.query(User, { filter: { age: operators }, select: selected });

    operators.push("lte");
    expect(input.options.filter?.age).toEqual(["gte"]);
    expect(input.options.select).toEqual(["age"]);
    expect(() => (input.options.filter?.age as string[]).push("lte")).toThrow();
    expect(JIT.api.parse(input)({ filter: { age: { $gte: 18 } } })).toEqual({
      filter: [{ kind: "gte", path: ["age"], value: 18 }],
      sort: [],
    });
  });

  it("emits deterministic direct source for filter, sort and offset pagination", () => {
    const first = emitCqrsInputParser([["age", ["gte", "lte"]]], 8, ["age"], {
      type: "offset",
      defaultLimit: 20,
      maxLimit: 100,
    });
    const second = emitCqrsInputParser([["age", ["gte", "lte"]]], 8, ["age"], {
      type: "offset",
      defaultLimit: 20,
      maxLimit: 100,
    });

    expect(first).toBe(second);
    expect(first).toContain("const sortText = input.sort");
    expect(first).toContain("const offset = (page - 1) * limit");
    expect(first).toContain('pagination: { kind: "offset", offset, limit }');
    expect(first).toContain("out[j++]");
  });

  it("emits an import-free parser for AOT", () => {
    const source = emitCqrsAotParserSource(
      [
        ["age", ["gte"]],
        ["name", true],
      ],
      8,
      ["age", "name"],
      undefined,
      8,
      3,
      ["age", "name"]
    );
    const parse = globalThis.Function(source)() as (input: unknown) => unknown;
    expect(source).not.toContain("__reference");
    expect(parse({ filter: { age: { $gte: 18 } } })).toEqual({
      filter: [{ kind: "gte", path: ["age"], value: 18 }],
      sort: [],
    });
    expect(() => parse([])).toThrow(/invalid API query input/i);
    expect(() => parse({ filter: { name: { $contains: "Ada" } } })).toThrow(/invalid API query input/i);
    expect(() => parse({ sort: "age,age" })).toThrow(/invalid API query input/i);
    expect(() => parse({ fields: "name,name" })).toThrow(/invalid API query input/i);
    expect(() => parse({ fields: "" })).toThrow(/invalid API query input/i);
    expect(() => parse({ sort: 42 })).toThrow(/invalid API query input/i);
    expect(() => parse({ unknown: true })).toThrow(/invalid API query input/i);
  });

  it("keeps valid dynamic requests equivalent between runtime and import-free AOT", () => {
    const User = JIT.object({ age: JIT.number(), name: JIT.string() });
    const input = JIT.api.query(User, {
      filter: { age: ["gte", "lte"], name: true },
      sort: ["age", "name"],
      select: ["age", "name"],
      pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
    });
    const runtime = JIT.api.parse(input);
    const source = emitCqrsAotParserSource(
      [
        ["age", ["gte", "lte"]],
        ["name", true],
      ],
      32,
      ["age", "name"],
      { type: "offset", defaultLimit: 20, maxLimit: 100 },
      3,
      3,
      ["age", "name"]
    );
    const aot = globalThis.Function(source)() as (value: unknown) => unknown;

    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        fc.string(),
        fc.constantFrom("age", "-age", "name", "-name", "age,-name"),
        fc.constantFrom("age", "name", "age,name"),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 100 }),
        (gte, lte, name, sort, fields, page, limit) => {
          const request = { filter: { age: { $gte: gte, $lte: lte }, name }, sort, fields, page, limit };
          expect(aot(request)).toEqual(runtime(request));
        }
      ),
      { numRuns: 300 }
    );
  });
});
