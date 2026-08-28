import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

/**
 * Snapshot coverage of generated source in complex, composed scenarios.
 * These complement the byte-exact goldens in query.test.ts: any emitter
 * change that reshapes output must be reviewed as a snapshot diff.
 */

function sourceOf(compiled: object): string {
  const artifact = getArtifact(compiled);

  if (!artifact) throw new Error("compiled source artifact not registered");
  // A query builder carries its program and the result shape it was declared
  // for; the plan is lowered through the same dispatch AOT uses.
  if (artifact.kind === "query-plan")
    return Compiler.emitQueryPlanSource(artifact.schema, artifact.program as never, artifact.mode);
  // A sort plan carries its ordering descriptor; the comparator is emitted from it.
  if (artifact.kind === "sort-plan") return Compiler.emitSortSource(artifact.descriptor);
  // An index plan carries its descriptor; the builder is emitted from it.
  if (artifact.kind === "index-plan")
    return Compiler.emitIndexPlanSource(artifact.descriptor, Compiler.indexCacheKey(artifact.descriptor));
  if (artifact.kind === "migration-plan") return Compiler.emitMigrationSource(artifact.descriptor);
  if (artifact.kind === "csv-plan") return Compiler.emitCsvSource(artifact.descriptor);
  if (artifact.kind === "ndjson-plan") return Compiler.emitNdjsonSource(artifact.descriptor);
  if (!("source" in artifact)) throw new Error("compiled source artifact not registered");
  return artifact.source;
}

describe("generated source snapshots", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().min(2).max(64),
    email: JIT.string().email(),
    role: JIT.union(JIT.literal("admin"), JIT.literal("user"), JIT.literal("blocked")),
    score: JIT.nullable(JIT.number()),
    tags: JIT.array(JIT.string()).max(8),
  });
  const Users = JIT.array(User);

  it("query: filter with nested and/or/not + select + unique + orderBy", () => {
    const compiled = JIT.cqrs
      .query(Users)
      .filter((q) => q.and(q.not(q.eq("role", "blocked")), q.or(q.gt("id", 100), q.eq("role", "admin"))))
      .select("id", "name", "role")
      .unique("id")
      .orderBy("name", "asc");

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("sort: multi-criterion comparator over string, nullable number, and int keys", () => {
    const compiled = JIT.sort(Users).by("name").thenBy("score", "desc").thenBy("id");

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("query: filtered terminal returns from inside the loop", () => {
    const compiled = JIT.cqrs
      .query(Users)
      .where((query) => query.and(query.eq("role", "admin"), query.gt("id", 10)))
      .select("id", "name")
      .first();

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("index: compound keys nest one map per level", () => {
    const compiled = JIT.index(Users).by("role", "id");

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("index: grouped shape collects rows per key", () => {
    const compiled = JIT.index(Users).by("role").grouped();

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("migration: version switch with two mapper edges", () => {
    const V1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });
    const V2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string() });
    const V3 = JIT.object({ version: JIT.literal(3), displayName: JIT.string(), active: JIT.boolean() });
    const compiled = JIT.migrate(V1)
      .to(V2, { fullName: { from: "name" } })
      .to(V3, { displayName: { from: "fullName" }, active: { default: true } });

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("CSV: incremental scanner and static row conversion", () => {
    const Row = JIT.object({ id: JIT.number().int(), name: JIT.string(), active: JIT.boolean() });

    expect(sourceOf(JIT.csv.parse(Row))).toMatchSnapshot();
  });

  it("NDJSON: fused filter, projection and serializer", () => {
    const Row = JIT.object({ id: JIT.number(), name: JIT.string(), active: JIT.boolean() });
    const compiled = JIT.ndjson
      .parse(Row)
      .where((query) => query.eq("active", true))
      .select("id", "name")
      .to.ndjson();

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("query: groupBy after filter", () => {
    const compiled = JIT.cqrs
      .query(Users)
      .filter((q) => q.gte("id", 10))
      .groupBy("role");

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("query: filtered aggregation", () => {
    const compiled = JIT.cqrs
      .query(Users)
      .filter((q) => q.eq("role", "user"))
      .avg("id");

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("execution: JSON validation and filtered terminal aggregation", () => {
    const total = JIT.json
      .parse(Users)
      .validate()
      .filter((query) => query.eq("role", "user"))
      .sum("id");

    expect(Compiler.emitExecutionPlan(total.plan).source).toMatchSnapshot();
  });

  it("validator: deep unions, formats, coercion, transforms, and messages", () => {
    const Payment = JIT.object({
      id: JIT.string().ulid("id deve ser ULID"),
      amount: JIT.coerce.number().positive("valor deve ser positivo"),
      method: JIT.union(
        JIT.object({ kind: JIT.literal("pix"), key: JIT.string().email() }),
        JIT.object({ kind: JIT.literal("card"), last4: JIT.string().length(4) })
      ),
      note: JIT.optional(JIT.string().trim().max(140)),
    });

    expect(Compiler.emitValidatorSource(Payment.schema)).toMatchSnapshot();
  });

  it("validator: strict checks, masks, noEmpty, and conditional refine", () => {
    const Credentials = JIT.object({
      password: JIT.string().min(8),
      confirmPassword: JIT.string().min(8),
    });
    const Signup = JIT.object({
      kind: JIT.string().oneOf(["admin", "user"] as const),
      age: JIT.number().moreThan(17).lessThan(130).int32(),
      cpf: JIT.string().cpf(),
      phone: JIT.string().phoneBR(),
      invite: JIT.string().noEmpty().optional(),
      credentials: Credentials.refine((value) => value.password === value.confirmPassword, {
        message: "passwords must match",
        path: ["confirmPassword"],
        when(payload) {
          return Credentials.safeParse(payload.value).success;
        },
      }),
    });

    expect(Compiler.emitValidatorSource(Signup.schema)).toMatchSnapshot();
  });

  it("validator: strict known keys and catchall transforms", () => {
    const Payload = JIT.object({
      id: JIT.number().int(),
      meta: JIT.object({ owner: JIT.string().trim() }).catchall(JIT.string().trim()),
    }).strict();

    expect(Compiler.emitValidatorSource(Payload.schema)).toMatchSnapshot();
  });

  it("validator: json, custom, and template literal schemas", () => {
    const Payload = JIT.object({
      data: JIT.json.value(),
      external: JIT.custom<{ id: string }>(
        (value): value is { id: string } => typeof value === "object" && value !== null && "id" in value
      ),
      greeting: JIT.templateLiteral(["hello, ", JIT.string(), "!"] as const),
    });

    expect(Compiler.emitValidatorSource(Payload.schema)).toMatchSnapshot();
  });

  it("validator: Temporal API schemas", () => {
    const Event = JIT.object({
      at: JIT.temporal.instant(),
      date: JIT.temporal.plainDate(),
      duration: JIT.temporal.duration(),
    });

    expect(Compiler.emitValidatorSource(Event.schema)).toMatchSnapshot();
  });

  it("validator: ISO namespace schemas", () => {
    const Boundary = JIT.object({
      date: JIT.iso.date(),
      time: JIT.iso.time({ precision: 3 }),
      at: JIT.iso.datetime({ offset: true, precision: 0 }),
      ttl: JIT.iso.duration(),
    });

    expect(Compiler.emitValidatorSource(Boundary.schema)).toMatchSnapshot();
  });

  it("validator: conditional fields, logical schemas, and temporal checks", () => {
    const Checkout = JIT.object({
      temDesconto: JIT.boolean(),
      cupom: JIT.string().where("temDesconto", {
        is: true,
        then: (schema) => schema.required().min(3),
        otherwise: (schema) => schema.optional(),
      }),
      ref: JIT.string().xor(JIT.string().min(8)),
      status: JIT.literal("blocked").not(),
      at: JIT.date().between("2026-07-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z").truncateTo("minute"),
      day: JIT.temporal.plainDate().daysOfWeek([1, 2, 3, 4, 5]).monthsOfYear([7]),
    });

    expect(Compiler.emitValidatorSource(Checkout.schema)).toMatchSnapshot();
  });

  it("validator: bidirectional value codec", () => {
    const StringToDate = JIT.codec(JIT.string().datetime(), JIT.date(), {
      decode: (iso) => new Date(iso),
      encode: (date) => date.toISOString(),
    });

    expect(Compiler.emitValidatorSource(StringToDate.schema)).toMatchSnapshot();
  });

  it("serializer: nested objects, optionals, records, and arrays", () => {
    const Report = JIT.object({
      title: JIT.string(),
      owner: JIT.object({ id: JIT.number(), name: JIT.string() }),
      counts: JIT.record(JIT.string(), JIT.number()),
      note: JIT.optional(JIT.string()),
      rows: JIT.array(JIT.object({ label: JIT.string(), value: JIT.number() })),
    });

    expect(Compiler.emitSerializeSource(Report.schema)).toMatchSnapshot();
  });

  it("codec v2: discriminated union, optional bitmask, and collections", () => {
    const Event = JIT.object({
      seq: JIT.int(),
      at: JIT.date(),
      pressure: JIT.optional(JIT.number()),
      trace: JIT.nullable(JIT.string()),
      payload: JIT.discriminatedUnion("kind", [
        JIT.object({ kind: JIT.literal("click"), x: JIT.number(), y: JIT.number() }),
        JIT.object({ kind: JIT.literal("key"), code: JIT.string() }),
      ]),
      tags: JIT.set(JIT.string()),
    });

    expect(Compiler.emitCodecSource(Event.schema)).toMatchSnapshot();
  });

  it("binary rowset: loader, hydrator, and byte query", () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      role: JIT.union(JIT.literal("admin"), JIT.literal("user"), JIT.literal("blocked")),
      active: JIT.boolean(),
      score: JIT.number().float32(),
      note: JIT.string().optional(),
    });
    const Users = JIT.array(User).binary({ strategy: "exact", memoryLayout: "aligned" });
    const ColumnarUsers = JIT.array(User).binary({ strategy: "exact", memoryLayout: "columnar" });
    const query = JIT.cqrs
      .query(Users)
      .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
      .select("id", "score");
    const sum = JIT.cqrs
      .query(Users)
      .filter((q) => q.and(q.eq("active", true), q.gt("score", 500)))
      .sum("score");
    const columnarQuery = JIT.cqrs
      .query(ColumnarUsers)
      .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
      .select("id", "score");
    const adaptiveProcess = JIT.process(User)
      .binary({ strategy: "exact", memoryLayout: "columnar" })
      .filter((q) => q.eq("role", "admin"))
      .select("id", "note")
      .compile();

    expect({
      writer: Compiler.emitBinaryRowSetWriterSource(Users.layout),
      hydrate: Compiler.emitBinaryHydrateSource(Users.layout),
      query: sourceOf(query),
      sum: sourceOf(sum),
      columnarWriter: Compiler.emitBinaryRowSetWriterSource(ColumnarUsers.layout),
      columnarHydrate: Compiler.emitBinaryHydrateSource(ColumnarUsers.layout),
      columnarQuery: sourceOf(columnarQuery),
      adaptiveWriter: Compiler.emitBinaryRowSetWriterSource(adaptiveProcess.binary.layout),
      adaptiveQuery: sourceOf(adaptiveProcess.query),
    }).toMatchSnapshot();
  });

  it("binary rowset: tagged object union", () => {
    const Shape = JIT.discriminatedUnion("kind", [
      JIT.object({ kind: JIT.literal("circle"), id: JIT.number().int32(), radius: JIT.number().float32() }),
      JIT.object({
        kind: JIT.literal("rectangle"),
        id: JIT.number().int32(),
        width: JIT.number().float32(),
        height: JIT.number().float32(),
      }),
    ]);
    const Shapes = JIT.array(Shape).binary({ strategy: "exact", memoryLayout: "columnar" });
    const circles = JIT.cqrs.query(Shapes).filter((q) => q.eq("kind", "circle"));

    expect({
      writer: Compiler.emitBinaryRowSetWriterSource(Shapes.layout),
      hydrate: Compiler.emitBinaryHydrateSource(Shapes.layout),
      query: sourceOf(circles),
    }).toMatchSnapshot();
  });

  it("lazy query and chunked JSON backends", () => {
    const iterate = JIT.cqrs
      .query(Users)
      .filter((q) => q.eq("role", "admin"))
      .select("id", "name")
      .take(10)
      .to.iterator();
    const stringifyChunks = JIT.json.stringifyChunks(Users, { chunkBytes: 1024 });

    expect(stringifyChunks.plan.stages.map((stage) => stage.kind)).toEqual(["value", "json.encode"]);
    expect({
      iterator: sourceOf(iterate),
      stringifyChunks: Compiler.emitStringifyChunksSource(Users.schema, { chunkBytes: 1024 }),
    }).toMatchSnapshot();
  });

  it("mapper: renames, nested objects, and fused many()", () => {
    const Entity = JIT.object({
      id: JIT.number(),
      fullName: JIT.string(),
      passwordHash: JIT.string(),
      profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
    });
    const DTO = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
    });
    expect(Compiler.emitMapperSource(Entity.schema, DTO.schema, { name: { from: "fullName" } })).toMatchSnapshot();
  });

  it("mapper: explicit map and many selections", () => {
    const Source = JIT.object({ id: JIT.number(), label: JIT.string() });
    const Target = JIT.object({ id: JIT.number(), label: JIT.string() });
    expect({
      map: Compiler.emitMapperSource(Source.schema, Target.schema, {}, ["map"]),
      many: Compiler.emitMapperSource(Source.schema, Target.schema, {}, ["many"]),
    }).toMatchSnapshot();
  });
  it("sanitize: configured HTML allow-list and identifier presets", () => {
    const Form = JIT.object({
      body: JIT.string().sanitize({
        preset: "none",
        html: { mode: "allow", tags: ["b", "code"] },
        controls: "remove",
      }),
      column: JIT.string().sanitize("sqlIdentifier"),
    });

    expect({
      sanitize: Compiler.emitSanitizeSource(Form.schema),
      parse: Compiler.emitValidatorSource(Form.schema, { ops: ["parse"] }),
    }).toMatchSnapshot();
  });

  it("dto annotations retain normal validation and mapper source", () => {
    const Entity = JIT.object({ id: JIT.number(), fullName: JIT.string(), passwordHash: JIT.string() });
    const Public = JIT.dto(JIT.object({ id: JIT.number(), name: JIT.string() }));

    expect({
      is: Compiler.emitValidatorSource(Public.schema, { ops: ["is"] }),
      from: Compiler.emitMapperSource(Entity.schema, Public.schema, { name: { from: "fullName" } }, ["map"]),
      many: Compiler.emitMapperSource(Entity.schema, Public.schema, { name: { from: "fullName" } }, ["many"]),
    }).toMatchSnapshot();
  });

  it("execution: JSON validation and Runtime Class construction", () => {
    const User = JIT.class(
      JIT.object({
        id: JIT.string().default("generated"),
        name: JIT.string().min(2),
      })
    );
    const parseUser = JIT.json.parse(User).validate();

    expect({
      stages: parseUser.plan.stages.map((stage) => stage.kind),
      source: Compiler.emitExecutionPlan(parseUser.plan).source,
    }).toMatchSnapshot();
  });
});
