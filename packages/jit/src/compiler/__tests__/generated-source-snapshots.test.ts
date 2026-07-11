import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

/**
 * Snapshot coverage of generated source in complex, composed scenarios.
 * These complement the byte-exact goldens in query.test.ts: any emitter
 * change that reshapes output must be reviewed as a snapshot diff.
 */

function sourceOf(compiled: object): string {
  const artifact = getArtifact(compiled);

  if (!artifact || !("source" in artifact)) throw new Error("compiled source artifact not registered");
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
    const compiled = JIT.query(Users)
      .filter((q) => q.and(q.not(q.eq("role", "blocked")), q.or(q.gt("id", 100), q.eq("role", "admin"))))
      .select("id", "name", "role")
      .unique("id")
      .orderBy("name", "asc")
      .compile();

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("query: groupBy after filter", () => {
    const compiled = JIT.query(Users)
      .filter((q) => q.gte("id", 10))
      .groupBy("role")
      .compile();

    expect(sourceOf(compiled)).toMatchSnapshot();
  });

  it("query: filtered aggregation", () => {
    const compiled = JIT.query(Users)
      .filter((q) => q.eq("role", "user"))
      .avg("id")
      .compile();

    expect(sourceOf(compiled)).toMatchSnapshot();
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
      data: JIT.json(),
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
    const toDTO = JIT.mapper(Entity, DTO, { name: { from: "fullName" } });

    expect(sourceOf(toDTO)).toMatchSnapshot();
  });
});
